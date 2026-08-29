package com.covault.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The one-tap route to the home-screen widget.
 *
 * Long-press-and-drag is how a widget has always been added, and most people
 * never learn it exists — there is nothing in the app that says "there is a
 * widget" or shows what it looks like. {@link AppWidgetManager#requestPinAppWidget}
 * is the platform's own shortcut for exactly this: an app asks the launcher to
 * place one of its widgets, the launcher shows its own confirmation, and the
 * user never has to know where the widget drawer is.
 *
 * Two things can stop it that have nothing to do with Covault: the API is
 * Android 8.0 (O) and up, and honouring the request is the launcher's choice,
 * not a guarantee — {@link AppWidgetManager#isRequestPinAppWidgetSupported}
 * says whether this one will. Settings checks that first and falls back to
 * written instructions when it says no — the same route that has always
 * existed and still works everywhere, including below O where the whole class
 * this plugin calls into does not exist.
 */
@CapacitorPlugin(name = "CovaultWidget")
public class CovaultWidgetPlugin extends Plugin {

    private static final String TAG = "CovaultWidgetPlugin";

    /**
     * Whether this Android version and this launcher can be asked at all.
     *
     * A pure read with no side effect, so the UI can decide what to show
     * before it commits to anything — the button, or the manual steps.
     */
    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", supported());
        call.resolve(result);
    }

    /**
     * Ask the launcher to place the widget.
     *
     * Resolves rather than rejects even when nothing could be asked — the
     * caller is expected to have checked {@link #isSupported} already, and a
     * `false` here is still an ordinary outcome, not an exception.
     *
     * `requested: true` means the launcher accepted the request and is
     * showing its own placement UI. It is not proof the user finished placing
     * it — nothing on this side can see past the request, the same way the
     * restricted-settings unlock elsewhere in this app cannot see past being
     * sent there. The launcher's own screen is the confirmation.
     */
    @PluginMethod
    public void requestPin(PluginCall call) {
        JSObject result = new JSObject();

        if (!supported()) {
            result.put("requested", false);
            call.resolve(result);
            return;
        }

        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(getContext());
            ComponentName provider =
                new ComponentName(getContext(), CovaultWidgetProvider.class);
            // No extras and no success callback: the launcher's own placement
            // screen is the only confirmation this needs, and pairing a
            // PendingIntent to a request the user might cancel or dismiss is
            // a second source of truth the UI would have to reconcile with
            // the first.
            boolean requested = manager.requestPinAppWidget(provider, null, null);
            result.put("requested", requested);
            call.resolve(result);
        } catch (Exception e) {
            // An OEM launcher that advertised support and then threw anyway.
            // The written instructions still work, so this is not reported as
            // an error — it resolves the same as a plain refusal.
            Log.w(TAG, "Could not request the widget pin", e);
            result.put("requested", false);
            call.resolve(result);
        }
    }

    private boolean supported() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(getContext());
            return manager != null && manager.isRequestPinAppWidgetSupported();
        } catch (Exception e) {
            Log.w(TAG, "Could not read pin support", e);
            return false;
        }
    }
}
