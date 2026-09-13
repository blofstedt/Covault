import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// A plain .mjs build script, deliberately not typed — the assertions below
// narrow what comes back.
import { toPlayManifest, bankingPackages, PLAY_FORBIDDEN_PERMISSIONS } from '../../scripts/play-manifest.mjs';

/**
 * Covault ships two ways and the manifest cannot serve both.
 *
 * A sideloaded APK updates itself and discovers banking apps by looking at
 * what is installed. Google Play forbids both: an app that installs packages,
 * and one that can see every package on the phone, are each a policy violation
 * on their own. So the Play artifact is built from a transformed manifest.
 *
 * Nothing in CI builds an Android artifact from this, so what is checked here
 * is the transform itself, against the real manifest: that it removes exactly
 * the five permissions and not one more, that what replaces the blunt one is
 * built from the app's own list of banks, and that a permission which has
 * moved or been renamed fails loudly rather than shipping.
 */

const MANIFEST = readFileSync(
  resolve(__dirname, '../../android-custom/AndroidManifest.xml'),
  'utf8',
);

describe('the Play manifest', () => {
  const played: string = toPlayManifest(MANIFEST);

  it('removes every permission Play will not accept', () => {
    for (const permission of PLAY_FORBIDDEN_PERMISSIONS as string[]) {
      expect(played, `${permission} would have the upload rejected`)
        .not.toContain(`<uses-permission android:name="${permission}"`);
    }
  });

  it('keeps every permission capture actually depends on', () => {
    // The failure this guards is silent and total: a build that posts no
    // notifications, or one Android stops after a reboot, looks exactly like
    // the capture feature being broken.
    for (const kept of [
      'android.permission.INTERNET',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
      'android.permission.RECEIVE_BOOT_COMPLETED',
    ]) {
      expect(played, `${kept} is load-bearing and must survive`).toContain(kept);
    }
  });

  it('leaves the listener service itself alone', () => {
    // Everything else in the manifest — the service, the activities, the
    // widget provider — has to come through untouched, or the Play build is a
    // different app rather than the same one distributed differently.
    expect(played).toContain('NotificationListener');
    expect(played).toContain('CovaultWidgetProvider');
  });

  it('replaces blanket package visibility with the banks the app knows', () => {
    expect(played).toContain('<queries>');
    const banks = bankingPackages() as string[];
    expect(banks.length).toBeGreaterThan(100);
    // A few the household actually uses, so this cannot pass on an empty list.
    for (const bank of ['com.rbc.mobile.android', 'com.bmo.mobile']) {
      expect(banks).toContain(bank);
      expect(played).toContain(`<package android:name="${bank}" />`);
    }
    // And the mail apps, since a bank that only emails is captured through one.
    expect(played).toContain('<package android:name="com.google.android.gm" />');
  });

  it('fails loudly if a permission it means to remove has moved', () => {
    // Silence here would mean a Play upload carrying REQUEST_INSTALL_PACKAGES,
    // which is rejected, or QUERY_ALL_PACKAGES, which needs a declaration
    // Covault cannot honestly make.
    const withoutOne = MANIFEST.replace(
      /[ \t]*<uses-permission android:name="android\.permission\.REQUEST_INSTALL_PACKAGES"[^>]*\/>\n/,
      '',
    );
    expect(() => toPlayManifest(withoutOne)).toThrow(/REQUEST_INSTALL_PACKAGES/);
  });

  it('is opt-in, so the sideload APK build cannot pick it up by accident', () => {
    const sync = readFileSync(resolve(__dirname, '../../scripts/sync-android.sh'), 'utf8');
    expect(sync).toContain('COVAULT_DISTRIBUTION:-sideload');
    const apkWorkflow = readFileSync(
      resolve(__dirname, '../../.github/workflows/build-android.yml'), 'utf8');
    expect(apkWorkflow, 'the APK workflow must not build a Play manifest')
      .not.toContain('COVAULT_DISTRIBUTION');
    const aabWorkflow = readFileSync(
      resolve(__dirname, '../../.github/workflows/build-android-release.yml'), 'utf8');
    expect(aabWorkflow).toContain('COVAULT_DISTRIBUTION: play');
  });
});
