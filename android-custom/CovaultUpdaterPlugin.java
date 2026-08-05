package com.covault.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.Bridge;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * The two ways Covault replaces itself.
 *
 * <p><b>A new APK</b>, when the Android code changed: downloaded here and handed
 * to the system installer, which always asks the user first. There is no API
 * that skips that confirmation, so this route costs one tap and cannot be made
 * silent.
 *
 * <p><b>A new web bundle</b>, when only the React side changed: downloaded,
 * unpacked into private storage, and pointed at for the next launch. Capacitor
 * already knows how to serve the app from a directory instead of the APK's
 * assets — see CAP_SERVER_PATH — so this is bookkeeping rather than invention.
 * Nobody taps anything, and a bundle that cannot start is put back after two
 * launches by load().
 *
 * <p>Deliberately dumb: every method returns immediately and the JavaScript side
 * drives the sequence (start → poll → install or stage). The alternative — one
 * native method that blocks until the download finishes — means holding a
 * PluginCall across minutes of radio time, which is exactly the shape that
 * breaks when the activity is recreated mid-download. Polling costs a timer in
 * JS and nothing else.
 *
 * <p>Downloads land in the app's own external files directory, so they need no
 * storage permission and go when the app does. DownloadManager hands back a
 * content:// URI for the APK, which is what the installer will accept — a
 * file:// URI throws FileUriExposedException on anything modern.
 */
@CapacitorPlugin(name = "CovaultUpdater")
public class CovaultUpdaterPlugin extends Plugin {

    private static final String TAG = "CovaultUpdater";
    private static final String APK_NAME = "covault-update.apk";
    private static final String APK_MIME = "application/vnd.android.package-archive";

    /** Where unpacked web bundles live, under the app's private files dir. */
    private static final String WEB_DIR = "covault-web";

    private static final String PREFS = "covault_updater";
    /** Version of the web bundle currently pointed at, 0 for the built-in one. */
    private static final String KEY_WEB_VERSION = "web_version";
    /** Set when a bundle is staged, cleared once the app proves it can start. */
    private static final String KEY_WEB_PENDING = "web_pending";
    private static final String KEY_BOOT_ATTEMPTS = "web_boot_attempts";
    /** Which APK the staged bundle belongs to. */
    private static final String KEY_APK_BUILD = "web_apk_build";

    /**
     * How many launches a staged bundle gets to confirm itself before it is
     * treated as broken and thrown away.
     *
     * Two rather than one: an app can be killed during its first launch for
     * reasons that have nothing to do with the update — a phone call, memory
     * pressure, the user backing straight out — and discarding a perfectly good
     * bundle for that would be its own bug.
     */
    private static final int MAX_UNCONFIRMED_LAUNCHES = 2;

    /**
     * The bundle version this process is actually serving, decided in load()
     * before Capacitor reads the server path and never changed afterwards
     * except by applyWebBundleNow().
     *
     * The stored version alone cannot answer "is the running app up to date":
     * staging writes it immediately, while the WebView carries on serving the
     * old files until something reloads it. Keeping what we booted with is
     * what lets the app say "a new version is downloaded and waiting" rather
     * than believing it is already running it.
     */
    private int runningWebVersion = 0;

    /**
     * Capacitor's own record of where it should serve the app from. Writing it
     * here is deliberate: `WebView.setServerBasePath` swaps the running app out
     * from under the user immediately, which is not something an update should
     * do mid-sentence. Setting the preference alone means Capacitor picks the
     * new bundle up the next time the app starts cold, which is invisible.
     */
    private static final String CAP_WEBVIEW_PREFS = "CapWebViewSettings";
    private static final String CAP_SERVER_PATH = "serverBasePath";

