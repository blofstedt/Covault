package com.covault.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CovaultNotificationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
