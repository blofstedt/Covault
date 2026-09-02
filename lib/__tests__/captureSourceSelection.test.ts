import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
const storage = new MemoryStorage();
vi.stubGlobal('localStorage', storage);

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: vi.fn(),
}));

import {
  allowedSourceKind,
  buildSourceOptions,
  captureSourceKind,
  defaultSourcesFor,
  getSelectedSources,
  hasChosenSources,
  isCaptureSourceAllowed,
  KNOWN_EMAIL_APPS,
  normalizePackage,
  setSelectedSources,
  setSourceSelected,
} from '../captureSources';
import { EXCLUDED_APPS, KNOWN_BANKING_APPS } from '../bankingApps';

const JAVA_LISTENER = readFileSync(
  resolve(__dirname, '../../android-custom/NotificationListener.java'),
  'utf-8',
);
const JAVA_PLUGIN = readFileSync(
  resolve(__dirname, '../../android-custom/CovaultNotificationPlugin.java'),
  'utf-8',
);

/**
 * The user could not turn a bank off, and email could not be turned on.
 *
 * Both were the same bug wearing two hats. `isMonitoredApp` asked "is this in
 * the hardcoded list of ~350 banks?" FIRST and only then looked at the user's
 * choices, so unticking a built-in bank changed precisely nothing — and the
 * auto-detect that runs on every app launch, being add-only, put back anything
 * that had been removed anyway.
 *
 * Making the user's list authoritative is the single change in this feature that
 * can silently stop every purchase being captured — green build, no error, no
 * log line, nothing in Review ever again. That is what this file exists to
 * prevent, and why the upgrade case is tested as carefully as the new one.
 */
describe('the three states of the selection', () => {
  beforeEach(() => storage.clear());

  it('an install that has never been asked still captures from its banks', () => {
    // THE UPGRADE CASE. A phone updating to this build has no stored selection.
    // If that read as "the user chose nothing", capture would stop dead.
    expect(hasChosenSources()).toBe(false);
    expect(isCaptureSourceAllowed('com.bmo.mobile')).toBe(true);
    expect(isCaptureSourceAllowed('com.chase.sig.android')).toBe(true);
  });

  it('mail apps are off until somebody turns them on', () => {
    expect(isCaptureSourceAllowed('com.google.android.gm')).toBe(false);
    expect(defaultSourcesFor(['com.bmo.mobile', 'com.google.android.gm']))
      .toEqual(['com.bmo.mobile']);
  });

  it('unticking a bank sticks, and is not undone by a reload', () => {
    setSelectedSources(['com.bmo.mobile', 'com.rbc.mobile.android']);
    expect(isCaptureSourceAllowed('com.chase.sig.android')).toBe(false);

    setSourceSelected('com.bmo.mobile', false);
    expect(isCaptureSourceAllowed('com.bmo.mobile')).toBe(false);
    expect(isCaptureSourceAllowed('com.rbc.mobile.android')).toBe(true);

    // Everything is read back from storage on each call, so this is what the
    // next launch sees too.
    expect(getSelectedSources()).toEqual(['com.rbc.mobile.android']);
  });

  it('choosing NOTHING is an answer, not an absence', () => {
    // The bug this replaces: an empty list was indistinguishable from "we have
    // not asked yet", so it fell back to every bank and the user's choice was
    // silently discarded.
    setSelectedSources([]);
    expect(hasChosenSources()).toBe(true);
    expect(isCaptureSourceAllowed('com.bmo.mobile')).toBe(false);
  });

  it('turning a mail app on makes it a source, and it reports as one', () => {
    setSelectedSources(['com.bmo.mobile', 'com.google.android.gm']);
    expect(isCaptureSourceAllowed('com.google.android.gm')).toBe(true);
    expect(allowedSourceKind('com.google.android.gm')).toBe('email');
    expect(allowedSourceKind('com.bmo.mobile')).toBe('bank');
    expect(allowedSourceKind('com.chase.sig.android')).toBeNull();
  });

  it('lets the user turn a wallet on, which used to be impossible', () => {
    // Google Wallet was refused at every layer, so a card that only ever
    // notifies through it could not be captured and the user had no lever. It is
    // now an ordinary source; its repeat of the bank's own alert is handled by
    // the cross-app rule instead.
    setSelectedSources(['com.google.android.apps.walletnfcrel']);
    expect(isCaptureSourceAllowed('com.google.android.apps.walletnfcrel')).toBe(true);
    expect(allowedSourceKind('com.google.android.apps.walletnfcrel')).toBe('bank');
  });

  it('never lets an excluded app in, however it is written or selected', () => {
    // Empty today; the loop is what makes this guard the moment it is not.
    for (const pkg of Object.keys(EXCLUDED_APPS)) {
      setSelectedSources([pkg]);
      expect(isCaptureSourceAllowed(pkg), pkg).toBe(false);
      expect(getSelectedSources(), pkg).not.toContain(pkg);
      setSourceSelected(pkg, true);
      expect(isCaptureSourceAllowed(pkg), pkg).toBe(false);
    }
  });
});

