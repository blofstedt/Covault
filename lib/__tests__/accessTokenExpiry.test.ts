/**
 * The access-token cache can read the tokens Supabase actually issues.
 *
 * Every REST call asks apiHelpers for a token, and the cached one is reused
 * until it is within 90 seconds of expiring. Its expiry is read out of the
 * JWT — which is base64URL: `-` and `_` where base64 has `+` and `/`. The
 * decoder handed that straight to `atob`, which rejects both, so any token
 * carrying either one (nearly all of them) read as "unknown expiry", was
 * treated as stale, and sent every single request back through
 * `supabase.auth.getSession()` first. The cache existed and never hit.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
  supabaseUrl: 'https://example.supabase.test',
  supabaseAnonKey: 'anon',
}));

import { readTokenExpMs } from '../apiHelpers';

const b64url = (value: string) => Buffer.from(value, 'utf8').toString('base64url');

function jwt(payload: Record<string, unknown>): string {
  return `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}.signature`;
}

describe('reading when a token expires', () => {
  it('reads a token whose payload uses the URL-safe characters', () => {
    // "???" encodes to a run containing `/` in plain base64, which base64URL
    // writes as `_` — the character atob refuses.
    const token = jwt({ exp: 2_000_000_000, sub: 'user-1', note: '???>>>' });
    const payload = token.split('.', 2)[1];
    expect(/[-_]/.test(payload), 'precondition: the payload must contain - or _').toBe(true);

    expect(readTokenExpMs(token)).toBe(2_000_000_000_000);
  });

  it('reads a token with no padding', () => {
    const token = jwt({ exp: 1_900_000_000, a: 'x' });
    expect(token.split('.', 2)[1].endsWith('=')).toBe(false);
    expect(readTokenExpMs(token)).toBe(1_900_000_000_000);
  });

  it('answers null, not a guess, for something that is not a JWT', () => {
    expect(readTokenExpMs('not-a-token')).toBeNull();
    expect(readTokenExpMs('')).toBeNull();
    expect(readTokenExpMs(jwt({ sub: 'no-expiry' }))).toBeNull();
  });
});
