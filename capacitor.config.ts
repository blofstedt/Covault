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
    // An https page may not pull http subresources. This was true, which
    // together with usesCleartextTraffic in the manifest meant a page served
    // over https could still be fed plain-http content. Nothing in the app
    // loads over http, so turning it off costs nothing.
    allowMixedContent: false,
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
