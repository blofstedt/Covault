/**
 * The community pack is parsed once, not once per merchant looked up.
 *
 * Review asks about every row it draws, and the pack can hold twenty thousand
 * merchants. Parsing all of it for each question was a main-thread cost paid
 * over and over for the same answer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

class MemoryStorage {
  private store: Record<string, string> = {};
  getItem(key: string) { return key in this.store ? this.store[key] : null; }
  setItem(key: string, value: string) { this.store[key] = value; }
  removeItem(key: string) { delete this.store[key]; }
  clear() { this.store = {}; }
}

const PACK_KEY = 'covault_community_rules_v1';

const pack = (rules: Array<{ matchKey: string; category: string }>) =>
  JSON.stringify({ fetchedAt: Date.now(), rules });

describe('looking a merchant up in the community pack', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses the stored pack once for any number of lookups', async () => {
    const { lookupCommunityRule } = await import('../communityRules');
    const stored = pack([
      { matchKey: 'costco', category: 'Groceries' },
      { matchKey: 'shell', category: 'Transport' },
    ]);
    localStorage.setItem(PACK_KEY, stored);

    const parse = vi.spyOn(JSON, 'parse');
    for (let i = 0; i < 50; i++) {
      expect(lookupCommunityRule('costco')?.category).toBe('Groceries');
      expect(lookupCommunityRule('shell')?.category).toBe('Transport');
      expect(lookupCommunityRule('unknown')).toBeNull();
    }
    const packParses = parse.mock.calls.filter(([text]) => text === stored);
    expect(packParses).toHaveLength(1);
  });

  it('reads a refreshed pack rather than answering from the old one', async () => {
    const { lookupCommunityRule } = await import('../communityRules');
    localStorage.setItem(PACK_KEY, pack([{ matchKey: 'costco', category: 'Groceries' }]));
    expect(lookupCommunityRule('costco')?.category).toBe('Groceries');

    localStorage.setItem(PACK_KEY, pack([{ matchKey: 'costco', category: 'Shopping' }]));
    expect(lookupCommunityRule('costco')?.category).toBe('Shopping');

    localStorage.removeItem(PACK_KEY);
    expect(lookupCommunityRule('costco')).toBeNull();
  });

  it('keeps the first answer for a key listed twice, as the old scan did', async () => {
    const { lookupCommunityRule } = await import('../communityRules');
    localStorage.setItem(
      PACK_KEY,
      pack([
        { matchKey: 'costco', category: 'Groceries' },
        { matchKey: 'costco', category: 'Transport' },
      ]),
    );
    expect(lookupCommunityRule('COSTCO')?.category).toBe('Groceries');
  });

  it('treats a corrupt pack as no pack', async () => {
    const { lookupCommunityRule } = await import('../communityRules');
    localStorage.setItem(PACK_KEY, '{not json');
    expect(lookupCommunityRule('costco')).toBeNull();
  });
});
