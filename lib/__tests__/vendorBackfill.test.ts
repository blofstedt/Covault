import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the in-memory matching logic via a small re-export shim. The
// network-dependent functions (count/apply) are tested with a mocked
// fetch, focused on URL construction and request shape.

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { normalizeVendorKey, countBackfillMatches, applyVendorBackfill } from '../vendorBackfill';

describe('normalizeVendorKey', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normalizeVendorKey('AMZN MKTP CA')).toBe('amznmktpca');
    expect(normalizeVendorKey('PayPal *DoorDash')).toBe('paypaldoordash');
    expect(normalizeVendorKey("Tim Horton's")).toBe('timhortons');
  });
  it('handles empty string', () => {
    expect(normalizeVendorKey('')).toBe('');
  });
  it('collapses multi-byte chars to alphanumeric only', () => {
    expect(normalizeVendorKey('Lola Lash Bar!')).toBe('lolalashbar');
  });
});

describe('countBackfillMatches (in-memory semantics)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('counts exact matches', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => [
        { vendor: 'AMZN MKTP' },
        { vendor: 'AMZN MKTP' },
        { vendor: 'Walmart' },
      ],
    });
    const n = await countBackfillMatches('user-1', 'amznmktp', 'exact');
    expect(n).toBe(2);
  });

  it('counts prefix matches', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => [
        { vendor: 'AMZN MKTP CA' },
        { vendor: 'AMZN MKTP US' },
        { vendor: 'Walmart' },
      ],
    });
    const n = await countBackfillMatches('user-1', 'amznmktp', 'prefix');
    expect(n).toBe(2);
  });

  it('counts contains matches (case-insensitive)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers(),
      json: async () => [
        { vendor: 'AMZN MKTP CA' },
        { vendor: 'PAYPAL *AMZN MKT' },
        { vendor: 'Walmart' },
      ],
    });
    const n = await countBackfillMatches('user-1', 'amzn', 'contains');
    expect(n).toBe(2);
  });

  it('returns 0 when fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => [] });
    const n = await countBackfillMatches('user-1', 'amzn', 'exact');
    expect(n).toBe(0);
  });

  it('returns 0 when match key is empty', async () => {
    const n = await countBackfillMatches('user-1', '', 'exact');
    expect(n).toBe(0);
  });
});

describe('applyVendorBackfill', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('patches matching transactions in chunks of 50', async () => {
    // First call: fetch all transactions
    const allTxs = Array.from({ length: 120 }, (_, i) => ({
      id: `tx-${i}`,
      vendor: i < 60 ? 'AMZN MKTP' : 'Walmart',
    }));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => allTxs,
    });
    // Second call: patch chunk 1 (50 rows)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(allTxs.slice(0, 50)),
    });
    // Third call: patch chunk 2 (10 rows)
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(allTxs.slice(50, 60)),
    });

    const result = await applyVendorBackfill('user-1', 'amznmktp', 'Amazon', 'exact');
    // 50 (chunk 1) + 10 (chunk 2) = 60
    expect(result.updated).toBe(60);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns 0 when no transactions match', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'tx-1', vendor: 'Walmart' }],
    });
    const result = await applyVendorBackfill('user-1', 'amznmktp', 'Amazon', 'exact');
    expect(result.updated).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the fetch, no patch
  });

  it('returns 0 when input is empty', async () => {
    const result = await applyVendorBackfill('user-1', '', 'Amazon', 'exact');
    expect(result.updated).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves sample of updated rows for toast', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'tx-1', vendor: 'AMZN MKTP' },
        { id: 'tx-2', vendor: 'AMZN MKTP' },
        { id: 'tx-3', vendor: 'AMZN MKTP' },
      ],
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => '[]',
    });
    const result = await applyVendorBackfill('user-1', 'amznmktp', 'Amazon', 'exact');
    expect(result.sample).toHaveLength(3);
    expect(result.sample[0].vendor).toBe('Amazon');
  });
});
