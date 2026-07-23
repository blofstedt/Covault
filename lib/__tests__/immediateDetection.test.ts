import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests that banking app detection works immediately from the installed apps
 * list — without requiring any notifications to have been received first.
 *
 * This validates the fix for the issue where users saw "Scanning for banking
 * apps…" even though their banking apps were installed: the detection is
 * synchronous against the installed apps list, so apps should appear
 * immediately after getInstalledApps() resolves.
 */

// ── Mock setup ──────────────────────────────────────────────────────────────
const {
  mockGetInstalledApps,
  mockGetMonitoredApps,
  mockSaveMonitoredApps,
  mockScanActiveNotifications,
} = vi.hoisted(() => ({
  mockGetInstalledApps: vi.fn(),
  mockGetMonitoredApps: vi.fn(),
  mockSaveMonitoredApps: vi.fn(),
  mockScanActiveNotifications: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  registerPlugin: () => ({
    getInstalledApps: mockGetInstalledApps,
    getMonitoredApps: mockGetMonitoredApps,
    saveMonitoredApps: mockSaveMonitoredApps,
    scanActiveNotifications: mockScanActiveNotifications,
    requestAccess: vi.fn(),
    isEnabled: vi.fn(),
    addListener: vi.fn(),
  }),
}));

import { autoDetectAndSaveMonitoredApps } from '../covaultNotification';
import { KNOWN_BANKING_APPS } from '../bankingApps';

// ── Helpers ─────────────────────────────────────────────────────────────────
function simulateInstalledApps(apps: Array<{ packageName: string; name: string }>) {
  mockGetInstalledApps.mockResolvedValue({ apps });
}

function simulateMonitoredApps(packages: string[]) {
  mockGetMonitoredApps.mockResolvedValue({ apps: packages });
}

/** Re-implements the UI-side filtering logic used by NotificationSettings */
function filterAndNameBankApps(
  installed: Array<{ packageName: string; name: string }>,
  knownApps: Record<string, string>,
) {
  return installed
    .filter(a => a.packageName in knownApps)
    .map(a => ({
      packageName: a.packageName,
      name: knownApps[a.packageName] || a.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveMonitoredApps.mockResolvedValue(undefined);
});

describe('Immediate banking app detection (no notifications required)', () => {

  it('detects banking apps immediately from the installed apps list', async () => {
    const installed = [
      { packageName: 'com.chase.sig.android', name: 'Chase' },
      { packageName: 'com.bmo.mobile', name: 'BMO' },
      { packageName: 'com.instagram.android', name: 'Instagram' },
    ];

    // The UI filtering should find banking apps immediately
    const bankApps = filterAndNameBankApps(installed, KNOWN_BANKING_APPS);

    expect(bankApps).toHaveLength(2);
    expect(bankApps.map(a => a.packageName)).toContain('com.chase.sig.android');
    expect(bankApps.map(a => a.packageName)).toContain('com.bmo.mobile');
    // Non-banking apps are excluded
    expect(bankApps.map(a => a.packageName)).not.toContain('com.instagram.android');
  });

  it('uses friendly names from KNOWN_BANKING_APPS', () => {
    const installed = [
      { packageName: 'com.chase.sig.android', name: 'Chase Mobile' },
      { packageName: 'com.wealthsimple', name: 'Wealthsimple: Invest & Save' },
    ];

    const bankApps = filterAndNameBankApps(installed, KNOWN_BANKING_APPS);

    expect(bankApps).toHaveLength(2);
    expect(bankApps.find(a => a.packageName === 'com.chase.sig.android')?.name).toBe('Chase');
    expect(bankApps.find(a => a.packageName === 'com.wealthsimple')?.name).toBe('Wealthsimple');
  });

  it('returns empty array (not loading state) when no banking apps are installed', () => {
    const installed = [
      { packageName: 'com.instagram.android', name: 'Instagram' },
      { packageName: 'com.spotify.music', name: 'Spotify' },
    ];

    const bankApps = filterAndNameBankApps(installed, KNOWN_BANKING_APPS);

    // After filtering completes, the list is genuinely empty — the UI
    // should show "No supported banking apps detected" not "Scanning…"
    expect(bankApps).toHaveLength(0);
  });

  it('autoDetectAndSaveMonitoredApps saves apps immediately on fresh install', async () => {
    simulateInstalledApps([
      { packageName: 'com.chase.sig.android', name: 'Chase' },
      { packageName: 'com.venmo', name: 'Venmo' },
      { packageName: 'com.spotify.music', name: 'Spotify' },
    ]);
    simulateMonitoredApps([]);

    await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);

    expect(mockSaveMonitoredApps).toHaveBeenCalledTimes(1);
    const savedApps: string[] = mockSaveMonitoredApps.mock.calls[0][0].apps;
    expect(savedApps).toContain('com.chase.sig.android');
    expect(savedApps).toContain('com.venmo');
    expect(savedApps).not.toContain('com.spotify.music');
  });

  it('detection does not require prior notifications to have been received', async () => {
    // This is the key test: even on a completely fresh install with no
    // notifications ever received, banking apps should be detected
    // purely from the installed apps list.
    simulateInstalledApps([
      { packageName: 'com.rbc.mobile.android', name: 'RBC Mobile' },
      { packageName: 'com.td', name: 'TD' },
      { packageName: 'com.google.android.gm', name: 'Gmail' },
    ]);
    simulateMonitoredApps([]);

    await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);

    expect(mockSaveMonitoredApps).toHaveBeenCalledTimes(1);
    const savedApps: string[] = mockSaveMonitoredApps.mock.calls[0][0].apps;
    expect(savedApps).toContain('com.rbc.mobile.android');
    expect(savedApps).toContain('com.td');
    expect(savedApps).toHaveLength(2);
  });
});
