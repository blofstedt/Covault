import { afterEach, describe, expect, it, vi } from 'vitest';
import { callRpc, clearCachedAccessToken, setCachedAccessToken } from '../apiHelpers';

afterEach(() => {
  vi.unstubAllGlobals();
  clearCachedAccessToken();
});

describe('callRpc failure certainty', () => {
  it('marks an HTTP rejection as confirmed even when the response body cannot be read', async () => {
    setCachedAccessToken(`header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: vi.fn().mockRejectedValue(new Error('private response stream detail')),
    }));

    const result = await callRpc('delete_own_account', {});

    expect(result).toMatchObject({
      ok: false,
      failureKind: 'rejected',
      message: 'Request failed (403)',
    });
  });

  it('keeps a thrown transport detail for internal diagnostics and classifies the result as unknown', async () => {
    const diagnostic = 'socket closed with private transport detail';
    setCachedAccessToken(`header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(diagnostic)));

    const result = await callRpc('delete_own_account', {});

    expect(result).toEqual({ ok: false, failureKind: 'unknown', message: diagnostic });
  });

  it('treats a successful HTTP response with invalid JSON as unknown', async () => {
    setCachedAccessToken(`header.${btoa(JSON.stringify({ exp: Date.now() / 1000 + 3600 }))}.signature`);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{', { status: 200 })));

    const result = await callRpc('delete_own_account', {});

    expect(result).toMatchObject({ ok: false, failureKind: 'unknown' });
    expect(result.message).toMatch(/JSON|position|end/i);
  });
});
