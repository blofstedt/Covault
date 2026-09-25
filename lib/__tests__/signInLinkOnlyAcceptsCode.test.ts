/**
 * A sign-in link can only finish a sign-in this phone started.
 *
 * The app signs in with PKCE, so Google sends it back to
 * `com.covault.app://auth/callback?code=…`, and exchanging that code needs a
 * verifier only this app holds. The deep-link handler ALSO used to accept an
 * access token and refresh token written straight into the link, and install
 * them as the session. Any web page or app can open a `com.covault.app://`
 * link — so one carrying someone else's tokens would have swapped this phone
 * onto their account silently, and every purchase it went on to capture from
 * the user's bank alerts would have been filed where that person could read it.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn() } }));
vi.mock('@capacitor/browser', () => ({ Browser: { close: vi.fn() } }));
vi.mock('../supabase', () => ({ supabase: { auth: {} } }));

import { parseOAuthCode } from '../hooks/useDeepLinks';

describe('reading a sign-in link', () => {
  it('takes the authorization code from a real callback', () => {
    expect(parseOAuthCode('com.covault.app://auth/callback?code=abc123')).toBe('abc123');
    expect(parseOAuthCode('com.covault.app://auth/callback?state=x&code=abc123#')).toBe('abc123');
  });

  it('refuses tokens in the fragment', () => {
    expect(
      parseOAuthCode('com.covault.app://auth/callback#access_token=AAA&refresh_token=RRR'),
    ).toBeNull();
  });

  it('refuses tokens in the query', () => {
    expect(
      parseOAuthCode('com.covault.app://auth/callback?access_token=AAA&refresh_token=RRR'),
    ).toBeNull();
  });

  it('finds nothing in a link with no code', () => {
    expect(parseOAuthCode('com.covault.app://auth/callback')).toBeNull();
    expect(parseOAuthCode('com.covault.app://auth/callback?error=access_denied')).toBeNull();
  });
});

describe('what the handler is able to do with a link', () => {
  const source = readFileSync(resolve(__dirname, '../hooks/useDeepLinks.ts'), 'utf8');

  it('never installs a session from tokens it was handed', () => {
    expect(source).not.toMatch(/auth\.setSession\(/);
  });

  it('only ever exchanges a code', () => {
    expect(source).toContain('supabase.auth.exchangeCodeForSession(code)');
  });
});
