import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A Play-Store-installed copy of Covault must never fetch or install a
 * GitHub-built APK over itself — Play App Signing re-signs the Store's copy
 * with a key this build doesn't have, so the install would fail outright as
 * a signature mismatch, and Play Store policy reserves APK updates for the
 * Store itself regardless. The web-bundle OTA path is unaffected either
 * way, since it never touches the installed APK's identity.
 *
 * Three files have to agree for this to hold, and the failure mode of any
 * one drifting is silent — a build that quietly starts fetching APKs on
 * Play-Store phones again, or a build that never notices installedFromPlayStore
 * even exists.
 */

const root = resolve(__dirname, '../..');
const plugin = readFileSync(resolve(root, 'android-custom/CovaultUpdaterPlugin.java'), 'utf8');
const bridge = readFileSync(resolve(root, 'lib/covaultUpdater.ts'), 'utf8');
const hook = readFileSync(resolve(root, 'lib/hooks/useAppUpdate.ts'), 'utf8');

describe('the Play Store install-source check', () => {
  it('is reported by the native plugin, keyed on the Play Store package', () => {
    expect(plugin).toContain('installedFromPlayStore');
    expect(plugin).toContain('com.android.vending');
    // Reported as part of getStatus(), not a separate call the JS side could
    // forget to make.
    const getStatus = plugin.indexOf('public void getStatus');
    const reported = plugin.indexOf('"installedFromPlayStore"');
    expect(getStatus).toBeGreaterThan(-1);
    expect(reported).toBeGreaterThan(getStatus);
  });

  it('is declared on the TS bridge', () => {
    expect(bridge).toContain('installedFromPlayStore');
  });

  it('gates fetchApkUpdate but not the web-bundle path', () => {
    const webStage = hook.indexOf('void stageWebUpdate(');
    const playCheck = hook.indexOf('status?.installedFromPlayStore');
    const apkFetch = hook.indexOf('void fetchApkUpdate(');
    expect(webStage).toBeGreaterThan(-1);
    expect(playCheck).toBeGreaterThan(-1);
    expect(apkFetch).toBeGreaterThan(-1);
    // The web-bundle branch returns before the Play Store check is ever
    // reached, so a JS-only update still applies on a Play-Store phone.
    expect(webStage).toBeLessThan(playCheck);
    // The Play Store check sits between selecting the update and fetching
    // the APK for it, so it actually gates that call rather than running
    // alongside it unused.
    expect(playCheck).toBeLessThan(apkFetch);
  });
});
