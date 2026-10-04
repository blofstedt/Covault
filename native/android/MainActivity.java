package com.covault.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CovaultNotificationPlugin.class);
        registerPlugin(CovaultUpdaterPlugin.class);
        registerPlugin(CovaultWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        // Belt and braces. BridgeActivity.load() already routes the launch
        // intent through onNewIntent below, so this is normally a no-op —
        // stashRoute clears the extra it consumes, so running twice cannot
        // double-stash. It's here so the routing doesn't silently die if a
        // future Capacitor version stops doing that.
        stashRoute(getIntent());
    }

    /**
     * The activity is singleTask, so a tap while Covault is already running
     * arrives here rather than through onCreate. BridgeActivity also calls
     * this with the launch intent from its own onCreate, which is how a cold
     * start gets handled.
     *
     * Kept `protected` to match BridgeActivity.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        stashRoute(intent);
    }

    /**
     * Park a tapped notification's destination where the WebView can collect it.
     *
     * It has to go through SharedPreferences rather than straight to JS: on a
     * cold start there is no WebView yet when this runs, so an event would be
     * emitted to nobody. The JS side drains it on launch and on resume via
     * CovaultNotificationPlugin.consumePendingRoute, which clears it — so a
     * route is honoured exactly once and a later ordinary launch doesn't
     * re-navigate the user somewhere they didn't ask to go.
     */
    private void stashRoute(Intent intent) {
        if (intent == null) return;
        String route = intent.getStringExtra(NotificationListener.ROUTE_EXTRA);
        if (route == null || route.isEmpty()) return;
        // Clear it from the intent as well, so a configuration change that
        // re-delivers the same intent doesn't re-arm the navigation.
        intent.removeExtra(NotificationListener.ROUTE_EXTRA);
        getSharedPreferences("covault_prefs", 0)
            .edit()
            .putString(NotificationListener.PENDING_ROUTE_KEY, route)
            .commit();
    }
}
