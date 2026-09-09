/**
 * A category conflict still goes to review — that guarantee is
 * `overrideMatchConfidence` staying 0 (see learnedRuleIdentity.test.ts,
 * which pins that a conflict is never auto-filed). What changed is what the
 * reviewer sees when they open it: whichever of the conflicting categories
 * this vendor has actually been filed under most often, instead of nothing.
 * These pin the two properties that would be easy to break without a test
 * noticing — that the suggestion query can never widen who gets auto-filed,
 * and that a failure to compute one degrades to the old behaviour rather
 * than failing the capture.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../notificationProcessor.ts'), 'utf8');

// The block runs inside `if (overrideRuleConflict) { ... }`, right after the
// existing debug log for the same branch.
const conflictBlock = source.slice(
  source.indexOf('routing to review instead of auto-filing'),
  source.indexOf("// 2) proper_name ilike fallback"),
);

describe('the category suggestion on a conflicting vendor', () => {
  it('exists, computed from the conflicting categories', () => {
    expect(conflictBlock).toContain('mostFrequentCategory(');
    expect(conflictBlock).toContain('candidateNames');
  });

  it('never sets overrideMatchConfidence — the one thing that actually gates auto-accept', () => {
    // shouldAutoAccept requires BOTH a category and confidence over the
    // threshold. This block may set the category; it must never also set the
    // confidence, or a conflict could file itself.
    expect(conflictBlock).not.toContain('overrideMatchConfidence =');
  });

  it('is wrapped so a failure here cannot fail the capture', () => {
    expect(conflictBlock).toContain('try {');
    expect(conflictBlock).toContain('} catch (e) {');
  });

  it('only ever suggests one of the categories actually in conflict', () => {
    // The query is scoped to candidateNames, not the user's whole history —
    // a vendor conflicted between Groceries and Other must never come back
    // suggesting Leisure.
    expect(conflictBlock).toMatch(/\.in\('budget', candidateNames\)/);
  });

  it('is scoped to this user only', () => {
    expect(conflictBlock).toContain(".eq('user_id', userId)");
  });
});
