/**
 * Teach the CHAIN, not the branch — but only for chains where every branch
 * genuinely means the same spending.
 *
 * A household that had visited three Wendy's locations had three separate
 * rules, because a rule's match_key has to be what the bank literally sends,
 * and each branch sends a different string. `chainAwareMatchKey` decides when
 * it is safe to write a shorter, chain-level key instead — see the file
 * header for exactly why the list stays short and grocery/big-box chains are
 * deliberately excluded (Costco has a gas bar; a blanket rule would have
 * forced that charge into whatever category the warehouse run was taught).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chainAwareMatchKey } from '../chainVendorKeys';
import { toVendorKey } from '../deviceTransactionParser';

describe('chainAwareMatchKey — generalises a known chain with a branch appended', () => {
  it.each([
    ["wendyscrowfoot", "wendys"],
    ["wendysolympic", "wendys"],
    ["wendyscochrane", "wendys"],
    ["mcdonalds4021", "mcdonalds"],
    ["timhortons20024", "timhortons"],
    ["starbucksstore6612", "starbucks"],
    ["subway45512", "subway"],
    ["dominos221", "dominos"],
  ])('%s -> prefix "%s"', (key, root) => {
    const result = chainAwareMatchKey(key);
    expect(result).toEqual({ matchKey: root, matchType: 'prefix' });
  });

  it('does not generalise the bare chain name with nothing appended', () => {
    // Nothing to generalise away — the incoming key already IS the chain's
    // own name, so it stays exact.
    expect(chainAwareMatchKey('wendys')).toEqual({ matchKey: 'wendys', matchType: 'exact' });
    expect(chainAwareMatchKey('subway')).toEqual({ matchKey: 'subway', matchType: 'exact' });
  });

  it('leaves an unrecognised merchant exactly as it was', () => {
    expect(chainAwareMatchKey('lolalashbarcrowfoot')).toEqual({
      matchKey: 'lolalashbarcrowfoot',
      matchType: 'exact',
    });
    expect(chainAwareMatchKey('rossocoffeeroasters')).toEqual({
      matchKey: 'rossocoffeeroasters',
      matchType: 'exact',
    });
  });

  it('is safe on empty input', () => {
    expect(chainAwareMatchKey('')).toEqual({ matchKey: '', matchType: 'exact' });
  });

  it('never fires on a name that merely starts the same way by coincidence', () => {
    // "KFC" is excluded by the length gate (3 chars); nothing else in the
    // curated list should accidentally prefix-match an unrelated word.
    expect(chainAwareMatchKey('kfconsulting').matchType).toBe('exact');
  });
});

describe('chainAwareMatchKey — deliberately excludes mixed-category chains', () => {
  // Every one of these sells across categories at at least some branches —
  // most of them because merchantCategorySignals.ts's CHAIN_NAME_WINS_RE
  // already documents exactly that. Costco is the one with real evidence: a
  // household's own Costco rules split Groceries and Transport, because of
  // the gas bar. A blanket "costco" rule would have forced the gas charge
  // into whatever the warehouse run was taught, silently, at full confidence.
  const mixedCategoryChains = [
    'costco', 'walmart', 'loblaws', 'sobeys', 'safeway', 'nofrills',
    'realcanadiansuperstore', 'superstore', 'metro', 'shoppersdrugmart',
    'canadiantire', 'target', 'wholefoods', 'traderjoes', 'kroger',
    'publix', 'aldi', 'lidl', 'wegmans', 'ikea',
  ];

  it.each(mixedCategoryChains)('%s is never generalised', (name) => {
    const result = chainAwareMatchKey(`${name}branch123`);
    expect(result.matchType, name).toBe('exact');
  });

  it('has no overlap between the safe list and the excluded list', () => {
    // A cross-check against the source: every curated chain name, reduced to
    // the same key `chainAwareMatchKey` would compute, must not equal one of
    // the mixed-category keys above. If a future edit to CHAIN_NAMES ever
    // added, say, "Costco", this fails the build instead of shipping a chain
    // both files disagree about.
    const source = readFileSync(resolve(__dirname, '../chainVendorKeys.ts'), 'utf8');
    const listBlock = source.slice(
      source.indexOf('const CHAIN_NAMES'),
      source.indexOf('];', source.indexOf('const CHAIN_NAMES')),
    );
    const quoted = listBlock.match(/'([^']+)'/g) || [];
    const curatedKeys = quoted.map((q) => toVendorKey(q.slice(1, -1)));
    for (const excludedKey of mixedCategoryChains) {
      expect(curatedKeys, excludedKey).not.toContain(excludedKey);
    }
  });
});

describe('chainAwareMatchKey — the root key comes from the real toVendorKey', () => {
  it('folds a chain name the same way an incoming notification would be folded', () => {
    // If this ever drifted from the app's own key normaliser, a chain that
    // matches in the list would stop matching in practice.
    expect(toVendorKey("Wendy's")).toBe('wendys');
    expect(chainAwareMatchKey(toVendorKey("WENDY'S CROWFOOT"))).toEqual({
      matchKey: 'wendys',
      matchType: 'prefix',
    });
  });
});
