package com.covault.app;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * Downloads a new Covault APK and hands it to Android's package installer.
 *
 * Deliberately dumb: every method returns immediately and the JavaScript side
 * drives the sequence (start → poll → install). The alternative — one native
 * method that blocks until the download finishes — means holding a PluginCall
 * across minutes of radio time, which is exactly the shape that breaks when the
 * activity is recreated mid-download. Polling costs a timer in JS and nothing
 * else.
 *
 * The download lands in the app's own external files directory, so it needs no
 * storage permission and is removed with the app. DownloadManager hands back a
 * content:// URI for it, which is what the installer will accept — a file://
 * URI throws FileUriExposedException on anything modern.
 */
@CapacitorPlugin(name = "CovaultUpdater")
public class CovaultUpdaterPlugin extends Plugin {

    private static final String TAG = "CovaultUpdater";
    private static final String APK_NAME = "covault-update.apk";
    private static final String APK_MIME = "application/vnd.android.package-archive";

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

        Context context = getContext();
        File target = new File(context.getExternalFilesDir(null), APK_NAME);
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

            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Covault update");
            request.setDescription("Downloading the new version");
            request.setMimeType(APK_MIME);
            request.setDestinationInExternalFilesDir(context, null, APK_NAME);
            request.setNotificationVisibility(
                DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);

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
