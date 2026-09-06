import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Renaming a caught transaction teaches a rule. Two halves have to hold for
 * that to be true from the user's side, and both have failed:
 *
 *   1. The write has to be announced, because the "rules you've taught" card is
 *      loaded once per launch in a completely different tree. The rule went
 *      into the database and the list underneath the renamed row went on
 *      showing what it had fetched at startup — from the outside, exactly what
 *      a rename that taught nothing looks like.
 *
 *   2. A failed insert has to be a failure. It was swallowed, so the caller
 *      logged "override saved" over a rejected write.
 */

const restFetch = vi.fn();
vi.mock('../apiHelpers', () => ({ restFetch: (...args: any[]) => restFetch(...args) }));

import { persistVendorOverride, onVendorOverrideWritten } from '../vendorOverrideWrite';

const ok = (rows: unknown[]) => ({ ok: true, status: 200, text: async () => JSON.stringify(rows) });
const created = () => ({ ok: true, status: 201, text: async () => '' });
const failed = (status: number) => ({ ok: false, status, text: async () => 'boom' });

const params = {
  userId: 'user-1',
  properName: 'Calgary Parking',
  matchKey: 'cgyparkingpaymachine',
  categoryName: 'Transport',
  ilikeFallbackName: 'Cgy Parking Pay Machine',
};

describe('a taught rule announces itself', () => {
  let unsubscribe: (() => void) | null = null;

  beforeEach(() => {
    restFetch.mockReset();
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  it('tells listeners when a new rule was inserted', async () => {
    // The PATCH answers "no such rule" (200 with an empty list), so the rule
    // is inserted.
    restFetch
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(created());

    const heard = vi.fn();
    unsubscribe = onVendorOverrideWritten(heard);

    await persistVendorOverride(params);

    expect(restFetch.mock.calls[1][0]).toBe('/overrides');
    expect(restFetch.mock.calls[1][1].method).toBe('POST');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('tells listeners when an existing rule was updated in place', async () => {
    restFetch.mockResolvedValueOnce(ok([{ id: 'override-1' }]));

    const heard = vi.fn();
    unsubscribe = onVendorOverrideWritten(heard);

    await persistVendorOverride(params);

    expect(heard).toHaveBeenCalledTimes(1);
    // The PATCH matched, so nothing else was sent.
    expect(restFetch).toHaveBeenCalledTimes(1);
  });

  it('stays quiet — and reports — when the write is rejected', async () => {
    restFetch
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(failed(400));

    const heard = vi.fn();
    unsubscribe = onVendorOverrideWritten(heard);

    await expect(persistVendorOverride(params)).rejects.toThrow(/overrides insert failed \(400\)/);
    expect(heard).not.toHaveBeenCalled();
  });

  it('stops telling a listener that has unsubscribed', async () => {
    const heard = vi.fn();
    const off = onVendorOverrideWritten(heard);
    off();

    restFetch.mockResolvedValueOnce(ok([{ id: 'override-1' }]));
    await persistVendorOverride(params);

    expect(heard).not.toHaveBeenCalled();
  });

  it('one throwing listener does not stop the next', async () => {
    const second = vi.fn();
    const offFirst = onVendorOverrideWritten(() => { throw new Error('nope'); });
    const offSecond = onVendorOverrideWritten(second);

    restFetch.mockResolvedValueOnce(ok([{ id: 'override-1' }]));
    await persistVendorOverride(params);

    offFirst();
    offSecond();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

/**
 * The other end of the wire. A source check rather than a rendered hook: the
 * project has no React testing library, and what matters is that the list
 * subscribes at all — the rule appearing is the whole point of the fix.
 */
describe('the rules list listens for rules taught elsewhere', () => {
  const source = readFileSync(
    resolve(__dirname, '../../components/transaction_parsing/useVendorOverrides.ts'),
    'utf8',
  );

  it('subscribes to the write and re-reads its list', () => {
    expect(source).toContain("import { onVendorOverrideWritten } from '../../lib/vendorOverrideWrite'");
    expect(source).toMatch(/onVendorOverrideWritten\(\(\)\s*=>\s*\{\s*void loadVendorOverrides\(\);\s*\}\)/);
  });

  it('returns the unsubscribe from the effect, so a remount cannot stack listeners', () => {
    expect(source).toMatch(/useEffect\(\(\)\s*=>\s*onVendorOverrideWritten\(/);
  });
});

/**
 * The rename path itself. Pinned because the teach happens as a side effect of
 * a transaction update — easy to lose in a refactor of that function, and
 * silent when it goes.
 */
describe('renaming a caught transaction still teaches', () => {
  const source = readFileSync(resolve(__dirname, '../hooks/useTransactionOps.ts'), 'utf8');

  it('writes the rule against the name the BANK sends, not the one typed', () => {
    expect(source).toContain('const vendorKey = toVendorKey(originalVendorName) || toVendorKey(newVendorName)');
    expect(source).toMatch(/persistVendorOverride\(\{[\s\S]*?matchKey: vendorKey/);
    expect(source).toMatch(/persistVendorOverride\(\{[\s\S]*?properName: newVendorName/);
  });
});