describe('package names are compared one way', () => {
  beforeEach(() => storage.clear());

  it('folds case, so a mixed-case package survives a round trip', () => {
    // Twelve-odd banks and one mail app carry capitals. The web side always
    // lowercased and the phone compared exactly, so a package selected in
    // settings was stored in a form the listener could never match: the app read
    // nothing and said nothing about it.
    const mixed = Object.keys(KNOWN_BANKING_APPS).filter((p) => p !== p.toLowerCase());
    expect(mixed.length).toBeGreaterThan(0);

    setSelectedSources([...mixed, 'org.kman.AquaMail']);
    for (const pkg of mixed) {
      expect(isCaptureSourceAllowed(pkg), pkg).toBe(true);
      expect(isCaptureSourceAllowed(pkg.toLowerCase()), pkg).toBe(true);
    }
    expect(isCaptureSourceAllowed('org.kman.aquamail')).toBe(true);
    expect(getSelectedSources().every((p) => p === p.toLowerCase())).toBe(true);
  });

  it('tolerates whitespace and junk', () => {
    expect(normalizePackage('  Com.BMO.Mobile ')).toBe('com.bmo.mobile');
    expect(normalizePackage(null)).toBe('');
    expect(isCaptureSourceAllowed(null)).toBe(false);
    expect(isCaptureSourceAllowed('')).toBe(false);
  });
});

describe('what the picker offers', () => {
  beforeEach(() => storage.clear());

  const installed = [
    { packageName: 'com.bmo.mobile', name: 'BMO' },
    { packageName: 'com.google.android.gm', name: 'Gmail' },
    { packageName: 'ca.smalltown.cu', name: 'Smalltown Credit Union' },
    { packageName: 'com.example.mailbag', name: 'MailBag Inbox' },
    { packageName: 'com.example.notes', name: 'Notes' },
    { packageName: 'com.google.android.apps.walletnfcrel', name: 'Google Wallet' },
  ];

  it('sorts recognised banks and mail apps into their kinds', () => {
    const options = buildSourceOptions(installed);
    const byPkg = Object.fromEntries(options.map((o) => [o.packageName, o]));

    expect(byPkg['com.bmo.mobile']).toMatchObject({ kind: 'bank', recognised: true });
    expect(byPkg['com.google.android.gm']).toMatchObject({ kind: 'email', recognised: true });
  });

  it('offers unrecognised apps that look financial or mail-shaped', () => {
    const byPkg = Object.fromEntries(buildSourceOptions(installed).map((o) => [o.packageName, o]));
    expect(byPkg['ca.smalltown.cu']).toMatchObject({ kind: 'bank', recognised: false });
    expect(byPkg['com.example.mailbag']).toMatchObject({ kind: 'email', recognised: false });
  });

  it('never offers an ordinary app', () => {
    const packages = buildSourceOptions(installed).map((o) => o.packageName);
    expect(packages).not.toContain('com.example.notes');
  });

  it('offers a wallet as a bank', () => {
    const byPkg = Object.fromEntries(buildSourceOptions(installed).map((o) => [o.packageName, o]));
    expect(byPkg['com.google.android.apps.walletnfcrel'])
      .toMatchObject({ kind: 'bank', recognised: true });
  });
});

/**
 * The two lists have to agree. The phone's list decides what is forwarded at
 * all; the web list decides what is accepted on arrival. Writing one without the
 * other produces a half-state that is very hard to see from outside — with only
 * the phone's list, notifications are read and thrown away, so nothing is saved
 * and nothing says why.
 */
describe('the phone agrees with the app', () => {
  it('the listener treats the stored list as authoritative once chosen', () => {
    expect(JAVA_LISTENER).toMatch(/hasChosenMonitoredApps\(\)/);
    // The old short-circuit. If this comes back, unticking a bank silently
    // stops working again.
    expect(JAVA_LISTENER).not.toMatch(
      /if\s*\(\s*BANKING_APPS\.contains\(packageName\)\s*\)\s*return\s+true;/,
    );
  });

  it('auto-detect stops adding once the user has chosen', () => {
    // Add-only and running on every launch, this used to put back every bank
    // the user had just switched off, every time they opened the app.
    expect(JAVA_PLUGIN).toMatch(/monitored_apps_chosen[\s\S]{0,200}return;/);
  });

  it('only a real choice raises the chosen flag; seeding must not', () => {
    expect(JAVA_PLUGIN).toMatch(/putBoolean\("monitored_apps_chosen",\s*true\)/);
    // Never written false: a seed write must not be able to demote a real
    // choice back to "we have not asked".
    expect(JAVA_PLUGIN).not.toMatch(/putBoolean\("monitored_apps_chosen",\s*false\)/);
  });

  it('the selection and the phone list are written by one function', () => {
    const helper = readFileSync(resolve(__dirname, '../covaultNotification.ts'), 'utf-8');
    expect(helper).toMatch(/export async function applySourceSelection/);
    expect(helper).toMatch(/setSelectedSources\(packages\)/);
    expect(helper).toMatch(/saveMonitoredApps\(\{[\s\S]{0,120}chosen: true/);
  });

  it('every mail app the app knows is one the listener knows', () => {
    const javaBlock = JAVA_LISTENER.slice(JAVA_LISTENER.indexOf('EMAIL_APPS'));
    for (const pkg of Object.keys(KNOWN_EMAIL_APPS)) {
      expect(javaBlock, pkg).toContain(`"${pkg}"`);
    }
  });

  it('the picker can see preinstalled mail apps', () => {
    // Gmail ships preinstalled on most phones and Samsung Email on every
    // Samsung, so both carry FLAG_SYSTEM. Without naming them, the picker would
    // simply not list the two mail apps most people use.
    expect(JAVA_PLUGIN).toMatch(/EMAIL_APPS\.contains\(app\.packageName\)/);
  });
});

describe('kinds', () => {
  beforeEach(() => storage.clear());

  it('knows a bank from a mail app from neither', () => {
    expect(captureSourceKind('com.bmo.mobile')).toBe('bank');
    expect(captureSourceKind('com.google.android.gm')).toBe('email');
    expect(captureSourceKind('com.example.notes')).toBeNull();
    expect(captureSourceKind('com.google.android.apps.walletnfcrel')).toBe('bank');
  });
});
