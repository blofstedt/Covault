// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, Transaction } from '../types';
import { renderWithProviders } from '../../test/renderWithProviders';

const harness = vi.hoisted(() => ({
  authHandler: undefined as ((event: string, session: unknown) => void) | undefined,
  getSession: vi.fn(),
  dashboard: [] as Array<Record<string, any>>,
  onboarding: [] as Array<Record<string, any>>,
  listener: [] as Array<Record<string, any>>,
  onboardingRequired: new Set<string>(),
  markOnboarded: vi.fn(),
  saveSettingToDb: vi.fn(async () => undefined),
  loadUserData: vi.fn(async (_userId: string) => undefined),
  loadTransactions: vi.fn(async () => undefined),
  transactionOperation: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  callRpc: vi.fn(async () => ({ ok: true })),
  setAppState: undefined as ((update: unknown) => void) | undefined,
  setDbError: undefined as ((message: string | null) => void) | undefined,
}));

vi.mock('../components/Auth', () => ({ default: () => null }));
vi.mock('../components/Dashboard', () => ({
  default: (props: Record<string, any>) => {
    harness.dashboard.push(props);
    return null;
  },
}));
vi.mock('../components/Onboarding', () => ({
  default: (props: Record<string, any>) => {
    harness.onboarding.push(props);
    return null;
  },
}));
vi.mock('../components/common/FullScreenLoader', () => ({ default: () => null }));
vi.mock('../components/subscription', () => ({ default: () => null }));
vi.mock('../components/common/ErrorBoundary', () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock('../components/updates', () => ({ default: () => null }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }));
vi.mock('../lib/auth/entitlement', () => ({ getEntitlementStatus: () => 'active' }));
vi.mock('../lib/time/serverClock', () => ({ serverNow: () => new Date('2026-10-04T12:00:00Z') }));
vi.mock('../lib/api/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => harness.getSession(),
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        harness.authHandler = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      signOut: harness.signOut,
    },
  },
}));
vi.mock('../hooks/useDeepLinks', () => ({ useDeepLinks: vi.fn() }));
vi.mock('../hooks/useHardwareBack', () => ({ useHardwareBack: vi.fn() }));
vi.mock('../hooks/useNotificationListener', () => ({
  useNotificationListener: (params: Record<string, any>) => {
    harness.listener.push(params);
  },
}));
vi.mock('../hooks/useNotificationSetupCompletion', () => ({ useNotificationSetupCompletion: vi.fn() }));
vi.mock('../hooks/useAppTheme', () => ({ useAppTheme: vi.fn() }));
vi.mock('../hooks/useAppUpdate', () => ({ useAppUpdate: () => ({}) }));
vi.mock('../data/useUserData', () => ({
  useUserData: ({ setAppState, setDbError }: { setAppState: (update: unknown) => void; setDbError: (message: string | null) => void }) => {
    harness.setAppState = setAppState;
    harness.setDbError = setDbError;
    return {
    categoriesLoaded: true,
    loadUserData: harness.loadUserData,
    loadTransactions: harness.loadTransactions,
    handleAddTransaction: harness.transactionOperation,
    handleUpdateTransaction: harness.transactionOperation,
    handleDeleteTransaction: harness.transactionOperation,
    handleGenerateLinkCode: vi.fn(async () => null),
    handleJoinWithCode: vi.fn(async () => ({ ok: true })),
    handleUnlinkPartner: harness.transactionOperation,
    saveBudgetLimit: harness.transactionOperation,
    saveUserIncome: harness.transactionOperation,
    saveTheme: harness.transactionOperation,
    saveBudgetVisibility: harness.transactionOperation,
    saveSettingToDb: harness.saveSettingToDb,
    saveDashboardSetting: harness.transactionOperation,
    };
  },
}));
vi.mock('../hooks/useFirstPaintCache', () => ({ useFirstPaintCache: vi.fn() }));
vi.mock('../lib/native/covaultNotification', () => ({
  covaultNotification: null,
  autoDetectAndSaveMonitoredApps: vi.fn(async () => undefined),
}));
vi.mock('../lib/capture/bankingApps', () => ({ loadBankingAppsFromDB: vi.fn(async () => []) }));
vi.mock('../lib/native/appUpdate', () => ({ getInstalledVersionCode: vi.fn(async () => 1) }));
vi.mock('../lib/observability/errorReporting', () => ({ setReportingBuild: vi.fn(), setReportingUser: vi.fn() }));
vi.mock('../hooks/onboardingState', () => ({
  markOnboarded: harness.markOnboarded,
  shouldShowOnboarding: (user: { id: string }) => harness.onboardingRequired.has(user.id),
}));
vi.mock('../lib/capture/bankHeartbeat', () => ({ noteCaptureEnabled: vi.fn(), noteCaptureDisabled: vi.fn() }));
vi.mock('../lib/ai/aiExtractor', () => ({ preloadAIModel: vi.fn(async () => undefined) }));
vi.mock('../lib/native/haptics', () => ({ setHapticsEnabled: vi.fn() }));
vi.mock('../lib/observability/log', () => ({ log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/ui/toastSubject', () => ({ resolveToastMessage: (toast: { message?: string }) => toast.message ?? '' }));
vi.mock('../lib/api/apiHelpers', () => ({
  callRpc: harness.callRpc,
  clearCachedAccessToken: vi.fn(),
  setCachedAccessToken: vi.fn(),
}));
vi.mock('../lib/auth/accountDeletion', () => ({ deleteAccountErrorMessage: () => 'Account deletion failed' }));

import App from '../../App';

const session = (id: string) => ({
  access_token: `token-${id}`,
  user: { id, email: `${id}@example.test`, user_metadata: { full_name: id } },
});

const tx = (id: string, userId: string): Transaction => ({
  id,
  user_id: userId,
  vendor: `Private shop ${id}`,
  amount: 50,
  date: '2026-10-04',
  budget_id: null,
  label: 'Automatic',
  is_projected: false,
  created_at: '2026-10-04T12:00:00Z',
});

const latestFor = <T extends Record<string, any>>(
  items: T[],
  predicate: (item: T) => boolean,
): T | undefined => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return items[index];
  }
  return undefined;
};

const latestDashboard = () => latestFor(harness.dashboard, props => props.state?.user?.id === 'account-b');
const latestOnboarding = (userId: string) => latestFor(
  harness.onboarding,
  props => props.setup?.userId === userId,
);

beforeEach(() => {
  localStorage.clear();
  harness.authHandler = undefined;
  harness.dashboard.length = 0;
  harness.onboarding.length = 0;
  harness.listener.length = 0;
  harness.onboardingRequired.clear();
  harness.markOnboarded.mockReset();
  harness.saveSettingToDb.mockReset().mockResolvedValue(undefined);
  harness.loadUserData.mockReset().mockResolvedValue(undefined);
  harness.loadTransactions.mockReset().mockResolvedValue(undefined);
  harness.transactionOperation.mockReset().mockResolvedValue(undefined);
  harness.signOut.mockReset().mockResolvedValue(undefined);
  harness.callRpc.mockReset().mockResolvedValue({ ok: true });
  harness.setAppState = undefined;
  harness.setDbError = undefined;
  harness.loadUserData.mockImplementation(async (userId: string) => {
    harness.setAppState?.((prev: AppState) => prev.user?.id === userId
      ? { ...prev, user: { ...prev.user, is_tester: true } }
      : prev);
  });
  harness.getSession.mockReset().mockResolvedValue({ data: { session: session('account-a') } });
});

afterEach(() => {
  localStorage.clear();
});

describe('root account-bound callbacks', () => {
  it('drops a late native capture callback and dashboard state update from account A after B signs in', async () => {
    renderWithProviders(<App />);
    await waitFor(() => expect(harness.getSession).toHaveBeenCalled());
    await waitFor(() => expect(latestFor(harness.dashboard, props => props.state?.user?.id === 'account-a')).toBeTruthy());
    const accountACapture = latestFor(harness.listener, params => params.user?.id === 'account-a');
    const accountADashboard = latestFor(harness.dashboard, props => props.state?.user?.id === 'account-a');
    expect(accountACapture).toBeTruthy();
    expect(accountADashboard).toBeTruthy();

    act(() => harness.authHandler?.('SIGNED_IN', session('account-b')));
    await waitFor(() => expect(latestDashboard()?.state.user.id).toBe('account-b'));

    act(() => accountACapture?.onAutoAcceptedTransaction(tx('late-account-a-row', 'account-a')));
    expect(latestDashboard()?.state.transactions).toEqual([]);

    act(() => accountADashboard?.setState((prev: AppState) => ({
      ...prev,
      transactions: [tx('stale-dashboard-row', 'account-a')],
    })));

    expect(latestDashboard()?.state.transactions).toEqual([]);
  });

  it('does not run account A’s Undo if the account changes before the tap is handled', async () => {
    renderWithProviders(<App />);
    await waitFor(() => expect(
      latestFor(harness.dashboard, props => props.state?.user?.id === 'account-a'),
    ).toBeTruthy());
    const accountADashboard = latestFor(harness.dashboard, props => props.state?.user?.id === 'account-a');
    const undo = vi.fn();
    act(() => accountADashboard?.onToast({
      message: 'Filed an account A purchase',
      tone: 'info',
      action: { label: 'Undo', run: undo },
    }));
    const undoButton = screen.getByRole('button', { name: 'Undo' });

    // The event was queued while A's toast was visible. Auth changes the
    // synchronous owner ref before React commits the B screen.
    act(() => {
      harness.authHandler?.('SIGNED_IN', session('account-b'));
      fireEvent.click(undoButton);
    });

    await waitFor(() => expect(latestDashboard()?.state.user.id).toBe('account-b'));
    expect(undo).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not sign out or delete the active account through account A’s old dashboard', async () => {
    renderWithProviders(<App />);
    await waitFor(() => expect(
      latestFor(harness.dashboard, props => props.state?.user?.id === 'account-a'),
    ).toBeTruthy());
    const accountADashboard = latestFor(harness.dashboard, props => props.state?.user?.id === 'account-a');

    act(() => harness.authHandler?.('SIGNED_IN', session('account-b')));
    await waitFor(() => expect(latestDashboard()?.state.user.id).toBe('account-b'));

    await act(async () => {
      await accountADashboard?.onSignOut();
      await accountADashboard?.onDeleteAccount();
    });

    expect(harness.signOut).not.toHaveBeenCalled();
    expect(harness.callRpc).not.toHaveBeenCalled();
  });

  it('ignores capture-grant and completion callbacks from A after B opens onboarding', async () => {
    harness.onboardingRequired.add('account-a');
    harness.onboardingRequired.add('account-b');
    renderWithProviders(<App />);
    await waitFor(() => expect(latestOnboarding('account-a')).toBeTruthy());
    const accountAOnboarding = latestOnboarding('account-a');
    expect(accountAOnboarding).toBeTruthy();

    act(() => harness.authHandler?.('SIGNED_IN', session('account-b')));
    await waitFor(() => expect(latestOnboarding('account-b')).toBeTruthy());

    act(() => accountAOnboarding?.setup.onCaptureGranted());
    expect(latestOnboarding('account-b')?.setup.captureEnabled).toBe(false);

    act(() => accountAOnboarding?.onComplete(false, [], 'private-a@example.test'));

    expect(latestOnboarding('account-b')?.setup.captureEnabled).toBe(false);
    expect(latestOnboarding('account-b')?.setup.userId).toBe('account-b');
    expect(harness.markOnboarded).not.toHaveBeenCalled();
    expect(harness.saveSettingToDb).not.toHaveBeenCalled();
    expect(latestDashboard()).toBeUndefined();
  });
});


describe('root data failure feedback', () => {
  it('shows safe recovery copy instead of an untrusted technical error', async () => {
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      renderWithProviders(<App />);
      await waitFor(() => expect(latestFor(harness.dashboard, props => props.state?.user?.id === 'account-a')).toBeTruthy());
      act(() => harness.setDbError?.('Failed to fetch: private diagnostic payload <script>bank account</script>'));
      expect(screen.getByRole('alert')).toHaveTextContent("Covault couldn't confirm whether that request completed. Check the screen before trying again.");
      expect(screen.getByRole('alert')).not.toHaveTextContent('private diagnostic payload');
    } finally {
      diagnostic.mockRestore();
    }
  });
});
