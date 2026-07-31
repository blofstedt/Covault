import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.covault.app',
  appName: 'Covault',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {},
  android: {
    allowMixedContent: true,
    captureInput: true,
    // Gated rather than hardcoded off. With this false there is no way to
    // attach chrome://inspect to the APK, which means nothing visual or
    // performance-related can ever be measured on a real device — every past
    // attempt at the budget-expand jank was a guess for exactly that reason.
    //
    // Note this is read by `cap sync`, which is a SEPARATE process from
    // `vite build` — vite setting NODE_ENV=production for itself does not
    // reach here. CI (.github/workflows/build-android.yml) only ever runs
    // `assembleDebug`, so today this is effectively always on. To produce a
    // locked-down APK the sync step itself must be run as
    // `NODE_ENV=production npx cap sync android`.
    webContentsDebuggingEnabled: process.env.NODE_ENV !== 'production'
  }
};

export default config;
