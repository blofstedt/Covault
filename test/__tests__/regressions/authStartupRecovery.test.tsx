// @vitest-environment happy-dom
import { useState } from 'react';
import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { renderWithProviders } from '../../renderWithProviders';
import { useAuthState, type AuthStatus } from '../../../app/hooks/useAuthState';

const mocks = vi.hoisted(() => {
  const listeners: ((event: AuthChangeEvent, session: Session | null) => void | Promise<void>)[] = [];
  return { listeners, getSession: vi.fn(), setAppState: vi.fn(), loadUserData: vi.fn() };
});
vi.mock('../../../app/lib/api/supabase', () => ({ supabaseUrl: 'http://127.0.0.1:4203/mock-supabase', supabaseAnonKey: 'local-test-key', supabase: { auth: {
  getSession: mocks.getSession,
  onAuthStateChange: (listener: (event: AuthChangeEvent, session: Session | null) => void | Promise<void>) => {
    mocks.listeners.push(listener);
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  },
} } }));

function StartupHarness() {
  const [status, setAuthState] = useState<AuthStatus>('loading');
  useAuthState({ setAppState: mocks.setAppState, setAuthState, loadUserData: mocks.loadUserData });
  return <p role="status">{status}</p>;
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => { storage.clear(); },
  });
  mocks.getSession.mockReset();
  mocks.setAppState.mockReset();
  mocks.loadUserData.mockReset().mockResolvedValue(undefined);
  mocks.listeners.length = 0;
  localStorage.clear();
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('initial session recovery', () => {
  it('leaves the startup loader when reading the session rejects', async () => {
    mocks.getSession.mockRejectedValue(null);
    renderWithProviders(<StartupHarness />);
    expect(await screen.findByText('unauthenticated')).toBeVisible();
  });

  it('keeps a successful sign-in when the earlier session check rejects late', async () => {
    let rejectInitial: (reason: unknown) => void = () => {};
    mocks.getSession.mockReturnValue(new Promise((_resolve, reject) => { rejectInitial = reject; }));
    renderWithProviders(<StartupHarness />);
    const session: Session = {
      access_token: 'test-access', refresh_token: 'test-refresh', token_type: 'bearer', expires_in: 3600,
      user: { id: 'established-user', aud: 'authenticated', created_at: '2020-01-01T00:00:00Z',
        email: 'user@example.test', app_metadata: {}, user_metadata: {} },
    };
    await act(async () => {
      await mocks.listeners[0]('SIGNED_IN', session);
      rejectInitial(null);
    });
    expect(screen.getByRole('status')).toHaveTextContent('authenticated');
  });
});
