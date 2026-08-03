#!/usr/bin/env node
//
// Prints a short fingerprint of everything that only a new APK can change.
//
// Background web updates replace the web layer on the phone without
// reinstalling. That is only safe while the web code is talking to the same
// native code it was built against — ship a web bundle that calls a plugin
// method the installed APK has never heard of and the app breaks in a way no
// test here would catch.
//
// So each web bundle is published under the fingerprint of the native side it
// was built with, and the app only applies a bundle whose fingerprint matches
// its own. When they differ the update simply falls through to the ordinary
// "new version is ready" prompt, which installs a new APK — correct by
// construction rather than by anyone remembering.
//
// Used twice: scripts/sync-android.sh bakes the value into the APK as a string
// resource, and CI names the web bundle with it.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every file under `dir`, depth-first, in a stable order. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const hash = createHash('sha256');

// The custom native source: Java, the manifest, and the resources they name.
for (const file of walk(join(root, 'android-custom'))) {
  // Path as well as content, so a rename counts as a change.
  hash.update(relative(root, file).split(sep).join('/'));
  hash.update(readFileSync(file));
}

// The native shell's own configuration.
hash.update(readFileSync(join(root, 'capacitor.config.ts')));

// Plugin versions, because a Capacitor plugin is native code too. Deliberately
// not the whole dependency list — bumping React does not change what the APK
// can do, and forcing a full reinstall for it would waste the mechanism.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const nativeDeps = Object.entries(pkg.dependencies ?? {})
  .filter(([name]) => name.startsWith('@capacitor/') || name.startsWith('@aparajita/'))
  .sort(([a], [b]) => a.localeCompare(b));
for (const [name, version] of nativeDeps) hash.update(`${name}@${version}`);

process.stdout.write(hash.digest('hex').slice(0, 12));
