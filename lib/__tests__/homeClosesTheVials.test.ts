import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The home button did nothing.
 *
 * It was wired to `closeParsing`, which sets two pieces of state — the Review
 * page and its highlight nonce — and on the home screen both already hold the
 * values it assigns, so React bailed out of each and no render happened.
 * Pressed with a budget vial open, a search half typed, or a sheet up, it was
 * inert, and there is no way for a user to tell an inert button from a broken
 * app.
 *
 * Source-level, since there is no React test renderer here. What matters is
 * that the handler is not `closeParsing` and that it puts the screen back.
 */
const DASHBOARD = readFileSync(
  resolve(__dirname, '../../components/Dashboard.tsx'),
  'utf8',
);

const goHome = DASHBOARD.slice(
  DASHBOARD.indexOf('const goHome'),
  DASHBOARD.indexOf('const scrollRef'),
);

describe('the home button', () => {
  it('collapses an open vial', () => {
    expect(goHome).toContain('setExpandedBudgets(new Set())');
  });

  it('clears a search, which otherwise replaces the whole list', () => {
    expect(goHome).toContain("setSearchQuery('')");
    expect(goHome).toContain('setIsSearchOpen(false)');
  });

  it('leaves the Review page, which is what it always did', () => {
    expect(goHome).toContain('closeParsing()');
  });

  it('closes anything on top of the dashboard', () => {
    expect(goHome).toContain('setShowSettings(false)');
    expect(goHome).toContain('setSelectedTx(null)');
    expect(goHome).toContain('setShowTransactionForm(false)');
  });

  it('is what both bottom bars call — home means the same thing from either screen', () => {
    expect(DASHBOARD).toContain('onGoHome={goHome}');
    expect(DASHBOARD).not.toContain('onGoHome={closeParsing}');
  });
});
