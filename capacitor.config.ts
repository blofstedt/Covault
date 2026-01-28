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
    webContentsDebuggingEnabled: false
  }
};

export default config;
