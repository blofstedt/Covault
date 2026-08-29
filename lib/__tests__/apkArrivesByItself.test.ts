import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * An update that needs a new APK used to be the one the user had to work for.
 *
 * The web route takes itself: fetched quietly, unpacked, running by the next
 * launch, nobody told. The APK route did none of that. It waited for a tap,
 * THEN started downloading, then showed a progress bar the user had to keep the
 * app open for, and only then reached Android's confirmation — so the update
 * that matters most, the one carrying every change to capture and the widget,
 * was the one most likely to be put off.
 *
 * Both halves are moved off the user now. The APK is fetched the moment it is
 * found, in the background and out of the notification shade; and when the app
 * goes to the background, Covault asks Android to replace itself with it.
 * Android allows that without a confirmation for an app updating itself once it
 * is its own installer of record — so the first one still asks, and after that
 * they land on their own.
 *
 * What cannot be tested here is any of it: nothing in CI installs an APK, and
 * whether the OS honours the quiet request is the OS's decision on the day.
 * What is pinned is the shape — that the download does not wait for a tap, that
 * the quiet attempt only happens where being killed costs nothing, and that
 * every refusal lands back on the route that already worked.
 */
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf-8');

const hook = read('lib/hooks/useAppUpdate.ts');
const plugin = read('android-custom/CovaultUpdaterPlugin.java');
const banner = read('components/UpdateBanner.tsx');
const bridge = read('lib/covaultUpdater.ts');
const manifest = read('android-custom/AndroidManifest.xml');

describe('the APK arrives before it is asked for', () => {
  it('starts the download from the check, not from the tap', () => {
    const check = hook.slice(hook.indexOf('const check = useCallback'), hook.indexOf('useEffect(() => {\n    // Opening the app'));
    expect(check).toContain('fetchApkUpdate(next.versionCode, next.apkUrl)');
  });

  it('downloads it even when the pill has been waved away', () => {
    // Dismissing means "stop telling me", not "stay on the old build" — and
    // with the quiet install behind it, that distinction is the feature.
    const check = hook.slice(hook.indexOf('const check = useCallback'));
    const fetched = check.indexOf('fetchApkUpdate(next.versionCode');
    const dismissed = check.indexOf('readNumber(DISMISSED_KEY) === next.versionCode');
    expect(fetched).toBeGreaterThan(-1);
    expect(dismissed).toBeGreaterThan(fetched);
  });

  it('keeps it out of the notification shade', () => {
    // Nobody asked for this download and nobody is waiting on it.
    expect(hook).toContain('quiet: true');
    expect(plugin).toContain('call.getBoolean("quiet"');
    expect(bridge).toContain('quiet?: boolean');
  });

  it('remembers it across launches', () => {
    // The download happens when the update is noticed; the install happens the
    // next time the app is backgrounded, which can be days and several launches
    // later.
    expect(hook).toContain("const APK_READY_KEY = 'covault_update_apk_ready'");
    expect(hook).toContain('writeReadyApk(');
  });

  it('forgets it once the phone is running that version', () => {
    // Otherwise the pill offers an update the app already has.
    expect(hook).toContain('apkVersion >= readyApk.current.version');
  });
});

