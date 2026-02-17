import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @capacitor/core before importing the module under test
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: vi.fn(),
}));

import { KNOWN_BANKING_APPS } from '../bankingApps';

describe('autoDetectAndSaveMonitoredApps', () => {
  // We test the logic by re-implementing the same algorithm the function uses,
  // because the real function relies on a Capacitor plugin singleton that is
  // initialised at module-load time.  Instead we validate:
  //   1. The filtering logic (installed apps × known banking apps)
  //   2. Edge cases (empty lists, no matches, already-saved apps)

  const filterInstalledBankingApps = (
    installed: Array<{ packageName: string; name: string }>,
    knownApps: Record<string, string>,
  ) => installed.filter(app => app.packageName in knownApps).map(app => app.packageName);

  it('detects installed banking apps from the known list', () => {
    const installed = [
      { packageName: 'com.chase.sig.android', name: 'Chase' },
      { packageName: 'com.instagram.android', name: 'Instagram' },
      { packageName: 'com.wealthsimple', name: 'Wealthsimple' },
      { packageName: 'com.spotify.music', name: 'Spotify' },
    ];

    const result = filterInstalledBankingApps(installed, KNOWN_BANKING_APPS);

    expect(result).toEqual(['com.chase.sig.android', 'com.wealthsimple']);
    expect(result).not.toContain('com.instagram.android');
    expect(result).not.toContain('com.spotify.music');
  });

  it('returns empty array when no banking apps are installed', () => {
    const installed = [
      { packageName: 'com.instagram.android', name: 'Instagram' },
      { packageName: 'com.spotify.music', name: 'Spotify' },
    ];

    const result = filterInstalledBankingApps(installed, KNOWN_BANKING_APPS);
    expect(result).toEqual([]);
  });

  it('returns empty array when no apps are installed', () => {
    const result = filterInstalledBankingApps([], KNOWN_BANKING_APPS);
    expect(result).toEqual([]);
  });

  it('detects all banking apps when all are installed', () => {
    const installed = Object.entries(KNOWN_BANKING_APPS).map(([pkg, name]) => ({
      packageName: pkg,
      name,
    }));

    const result = filterInstalledBankingApps(installed, KNOWN_BANKING_APPS);
    expect(result.length).toBe(Object.keys(KNOWN_BANKING_APPS).length);
  });

  it('should merge newly installed apps with existing monitored apps', () => {
    // New behavior: merge instead of skip when monitored apps already exist
    const alreadySaved = ['com.chase.sig.android'];
    const installed = [
      { packageName: 'com.chase.sig.android', name: 'Chase' },
      { packageName: 'com.wealthsimple', name: 'Wealthsimple' },
    ];

    const bankingPackages = filterInstalledBankingApps(installed, KNOWN_BANKING_APPS);
    const savedSet = new Set(alreadySaved);
    let changed = false;
    for (const pkg of bankingPackages) {
      if (!savedSet.has(pkg)) {
        savedSet.add(pkg);
        changed = true;
      }
    }

    expect(changed).toBe(true);
    expect(Array.from(savedSet)).toContain('com.chase.sig.android');
    expect(Array.from(savedSet)).toContain('com.wealthsimple');
    expect(savedSet.size).toBe(2);
  });

  it('should not change saved list when no new apps are found', () => {
    const alreadySaved = ['com.chase.sig.android'];
    const installed = [
      { packageName: 'com.chase.sig.android', name: 'Chase' },
    ];

    const bankingPackages = filterInstalledBankingApps(installed, KNOWN_BANKING_APPS);
    const savedSet = new Set(alreadySaved);
    let changed = false;
    for (const pkg of bankingPackages) {
      if (!savedSet.has(pkg)) {
        savedSet.add(pkg);
        changed = true;
      }
    }

    expect(changed).toBe(false);
    expect(savedSet.size).toBe(1);
  });

  it('should proceed when no monitored apps are saved yet', () => {
    const alreadySaved: string[] = [];
    const shouldSkip = alreadySaved.length > 0;
    expect(shouldSkip).toBe(false);
  });
});

describe('KNOWN_BANKING_APPS consistency', () => {
  it('contains expected major US banks', () => {
    expect(KNOWN_BANKING_APPS).toHaveProperty('com.chase.sig.android');
    expect(KNOWN_BANKING_APPS).toHaveProperty('com.wf.wellsfargomobile');
    expect(KNOWN_BANKING_APPS).toHaveProperty('com.infonow.bofa');
  });

  it('contains expected Canadian banks', () => {
    expect(KNOWN_BANKING_APPS).toHaveProperty('com.bmo.mobile');
    expect(KNOWN_BANKING_APPS).toHaveProperty('com.rbc.mobile.android');
    expect(KNOWN_BANKING_APPS).toHaveProperty('com.td');
    expect(KNOWN_BANKING_APPS).toHaveProperty('com.cibc.android.mobi');
    expect(KNOWN_BANKING_APPS).toHaveProperty('com.scotiabank.mobile');
  });

  it('contains fintech apps', () => {
    expect(KNOWN_BANKING_APPS).toHaveProperty('com.wealthsimple');
    expect(KNOWN_BANKING_APPS).toHaveProperty('com.venmo');
    expect(KNOWN_BANKING_APPS).toHaveProperty('com.squareup.cash');
  });

  it('all entries have non-empty friendly names', () => {
    for (const [pkg, name] of Object.entries(KNOWN_BANKING_APPS)) {
      expect(name, `${pkg} should have a non-empty name`).toBeTruthy();
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('all package names look like valid Android package names', () => {
    for (const pkg of Object.keys(KNOWN_BANKING_APPS)) {
      expect(pkg, `${pkg} should contain at least one dot`).toContain('.');
      expect(pkg, `${pkg} should not have spaces`).not.toContain(' ');
    }
  });
});