    /**
     * Decide, before the WebView is pointed anywhere, whether the staged bundle
     * is trustworthy.
     *
     * This runs during plugin registration, which Capacitor does *before* it
     * reads the stored server path — so clearing that preference here is enough
     * to fall back to the version built into the APK. That ordering is the
     * whole rollback mechanism; if a future Capacitor swaps those two steps,
     * a bad bundle would boot once more before being caught.
     */
    @Override
    public void load() {
        try {
            SharedPreferences prefs = prefs();

            // Whatever is stored now is what Capacitor is about to serve, so
            // this is the version this process runs — unless the checks below
            // throw the bundle away, and clearWebBundle() resets it for that.
            runningWebVersion = prefs.getInt(KEY_WEB_VERSION, 0);

            int stagedFor = prefs.getInt(KEY_APK_BUILD, 0);
            int current = currentVersionCode();
            if (stagedFor != 0 && current != 0 && stagedFor != current) {
                // A new APK has been installed. Capacitor already ignores a web
                // bundle across a reinstall; drop our own record of it so the
                // app doesn't believe it is running code it isn't.
                Log.i(TAG, "New APK detected; discarding the staged web bundle");
                clearWebBundle();
                return;
            }

            int pending = prefs.getInt(KEY_WEB_PENDING, 0);
            if (pending == 0) return;

            int attempts = prefs.getInt(KEY_BOOT_ATTEMPTS, 0) + 1;
            if (attempts >= MAX_UNCONFIRMED_LAUNCHES) {
                Log.w(TAG, "Web bundle " + pending + " never finished starting; reverting");
                clearWebBundle();
            } else {
                prefs.edit().putInt(KEY_BOOT_ATTEMPTS, attempts).commit();
            }
        } catch (Exception e) {
            // Never let update bookkeeping stop the app from starting.
            Log.w(TAG, "Could not check the staged web bundle", e);
        }
    }

