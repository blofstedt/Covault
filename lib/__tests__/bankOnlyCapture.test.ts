import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The suite runs in node, so the approved-sources store needs a localStorage.
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
  isBankingApp,
  suggestUnknownBankApps,
  setCaptureSourceApproved,
  getApprovedCaptureSources,
  KNOWN_BANKING_APPS,
} from '../bankingApps';

const JAVA_PATH = resolve(__dirname, '../../android-custom/NotificationListener.java');
const HOOK_PATH = resolve(__dirname, '../hooks/useNotificationListener.ts');
const PROCESSOR_PATH = resolve(__dirname, '../notificationProcessor.ts');

/**
 * Capture is for banks. Anything else that mentions money — a chat message
 * quoting a price, a delivery receipt, a calendar reminder — is not a purchase,
 * and the pipeline used to accept all of it because the native listener
 * forwarded any notification containing a dollar amount.
 */
describe('only banking apps can produce a capture', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('accepts a known bank', () => {
    expect(isBankingApp('com.bmo.mobile')).toBe(true);
    expect(isBankingApp('com.chase.sig.android')).toBe(true);
  });

  it('accepts a bank whose package name is not all lowercase', () => {
    // The pipeline lowercases every incoming package id, so these entries are
    // only reachable through a case-folded lookup.
    const camelCased = Object.keys(KNOWN_BANKING_APPS).filter((p) => p !== p.toLowerCase());
    expect(camelCased.length).toBeGreaterThan(0);
    for (const pkg of camelCased) {
      expect(isBankingApp(pkg.toLowerCase()), pkg).toBe(true);
    }
  });

  it('rejects the apps that were producing false captures', () => {
    // Outlook stays here on purpose even though mail apps can now be capture
    // sources. It is not a BANK, and this is the bank question — a mail app is
    // a different kind of source with its own, stricter rule (the sender has to
    // be a bank; see lib/emailNotification.ts), and it is off until the user
    // ticks it. Nothing about email support may quietly turn a mail app into a
    // bank, which is what would happen if this assertion were relaxed.
    for (const pkg of [
      'com.microsoft.teams',
      'com.microsoft.office.outlook',
      'com.slack',
      'com.whatsapp',
      'com.amazon.mShop.android.shopping',
      'com.ubercab.eats',
    ]) {
      expect(isBankingApp(pkg), pkg).toBe(false);
    }
  });

  it('rejects excluded apps even though they are money apps', () => {
    expect(isBankingApp('com.google.android.apps.walletnfcrel')).toBe(false);
  });

  it('rejects empty or missing package names', () => {
    expect(isBankingApp('')).toBe(false);
    expect(isBankingApp(null)).toBe(false);
    expect(isBankingApp(undefined)).toBe(false);
  });
});

/**
 * The visible half of the rule. Restricting capture to known banks means an
 * unlisted bank fails silently, so the app has to volunteer what it might be
 * missing and let the user approve it.
 */
describe('unknown bank suggestions', () => {
  beforeEach(() => {
    storage.clear();
  });

  const installed = [
    { packageName: 'com.bmo.mobile', name: 'BMO' },
    { packageName: 'ca.smalltown.cu', name: 'Smalltown Credit Union' },
    { packageName: 'com.example.notes', name: 'Notes' },
    { packageName: 'com.google.android.apps.walletnfcrel', name: 'Google Wallet' },
  ];

  it('offers financial-looking apps that are not already known', () => {
    const suggestions = suggestUnknownBankApps(installed);
    expect(suggestions.map((s) => s.packageName)).toEqual(['ca.smalltown.cu']);
  });

  it('never offers an app that is already a known bank, or an excluded one', () => {
    const packages = suggestUnknownBankApps(installed).map((s) => s.packageName);
    expect(packages).not.toContain('com.bmo.mobile');
    expect(packages).not.toContain('com.google.android.apps.walletnfcrel');
  });

  it('approving one makes it a valid capture source, and un-approving undoes it', () => {
    expect(isBankingApp('ca.smalltown.cu')).toBe(false);
    setCaptureSourceApproved('ca.smalltown.cu', true);
    expect(getApprovedCaptureSources()).toContain('ca.smalltown.cu');
    expect(isBankingApp('ca.smalltown.cu')).toBe(true);
    setCaptureSourceApproved('ca.smalltown.cu', false);
    expect(isBankingApp('ca.smalltown.cu')).toBe(false);
  });

  it('refuses to approve an excluded app, whatever the user taps', () => {
    setCaptureSourceApproved('com.google.android.apps.walletnfcrel', true);
    expect(isBankingApp('com.google.android.apps.walletnfcrel')).toBe(false);
  });
});

describe('the has-a-dollar-amount fallback is gone', () => {
  it('the native listener forwards only monitored apps', () => {
    const java = readFileSync(JAVA_PATH, 'utf-8');
    // The old rule. If this comes back, every app that mentions money is a
    // capture source again.
    expect(java).not.toMatch(/if\s*\(\s*!fromMonitored\s*&&\s*!hasDollarAmount\s*\)/);
    expect(java).toMatch(/if\s*\(\s*!fromMonitored\s*\)\s*\{\s*\n\s*return;/);
  });

  it('the JS listener and the pipeline both check the source app', () => {
    // The gate moved from "is this a bank?" to "is this an app the user
    // picked?" when mail apps became selectable — a strictly narrower question,
    // since an app the user has not chosen is refused whatever kind it is. Both
    // layers still have to ask it: events reach the pipeline from the offline
    // queue and from rescans as well as from a live broadcast.
    expect(readFileSync(HOOK_PATH, 'utf-8')).toMatch(/isCaptureSourceAllowed\(/);
    expect(readFileSync(PROCESSOR_PATH, 'utf-8')).toMatch(/isCaptureSourceAllowed\(input\.bankAppId\)/);
  });
});
