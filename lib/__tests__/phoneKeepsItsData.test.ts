/**
 * The Android-side findings from the same security review.
 *
 * All three were platform defaults, which is what made them easy to miss: the
 * manifest said nothing unusual, and nothing about the app behaved differently
 * either way.
 *
 * allowBackup is the one that matters. It was "true", and the Supabase session
 * — refresh token included, a long-lived credential — lives in the WebView's
 * localStorage inside the app's data directory. That directory is exactly what
 * Android auto-backup copies to the user's Google Drive and what `adb backup`
 * pulls off the device, so the household's sign-in was leaving the phone
 * through a channel nobody had looked at. Nothing is lost by refusing: signing
 * in restores every budget, limit and transaction from Supabase.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const manifest = readFileSync(resolve(ROOT, 'android-custom/AndroidManifest.xml'), 'utf8');

describe('the phone does not hand the session to a backup', () => {
  it('refuses cloud backup outright', () => {
    expect(manifest).toContain('android:allowBackup="false"');
  });

  it('names both rules files', () => {
    // dataExtractionRules is NOT redundant with allowBackup: on Android 12+
    // device-to-device transfer is governed separately, so switching backup
    // off alone still carries the token to a new phone.
    expect(manifest).toContain('android:fullBackupContent="@xml/backup_rules"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
  });

  it.each(['backup_rules', 'data_extraction_rules'])('%s excludes every domain', (name) => {
    const xml = readFileSync(resolve(ROOT, `android-custom/res/xml/${name}.xml`), 'utf8');
    for (const domain of ['root', 'file', 'database', 'sharedpref', 'external']) {
      expect(xml).toContain(`<exclude domain="${domain}" />`);
    }
  });

  it('the sync script copies them, and fails if it cannot', () => {
    // The manifest names both by resource id, so a missing file has to be a
    // build failure — a silent fallback here means backing everything up.
    const sync = readFileSync(resolve(ROOT, 'scripts/sync-android.sh'), 'utf8');
    for (const name of ['backup_rules.xml', 'data_extraction_rules.xml']) {
      expect(sync).toContain(`res/xml/${name}" "$RES_DIR/xml/"`);
      expect(sync).toContain(`"$RES_DIR/xml/${name}"`);
    }
  });
});

describe('nothing is fetched in the clear', () => {
  it('the manifest refuses cleartext', () => {
    expect(manifest).toContain('android:usesCleartextTraffic="false"');
    expect(manifest).not.toContain('android:usesCleartextTraffic="true"');
  });

  it('an https page may not pull http subresources', () => {
    const capacitor = readFileSync(resolve(ROOT, 'capacitor.config.ts'), 'utf8');
    expect(capacitor).toContain('allowMixedContent: false');
    // The WebView itself is served over https, which is what makes the above
    // free rather than a restriction.
    expect(capacitor).toContain("androidScheme: 'https'");
  });
});

describe('permissions the app does not use are not asked for', () => {
  it.each([
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  ])('%s is gone', (permission) => {
    // This app has never started a foreground service — a
    // NotificationListenerService is bound by the system, and nothing in
    // android-custom/ calls startForeground. FOREGROUND_SERVICE_SPECIAL_USE
    // additionally needs a written justification at upload for a service that
    // does not exist.
    expect(manifest).not.toContain(`<uses-permission android:name="${permission}" />`);
  });

  it('the listener and its reboot restart are untouched', () => {
    // The point was to remove two permissions nothing used, not to touch
    // capture. Losing either of these stops purchases arriving.
    expect(manifest).toContain('android.permission.RECEIVE_BOOT_COMPLETED');
    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(manifest).toContain('android.service.notification.NotificationListenerService');
  });
});

describe('no client-side unlock keyed to a string in the bundle', () => {
  it('VITE_ADMIN_EMAIL is not read anywhere', () => {
    // It named an email address that was always granted premium access. The
    // value would have been readable by anyone who downloaded the app.
    const entitlement = readFileSync(resolve(ROOT, 'lib/entitlement.ts'), 'utf8');
    expect(entitlement).not.toContain('ADMIN_EMAIL');
    const vite = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8');
    expect(vite).not.toContain('VITE_ADMIN_EMAIL');
  });
});
