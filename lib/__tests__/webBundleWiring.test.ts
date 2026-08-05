import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWebBundleName } from '../appUpdate';

/**
 * A background web update is four files agreeing with each other across three
 * languages, and every way they can disagree is silent.
 *
 * CI names the bundle, the app parses that name, the sync script writes the
 * fingerprint into the APK, the Java reads it back, and the Java writes the
 * preference that Capacitor itself reads at startup. Break any link and the
 * app does not error — it just quietly stops updating itself, or worse, keeps
 * pointing at a bundle it should have abandoned. Nothing else in the repo would
 * notice, so it is pinned here.
 */

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const workflow = read('.github/workflows/build-android.yml');
const syncScript = read('scripts/sync-android.sh');
const plugin = read('android-custom/CovaultUpdaterPlugin.java');

describe('the published bundle name', () => {
  it('is the shape the app parses', () => {
    // Reproduce what the workflow builds, with a plausible hash.
    expect(workflow).toContain('WEB_BUNDLE="covault-web-${NATIVE_HASH}.zip"');
    expect(parseWebBundleName('covault-web-0123456789ab.zip')).toBe('0123456789ab');
  });

  it('is attached to the release, not just built', () => {
    expect(workflow).toContain('"$WEB_BUNDLE"');
  });

  it('is named with the same script the APK is fingerprinted with', () => {
    expect(workflow).toContain('node scripts/native-hash.mjs');
    expect(syncScript).toContain('native-hash.mjs');
  });
});

describe('the native fingerprint', () => {
  it('is written under the name the plugin reads', () => {
    expect(syncScript).toContain('name="covault_native_hash"');
    expect(plugin).toContain('"covault_native_hash"');
  });
});

describe('the handover to Capacitor', () => {
  // Staging writes Capacitor's own preference rather than calling
  // setServerBasePath, so that the new bundle is picked up at the next cold
  // start instead of reloading the app under the user. (The one exception is
  // the user tapping Restart — see the block below.) That means depending on
  // two constants inside the dependency, which a Capacitor upgrade could
  // rename without any build error here.
  const capacitorWebView = readFileSync(
    resolve(
      root,
      'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/plugin/WebView.java',
    ),
    'utf8',
  );

  it('uses the preferences file Capacitor reads at startup', () => {
    expect(capacitorWebView).toContain('WEBVIEW_PREFS_NAME = "CapWebViewSettings"');
    expect(plugin).toContain('CAP_WEBVIEW_PREFS = "CapWebViewSettings"');
  });

  it('uses the key Capacitor reads at startup', () => {
    expect(capacitorWebView).toContain('CAP_SERVER_PATH = "serverBasePath"');
    expect(plugin).toContain('CAP_SERVER_PATH = "serverBasePath"');
  });
});

describe('applying a downloaded bundle without a cold start', () => {
  // A staged bundle arrives on its own at the next cold start. The Restart
  // button exists so that someone waiting on a fix does not have to swipe the
  // app away to get it, and it is another three-language agreement: the Java
  // method name, the TypeScript declaration of it, and the pair of version
  // numbers the pill decides on. Any of them can drift in silence.
  const hook = read('lib/hooks/useAppUpdate.ts');
  const bridgeTs = read('lib/covaultUpdater.ts');

  it('is offered by the same method name on both sides', () => {
    expect(plugin).toContain('public void applyWebBundleNow');
    expect(bridgeTs).toContain('applyWebBundleNow()');
    expect(hook).toContain('applyWebBundleNow()');
  });

  it('reports what is on disk and what is running as separate numbers', () => {
    // Equal numbers mean nothing is waiting. Reporting only the stored version
    // — which staging updates immediately — would say the new build is already
    // running and the pill would never appear.
    expect(plugin).toContain('"stagedWebVersion"');
    expect(plugin).toContain('"runningWebVersion"');
    expect(bridgeTs).toContain('stagedWebVersion');
    expect(bridgeTs).toContain('runningWebVersion');
    expect(hook).toContain('status.stagedWebVersion > status.runningWebVersion');
  });

  it('reloads through the Capacitor call that still exists', () => {
    const bridge = readFileSync(
      resolve(
        root,
        'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java',
      ),
      'utf8',
    );
    expect(bridge).toContain('public void setServerBasePath(String path)');
    expect(plugin).toContain('bridge.setServerBasePath(path)');
  });

  it('answers the caller before replacing the WebView that called it', () => {
    // The page making the call is torn down by the reload, so a promise
    // resolved afterwards is resolved into nothing and the button hangs.
    const method = plugin.slice(plugin.indexOf('public void applyWebBundleNow'));
    const resolved = method.indexOf('call.resolve()');
    const reloaded = method.indexOf('setServerBasePath');
    expect(resolved).toBeGreaterThan(-1);
    expect(reloaded).toBeGreaterThan(-1);
    expect(resolved).toBeLessThan(reloaded);
  });
});

describe('the rollback', () => {
  it('runs before Capacitor decides where to serve the app from', () => {
    // Capacitor registers plugins (calling load()) and only then reads the
    // stored server path, which is what lets load() veto a bad bundle. If a
    // Capacitor upgrade swaps those two steps, a broken bundle would boot once
    // more before being caught.
    const bridge = readFileSync(
      resolve(
        root,
        'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java',
      ),
      'utf8',
    );
    const registerPlugins = bridge.indexOf('this.registerAllPlugins();');
    const loadWebView = bridge.indexOf('this.loadWebView();');
    expect(registerPlugins).toBeGreaterThan(-1);
    expect(loadWebView).toBeGreaterThan(-1);
    expect(registerPlugins).toBeLessThan(loadWebView);
  });

  it('gives a staged bundle a bounded number of tries', () => {
    expect(plugin).toMatch(/MAX_UNCONFIRMED_LAUNCHES\s*=\s*[1-9]/);
    expect(plugin).toContain('clearWebBundle()');
  });

  it('is armed by the app confirming a launch, not by anything automatic', () => {
    // If nothing ever calls confirmWebBundle, every bundle looks broken and
    // the mechanism silently reverts to the APK build forever.
    const hook = read('lib/hooks/useAppUpdate.ts');
    expect(hook).toContain('confirmWebBundle()');
    expect(plugin).toContain('public void confirmWebBundle');
  });

  it('refuses a bundle with no entry point', () => {
    expect(plugin).toContain('index.html');
  });

  it('refuses a zip that writes outside its own directory', () => {
    expect(plugin).toContain('SecurityException');
  });
});