describe('the quiet install', () => {
  it('is only attempted as the app goes to the background', () => {
    // A self-update replaces the process. In the foreground that is the app
    // closing in the user's hands mid-sentence; on pause it is invisible.
    expect(hook).toContain("CapApp.addListener('pause'");
    const paused = hook.slice(hook.indexOf("CapApp.addListener('pause'"));
    expect(paused.slice(0, 120)).toContain('installQuietly()');
  });

  it('asks Android to skip the confirmation, and accepts being told no', () => {
    expect(plugin).toContain('USER_ACTION_NOT_REQUIRED');
    expect(plugin).toContain('STATUS_PENDING_USER_ACTION');
  });

  it('declares the permission without which the request is ignored in silence', () => {
    // The half that is easy to lose: without it Android drops
    // USER_ACTION_NOT_REQUIRED on the floor and every update quietly goes back
    // to the confirmation screen — which still works, so nothing looks broken.
    expect(manifest).toContain('android.permission.UPDATE_PACKAGES_WITHOUT_USER_ACTION');
    expect(manifest).toContain('android.permission.REQUEST_INSTALL_PACKAGES');
  });

  it('does not throw an installer screen at someone who is in another app', () => {
    // Android answers a committed session with PENDING_USER_ACTION when it
    // wants the user asked. Starting an activity from the background is both
    // blocked and rude; the pill is still there next launch.
    const receiver = plugin.slice(
      plugin.indexOf('installResultReceiver = new BroadcastReceiver'),
      plugin.indexOf('IntentFilter filter'),
    );
    expect(receiver).toContain('STATUS_PENDING_USER_ACTION');
    expect(receiver).not.toContain('startActivity');
  });

  it('leaves the phone exactly as it was when it cannot commit', () => {
    // The APK stays on disk and the tap route still works, so a refusal costs
    // nothing at all.
    const quiet = plugin.slice(
      plugin.indexOf('private boolean installWithoutPrompt'),
      plugin.indexOf('public void install(PluginCall call)'),
    );
    expect(quiet).toContain('abandonSession');
    expect(quiet).toContain('return false');
  });

  it('is refused outright below Android 12', () => {
    const quiet = plugin.slice(plugin.indexOf('private boolean installWithoutPrompt'));
    expect(quiet.slice(0, 400)).toContain('Build.VERSION_CODES.S');
  });

  it('cleans up after a refusal instead of stacking sessions', () => {
    // A refused session stays open, and an app gets only so many before
    // createSession starts throwing — so an update refused on every launch
    // would eventually break the quiet route for good.
    const receiver = plugin.slice(
      plugin.indexOf('installResultReceiver = new BroadcastReceiver'),
      plugin.indexOf('IntentFilter filter'),
    );
    expect(receiver).toContain('abandonSession(');
  });

  it('asks once per build rather than once per launch', () => {
    // Whatever made Android say no is still true this evening. The record is
    // kept against a versionCode, so a new build gets a fresh attempt.
    expect(plugin).toContain('KEY_QUIET_REFUSED_BUILD');
    const status = plugin.slice(
      plugin.indexOf('public void getStatus(PluginCall call)'),
      plugin.indexOf('public void openInstallSettings'),
    );
    expect(status).toContain('KEY_QUIET_REFUSED_BUILD');
  });

  it('is never asked for on a build that would misread the flag', () => {
    // An older plugin reads install({silent:true}) as an ordinary install and
    // opens the system installer — on top of whatever the user switched to.
    expect(plugin).toContain('quietInstallSupported');
    expect(hook).toContain('if (!quietInstallSupported) return;');
  });

  it('needs the install permission like every other route', () => {
    const install = plugin.slice(
      plugin.indexOf('public void install(PluginCall call)'),
      plugin.indexOf('public void stageWebBundle'),
    );
    const permission = install.indexOf('canRequestInstalls()');
    const silent = install.indexOf('call.getBoolean("silent"');
    expect(permission).toBeGreaterThan(-1);
    expect(silent).toBeGreaterThan(permission);
  });
});

describe('the tap, where one is still needed', () => {
  it('goes straight to the installer when the APK is already here', () => {
    const install = hook.slice(hook.indexOf('const install = useCallback'));
    const ready = install.indexOf('ready.version === target.versionCode');
    const download = install.indexOf('covaultUpdater.startDownload({ url: target.apkUrl })');
    expect(ready).toBeGreaterThan(-1);
    expect(download).toBeGreaterThan(ready);
  });

  it('falls back to downloading again if the record has gone stale', () => {
    // A download row cleared out of the system UI looks exactly like this.
    const install = hook.slice(hook.indexOf('const install = useCallback'));
    expect(install).toContain('writeReadyApk(null)');
  });

  it('says so on the pill rather than promising a wait that has happened', () => {
    expect(banner).toContain('apkReady === update.versionCode');
    expect(banner).toContain("'Install'");
  });

  it('keeps the confirmation route untouched', () => {
    // The proven path. Everything above is allowed to fail back to it.
    expect(plugin).toContain('Intent intent = new Intent(Intent.ACTION_VIEW)');
    expect(plugin).toContain('APK_MIME');
  });
});