    /**
     * Whether Android will let Covault install an APK at all.
     *
     * From Android 8 this is a per-app toggle buried in Settings, off by
     * default, and there is no way to prompt for it inline — the only route is
     * to send the user to that Settings page. Reporting it up front lets the
     * UI ask once, in its own words, instead of firing an install intent that
     * dies silently.
     */
    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("canInstall", canRequestInstalls());
        result.put("apkVersion", currentVersionCode());
        // 0 means the app is running the web build shipped inside the APK.
        result.put("webVersion", prefs().getInt(KEY_WEB_VERSION, 0));
        // The pair the UI needs to say "downloaded, not yet running": staged is
        // what is on disk, running is what this process actually started with.
        result.put("stagedWebVersion", prefs().getInt(KEY_WEB_VERSION, 0));
        result.put("runningWebVersion", runningWebVersion);
        result.put("nativeHash", nativeHash());
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "Could not open install-permission settings", e);
            call.reject("Could not open the install permission screen");
        }
    }

    /**
     * Queue the APK download. Resolves with an id to poll, as a string —
     * DownloadManager ids are longs and there is no reason to squeeze them
     * through a JavaScript number.
     */
    @PluginMethod
    public void startDownload(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("No download URL supplied");
            return;
        }
        // The APK and the web bundle are both downloaded through here, and must
        // not land on top of each other.
        String fileName = call.getString("fileName", APK_NAME);

        Context context = getContext();
        File target = new File(context.getExternalFilesDir(null), fileName);
        // DownloadManager refuses to overwrite, so a leftover from a previous
        // update would fail every subsequent download until the app is cleared.
        if (target.exists() && !target.delete()) {
            call.reject("Could not clear the previous download");
            return;
        }

        try {
            DownloadManager manager =
                (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                call.reject("Downloads are unavailable on this device");
                return;
            }

            boolean isApk = fileName.endsWith(".apk");

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Covault update");
            request.setDescription("Downloading the new version");
            if (isApk) request.setMimeType(APK_MIME);
            request.setDestinationInExternalFilesDir(context, null, fileName);
            // The APK download is something the user asked for and is waiting
            // on, so it gets a notification. A web bundle is meant to arrive
            // without anyone noticing; a progress bar in the shade for an
            // update nobody requested is just noise.
            request.setNotificationVisibility(
                isApk
                    ? DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                    : DownloadManager.Request.VISIBILITY_HIDDEN);

            long id = manager.enqueue(request);
            JSObject result = new JSObject();
            result.put("id", String.valueOf(id));
            call.resolve(result);
        } catch (Exception e) {
            // DownloadManager can be disabled outright by the user, and a
            // malformed URL throws here too. Either way the JS side falls back
            // to opening the link in the browser.
            Log.w(TAG, "Could not queue the update download", e);
            call.reject("Could not start the download");
        }
    }

    /**
     * Where a queued download has got to: `pending`, `running`, `done` or
     * `failed`, plus a 0–100 percentage when the total size is known.
     */
    @PluginMethod
    public void pollDownload(PluginCall call) {
        Long id = parseId(call);
        if (id == null) return;

        DownloadManager manager =
            (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("Downloads are unavailable on this device");
            return;
        }

        Cursor cursor = null;
        try {
            cursor = manager.query(new DownloadManager.Query().setFilterById(id));
            if (cursor == null || !cursor.moveToFirst()) {
                // The row is gone — the user cleared it from the downloads UI.
                call.resolve(progress("failed", 0));
                return;
            }

            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long soFar = cursor.getLong(
                cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = cursor.getLong(
                cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            int percent = total > 0 ? (int) ((soFar * 100L) / total) : 0;

            switch (status) {
                case DownloadManager.STATUS_SUCCESSFUL:
                    call.resolve(progress("done", 100));
                    break;
                case DownloadManager.STATUS_FAILED:
                    call.resolve(progress("failed", percent));
                    break;
                case DownloadManager.STATUS_RUNNING:
                    call.resolve(progress("running", percent));
                    break;
                default:
                    call.resolve(progress("pending", percent));
                    break;
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not read download progress", e);
            call.resolve(progress("failed", 0));
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    /**
     * Hand the finished download to the system installer.
     *
     * This is as automatic as a non-system app is allowed to be: Android always
     * shows its own "update this app?" confirmation, and there is no API that
     * skips it. What it does avoid is the download-find-the-file-tap dance.
     */
    @PluginMethod
    public void install(PluginCall call) {
        Long id = parseId(call);
        if (id == null) return;

        if (!canRequestInstalls()) {
            call.reject("Covault is not allowed to install apps");
            return;
        }

        try {
            DownloadManager manager =
                (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                call.reject("Downloads are unavailable on this device");
                return;
            }

            Uri apk = manager.getUriForDownloadedFile(id);
            if (apk == null) {
                call.reject("The downloaded update could not be found");
                return;
            }

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(apk, APK_MIME);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "Could not open the installer", e);
            call.reject("Could not open the installer");
        }
    }

    /**
     * Unpack a downloaded web bundle and point Capacitor at it for next launch.
     *
     * Nothing visible happens here. The running app is left exactly as it is —
     * see CAP_SERVER_PATH above for why — and the new code takes over the next
     * time Covault starts cold.
     */
    @PluginMethod
    public void stageWebBundle(PluginCall call) {
        Long id = parseId(call);
        if (id == null) return;

        Integer version = call.getInt("version");
        if (version == null || version <= 0) {
            call.reject("No web bundle version supplied");
            return;
        }

        File zip = downloadedFile(id);
        if (zip == null || !zip.exists()) {
            call.reject("The downloaded web bundle could not be found");
            return;
        }

        File target = new File(new File(getContext().getFilesDir(), WEB_DIR), String.valueOf(version));
        try {
            deleteTree(target);
            if (!target.mkdirs()) {
                call.reject("Could not make room for the web bundle");
                return;
            }

            unzip(zip, target);

            // A bundle without an entry point would boot to a blank screen and
            // only be caught by the two-launch rollback. Cheaper to catch here.
            if (!new File(target, "index.html").isFile()) {
                deleteTree(target);
                call.reject("The web bundle has no index.html");
                return;
            }

            getContext()
                .getSharedPreferences(CAP_WEBVIEW_PREFS, Context.MODE_PRIVATE)
                .edit()
                .putString(CAP_SERVER_PATH, target.getAbsolutePath())
                .commit();

            prefs()
                .edit()
                .putInt(KEY_WEB_VERSION, version)
                .putInt(KEY_WEB_PENDING, version)
                .putInt(KEY_BOOT_ATTEMPTS, 0)
                .putInt(KEY_APK_BUILD, currentVersionCode())
                .commit();

            zip.delete();
            Log.i(TAG, "Staged web bundle " + version);
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "Could not stage the web bundle", e);
            deleteTree(target);
            call.reject("Could not unpack the web bundle");
        }
    }

    /**
     * The running app declaring that it started successfully.
     *
     * Until this arrives a staged bundle is on probation, and two launches
     * without it are read as "this bundle cannot start" — see load().
     */
    @PluginMethod
    public void confirmWebBundle(PluginCall call) {
        SharedPreferences prefs = prefs();
        int version = prefs.getInt(KEY_WEB_VERSION, 0);
        if (prefs.getInt(KEY_WEB_PENDING, 0) != 0) {
            prefs.edit().remove(KEY_WEB_PENDING).remove(KEY_BOOT_ATTEMPTS).commit();
            Log.i(TAG, "Web bundle " + version + " confirmed");
        }
        // Older bundles are dead weight once one has proven itself.
        pruneOldBundles(version);
        call.resolve();
    }

    /**
     * Switch the running app onto the staged bundle now, without waiting for a
     * cold start.
     *
     * This is the one place `setServerBasePath` is allowed. Staging refuses to
     * call it on purpose — an update must never replace the screen someone is
     * reading — but this method only runs because the user tapped a button
     * asking for exactly that, and the reload is the point rather than a side
     * effect.
     *
     * The call is resolved before the reload is posted: the WebView that made
     * it is about to be torn down, so a promise settled afterwards would be
     * settled into nothing and the JavaScript side would appear to hang.
     *
     * Probation is unaffected. The bundle stays pending until the reloaded app
     * calls confirmWebBundle() a few seconds in, exactly as it would after a
     * cold start; a bundle that cannot render still gets thrown away, just at
     * the next launch rather than this one, since load() does not re-run here.
     */
    @PluginMethod
    public void applyWebBundleNow(PluginCall call) {
        int staged = prefs().getInt(KEY_WEB_VERSION, 0);
        if (staged == 0 || staged <= runningWebVersion) {
            call.reject("There is no newer web bundle waiting");
            return;
        }

        String path = getContext()
            .getSharedPreferences(CAP_WEBVIEW_PREFS, Context.MODE_PRIVATE)
            .getString(CAP_SERVER_PATH, null);
        if (path == null || path.isEmpty() || !new File(path, "index.html").isFile()) {
            call.reject("The staged web bundle is missing");
            return;
        }

        final Bridge bridge = getBridge();
        if (bridge == null) {
            call.reject("The app is not ready to reload");
            return;
        }

        runningWebVersion = staged;
        Log.i(TAG, "Applying web bundle " + staged + " on request");
        call.resolve();

        bridge.getActivity().runOnUiThread(() -> {
            try {
                bridge.setServerBasePath(path);
            } catch (Exception e) {
                // Nothing to report to — the caller has already been resolved.
                // The bundle is still staged, so the next cold start takes it.
                Log.w(TAG, "Could not reload onto the staged bundle", e);
            }
        });
    }

    /** Go back to the web build inside the APK. */
    @PluginMethod
    public void revertWebBundle(PluginCall call) {
        clearWebBundle();
        call.resolve();
    }

    /**
     * Forget any staged bundle and delete it, leaving Capacitor to serve the
     * copy inside the APK.
     */
    private void clearWebBundle() {
        try {
            getContext()
                .getSharedPreferences(CAP_WEBVIEW_PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(CAP_SERVER_PATH)
                .commit();
            prefs().edit().clear().commit();
            deleteTree(new File(getContext().getFilesDir(), WEB_DIR));
            runningWebVersion = 0;
        } catch (Exception e) {
            Log.w(TAG, "Could not clear the staged web bundle", e);
        }
    }

    private void pruneOldBundles(int keepVersion) {
        File root = new File(getContext().getFilesDir(), WEB_DIR);
        File[] children = root.listFiles();
        if (children == null) return;
        for (File child : children) {
            if (!child.getName().equals(String.valueOf(keepVersion))) deleteTree(child);
        }
    }

    /** Where DownloadManager actually put a finished download. */
    private File downloadedFile(long id) {
        DownloadManager manager =
            (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return null;

        Cursor cursor = null;
        try {
            cursor = manager.query(new DownloadManager.Query().setFilterById(id));
            if (cursor == null || !cursor.moveToFirst()) return null;
            String local = cursor.getString(
                cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
            if (local == null) return null;
            // Asking rather than assuming the filename: DownloadManager renames
            // on collision, and a silently wrong path here would unpack a stale
            // bundle over a good one.
            String path = Uri.parse(local).getPath();
            return path == null ? null : new File(path);
        } catch (Exception e) {
            Log.w(TAG, "Could not locate the finished download", e);
            return null;
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    /**
     * Extract `zip` into `target`.
     *
     * Entry names are checked against the destination before anything is
     * written: a zip is just a list of paths, and one containing `../` would
     * otherwise write wherever it liked inside the app's private storage.
     */
    private void unzip(File zip, File target) throws Exception {
        String root = target.getCanonicalPath() + File.separator;
        byte[] buffer = new byte[16 * 1024];

        try (ZipInputStream in = new ZipInputStream(new FileInputStream(zip))) {
            ZipEntry entry;
            while ((entry = in.getNextEntry()) != null) {
                String name = entry.getName();
                // Archives built with `zip -r . ` carry a leading ./ on entries.
                if (name.startsWith("./")) name = name.substring(2);
                if (name.isEmpty()) continue;

                File out = new File(target, name);
                if (!out.getCanonicalPath().startsWith(root)) {
                    throw new SecurityException("Zip entry escapes the bundle: " + entry.getName());
                }

                if (entry.isDirectory()) {
                    out.mkdirs();
                    continue;
                }
                File parent = out.getParentFile();
                if (parent != null) parent.mkdirs();

                try (OutputStream fos = new FileOutputStream(out)) {
                    int read;
                    while ((read = in.read(buffer)) != -1) fos.write(buffer, 0, read);
                }
            }
        }
    }

    private void deleteTree(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteTree(child);
        }
        file.delete();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * The fingerprint of the native code in this APK, written in by
     * scripts/sync-android.sh. Empty when the resource is missing, which the
     * JavaScript side reads as "never apply a web bundle" — the safe direction.
     */
    private String nativeHash() {
        try {
            Context context = getContext();
            int id = context.getResources().getIdentifier(
                "covault_native_hash", "string", context.getPackageName());
            return id == 0 ? "" : context.getString(id);
        } catch (Exception e) {
            Log.w(TAG, "Could not read the native fingerprint", e);
            return "";
        }
    }

    private int currentVersionCode() {
        try {
            Context context = getContext();
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                return (int) info.getLongVersionCode();
            }
            return info.versionCode;
        } catch (Exception e) {
            Log.w(TAG, "Could not read the installed version", e);
            return 0;
        }
    }

    private boolean canRequestInstalls() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        try {
            return getContext().getPackageManager().canRequestPackageInstalls();
        } catch (Exception e) {
            Log.w(TAG, "Could not read install permission", e);
            return false;
        }
    }

    private JSObject progress(String status, int percent) {
        JSObject result = new JSObject();
        result.put("status", status);
        result.put("percent", Math.max(0, Math.min(100, percent)));
        return result;
    }

    /** Rejects the call and returns null when the id is missing or unparseable. */
    private Long parseId(PluginCall call) {
        String raw = call.getString("id");
        if (raw == null || raw.isEmpty()) {
            call.reject("No download id supplied");
            return null;
        }
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            call.reject("Invalid download id");
            return null;
        }
    }
}
