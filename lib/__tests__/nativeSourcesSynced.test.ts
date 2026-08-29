import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every Java file in android-custom/ has to reach the generated Android
 * project, and every class MainActivity names has to exist.
 *
 * The android/ directory is thrown away and recreated by CI, so
 * scripts/sync-android.sh is the only route custom native source takes into a
 * build. It used to copy a hand-written list of filenames, and a new plugin
 * (CovaultWidgetPlugin) was added and registered in MainActivity without being
 * added to that list — the web build, the type-check and the tests all passed,
 * and the APK step then failed with "cannot find symbol" two minutes in. That
 * failure is invisible from anywhere else in this repo, so it is pinned here.
 */

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const syncScript = read('scripts/sync-android.sh');
const mainActivity = read('android-custom/MainActivity.java');
const javaFiles = readdirSync(resolve(root, 'android-custom')).filter((f) => f.endsWith('.java'));

describe('the custom Java sources', () => {
  it('are copied as a whole directory, not a hand-kept list', () => {
    // A glob cannot fall behind the directory; a list of names can, and did.
    expect(syncScript).toContain('for f in "$CUSTOM_DIR"/*.java; do');
    expect(syncScript).toContain('cp -v "$f" "$JAVA_DIR/"');
  });

  it('fail the sync loudly if none are found', () => {
    // A silent empty copy would produce an Android project with no MainActivity
    // and a Gradle error far from the cause.
    expect(syncScript).toContain('no Java sources found');
  });

  it('are all present to copy', () => {
    expect(javaFiles.length).toBeGreaterThan(0);
    expect(javaFiles).toContain('MainActivity.java');
  });
});

describe('MainActivity', () => {
  it('only registers plugins whose source exists', () => {
    const registered = [...mainActivity.matchAll(/registerPlugin\(\s*(\w+)\.class\s*\)/g)].map(
      (m) => m[1],
    );
    expect(registered.length).toBeGreaterThan(0);
    for (const cls of registered) {
      expect(javaFiles, `${cls} is registered but android-custom/${cls}.java is missing`).toContain(
        `${cls}.java`,
      );
    }
  });
});
