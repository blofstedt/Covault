/**
 * Integration-style tests that prove banking apps (BMO + Wealthsimple) are
 * detected by the REAL autoDetectAndSaveMonitoredApps() function — not by
 * re-implementing the algorithm.
 *
 * These mock the Capacitor plugin at the module level so we can call the
 * actual exported function and verify it calls getInstalledApps(),
 * filters correctly, and calls saveMonitoredApps() with the right packages.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────────────
// We need to mock both @capacitor/core AND the covaultNotification singleton
// that is created at module-load time in covaultNotification.ts.
//
// vi.hoisted() ensures these are defined BEFORE vi.mock() factory runs
// (vi.mock is hoisted to the top of the file by vitest).

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

// Mock @capacitor/core so isNativePlatform() returns true and registerPlugin
// returns our fake plugin object.
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

// NOW import the real function — it will use our mocked plugin
import { autoDetectAndSaveMonitoredApps } from '../covaultNotification';
import { KNOWN_BANKING_APPS } from '../bankingApps';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Simulate a phone with specific apps installed (mix of banking + non-banking) */
function simulateInstalledApps(apps: Array<{ packageName: string; name: string }>) {
  mockGetInstalledApps.mockResolvedValue({ apps });
}

/** Simulate what's currently saved as monitored */
function simulateMonitoredApps(packages: string[]) {
  mockGetMonitoredApps.mockResolvedValue({ apps: packages });
}

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveMonitoredApps.mockResolvedValue(undefined);
});

describe('BMO + Wealthsimple detection (real autoDetectAndSaveMonitoredApps)', () => {

  it('Scenario 1: Fresh install — immediately detects BMO and Wealthsimple without any notification', async () => {
    // Phone has BMO and Wealthsimple installed, plus some non-banking apps
    simulateInstalledApps([
      { packageName: 'com.bmo.mobile', name: 'BMO Mobile Banking' },
      { packageName: 'com.wealthsimple', name: 'Wealthsimple' },
      { packageName: 'com.instagram.android', name: 'Instagram' },
      { packageName: 'com.spotify.music', name: 'Spotify' },
      { packageName: 'com.google.android.gm', name: 'Gmail' },
    ]);

    // Nothing saved yet (fresh install)
    simulateMonitoredApps([]);

    // Call the REAL function
    await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);

    // ✅ It should have called saveMonitoredApps with BOTH banking apps
    expect(mockSaveMonitoredApps).toHaveBeenCalledTimes(1);

    const savedApps: string[] = mockSaveMonitoredApps.mock.calls[0][0].apps;
    expect(savedApps).toContain('com.bmo.mobile');
    expect(savedApps).toContain('com.wealthsimple');
    expect(savedApps).toHaveLength(2);

    // ✅ Non-banking apps must NOT be included
    expect(savedApps).not.toContain('com.instagram.android');
    expect(savedApps).not.toContain('com.spotify.music');
    expect(savedApps).not.toContain('com.google.android.gm');
  });

  it('Scenario 2: BMO already monitored, then Wealthsimple installed later — periodic scan picks it up', async () => {
    // Phone now has both, but only BMO was saved from previous scan
    simulateInstalledApps([
      { packageName: 'com.bmo.mobile', name: 'BMO Mobile Banking' },
      { packageName: 'com.wealthsimple', name: 'Wealthsimple' },
      { packageName: 'com.instagram.android', name: 'Instagram' },
    ]);

    // BMO was already saved from a previous detection
    simulateMonitoredApps(['com.bmo.mobile']);

    await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);

    // ✅ Should save BOTH (merge, not replace)
    expect(mockSaveMonitoredApps).toHaveBeenCalledTimes(1);

    const savedApps: string[] = mockSaveMonitoredApps.mock.calls[0][0].apps;
    expect(savedApps).toContain('com.bmo.mobile');
    expect(savedApps).toContain('com.wealthsimple');
    expect(savedApps).toHaveLength(2);
  });

  it('Scenario 3: Both already monitored — no unnecessary save call', async () => {
    simulateInstalledApps([
      { packageName: 'com.bmo.mobile', name: 'BMO Mobile Banking' },
      { packageName: 'com.wealthsimple', name: 'Wealthsimple' },
    ]);

    // Both already saved
    simulateMonitoredApps(['com.bmo.mobile', 'com.wealthsimple']);

    await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);

    // ✅ Should NOT call saveMonitoredApps (nothing changed)
    expect(mockSaveMonitoredApps).not.toHaveBeenCalled();
  });

  it('Scenario 4: Only non-banking apps installed — nothing saved', async () => {
    simulateInstalledApps([
      { packageName: 'com.instagram.android', name: 'Instagram' },
      { packageName: 'com.spotify.music', name: 'Spotify' },
      { packageName: 'com.google.android.gm', name: 'Gmail' },
    ]);

    simulateMonitoredApps([]);

    await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);

    // ✅ Should NOT call saveMonitoredApps
    expect(mockSaveMonitoredApps).not.toHaveBeenCalled();
  });

  it('Scenario 5: Wealthsimple installed first, then BMO added — BMO merged in on next scan', async () => {
    // First scan: only Wealthsimple
    simulateInstalledApps([
      { packageName: 'com.wealthsimple', name: 'Wealthsimple' },
    ]);
    simulateMonitoredApps([]);

    await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);

    expect(mockSaveMonitoredApps).toHaveBeenCalledTimes(1);
    let savedApps: string[] = mockSaveMonitoredApps.mock.calls[0][0].apps;
    expect(savedApps).toEqual(['com.wealthsimple']);

    // Second scan: user installed BMO
    vi.clearAllMocks();
    mockSaveMonitoredApps.mockResolvedValue(undefined);

    simulateInstalledApps([
      { packageName: 'com.wealthsimple', name: 'Wealthsimple' },
      { packageName: 'com.bmo.mobile', name: 'BMO Mobile Banking' },
    ]);
    simulateMonitoredApps(['com.wealthsimple']); // from previous save

    await autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS);

    // ✅ BMO should now be merged in
    expect(mockSaveMonitoredApps).toHaveBeenCalledTimes(1);
    savedApps = mockSaveMonitoredApps.mock.calls[0][0].apps;
    expect(savedApps).toContain('com.bmo.mobile');
    expect(savedApps).toContain('com.wealthsimple');
    expect(savedApps).toHaveLength(2);
  });

  it('Scenario 6: Detects correct friendly names for BMO and Wealthsimple', () => {
    // Verify the known banking apps list has the right entries
    expect(KNOWN_BANKING_APPS['com.bmo.mobile']).toBe('BMO');
    expect(KNOWN_BANKING_APPS['com.wealthsimple']).toBe('Wealthsimple');
  });

  it('Scenario 7: Plugin errors are handled gracefully — does not crash', async () => {
    // Simulate a plugin error (e.g. device in weird state)
    mockGetMonitoredApps.mockRejectedValue(new Error('Plugin not available'));

    // Should not throw
    await expect(
      autoDetectAndSaveMonitoredApps(KNOWN_BANKING_APPS),
    ).resolves.toBeUndefined();

    // Should not have tried to save
    expect(mockSaveMonitoredApps).not.toHaveBeenCalled();
  });
});
