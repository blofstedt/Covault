// @vitest-environment happy-dom
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/renderWithProviders';
import Auth from '../Auth';

const mocks = vi.hoisted(() => ({
  native: false,
  initialError: Promise.resolve<string | null>(null),
  signIn: vi.fn(),
  openBrowser: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.native } }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: mocks.openBrowser } }));
vi.mock('../../lib/api/supabase', () => ({
  supabase: { auth: { signInWithOAuth: mocks.signIn } },
  get initialWebAuthError() { return mocks.initialError; },
}));

beforeEach(() => {
  mocks.native = false;
  mocks.initialError = Promise.resolve(null);
  mocks.signIn.mockReset();
  mocks.openBrowser.mockReset();
});

describe('Google sign-in recovery', () => {
  it.each(['SDK error', 'null rejection', 'missing URL'])('allows retry after a %s', async failure => {
    if (failure === 'SDK error') mocks.signIn.mockResolvedValueOnce({ data: null, error: new Error('private error') });
    else if (failure === 'null rejection') mocks.signIn.mockRejectedValueOnce(null);
    else mocks.signIn.mockResolvedValueOnce({ data: { url: null }, error: null });
    mocks.signIn.mockResolvedValueOnce({ data: { url: 'https://example.test/authorize' }, error: null });
    const user = userEvent.setup();
    renderWithProviders(<Auth onSignIn={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Connect with Google' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't start Google sign-in. Please try again.");
    expect(screen.getByRole('button', { name: 'Connect with Google' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Connect with Google' }));
    expect(screen.getByText('Opening Vault...')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.signIn).toHaveBeenLastCalledWith({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: { access_type: 'offline', prompt: 'consent' },
        skipBrowserRedirect: false,
      },
    });
  });

  it('reports a completed callback failure and clears it when retry starts', async () => {
    mocks.initialError = Promise.resolve('Google sign-in was cancelled. You can try again.');
    mocks.signIn.mockResolvedValue({ data: { url: 'https://example.test/authorize' }, error: null });
    const user = userEvent.setup();
    renderWithProviders(<Auth onSignIn={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Google sign-in was cancelled. You can try again.');
    await user.click(screen.getByRole('button', { name: 'Connect with Google' }));
    expect(screen.getByText('Opening Vault...')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not replace a new sign-in attempt with a late error from the previous callback', async () => {
    let finishCallback: (error: string | null) => void = () => {};
    mocks.initialError = new Promise(resolve => { finishCallback = resolve; });
    mocks.signIn.mockResolvedValue({ data: { url: 'https://example.test/authorize' }, error: null });
    const user = userEvent.setup();
    renderWithProviders(<Auth onSignIn={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Connect with Google' }));
    await act(async () => { finishCallback('Old callback failed.'); });
    expect(screen.getByText('Opening Vault...')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps the native PKCE callback and opens the returned sign-in URL', async () => {
    mocks.native = true;
    mocks.signIn.mockResolvedValue({ data: { url: 'https://example.test/authorize' }, error: null });
    mocks.openBrowser.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<Auth onSignIn={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Connect with Google' }));
    await waitFor(() => expect(mocks.openBrowser).toHaveBeenCalledWith({ url: 'https://example.test/authorize' }));
    expect(mocks.signIn).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'com.covault.app://auth/callback',
        queryParams: { access_type: 'offline', prompt: 'consent' },
        skipBrowserRedirect: true,
      },
    });
    expect(screen.getByText('Opening Vault...')).toBeVisible();
  });
});
