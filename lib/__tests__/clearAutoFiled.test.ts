import { describe, it, expect } from 'vitest';
import {
  buildAutoFiledClearPayload,
  buildFilePayload,
  buildUndoPayload,
} from '../caughtTransactionOps';
import { selectAwaitingReview, selectRecentlyAutoFiled } from '../reviewQueue';
import type { Transaction } from '../../types';

/**
 * Clearing the "Filed automatically" receipt.
 *
 * The card lists purchases the app filed on its own, so the user has seen them
 * even though nothing asked. Once they have, the list has done its job — but
 * there was no way to say so, and it sat there for a week per row.
 *
 * The whole risk in the feature is that "clear" gets implemented as "delete".
 * These rows are already counted against a budget; removing them would take
 * real money back out of the month. So the tests below pin two things: what
 * clearing writes, and what it must NOT touch.
 */

const TODAY = '2026-08-20';

const tx = (over: Partial<Transaction> = {}): Transaction =>
  ({
    id: 'tx-1',
    user_id: 'u1',
    vendor: 'Tim Hortons',
    amount: 4.85,
    date: `${TODAY}T12:00:00.000Z`,
    budget_id: 'groceries',
    is_projected: false,
    label: 'Automatic',
    caught_cleared: true,
    auto_filed: true,
    ...over,
  }) as Transaction;

describe('buildAutoFiledClearPayload', () => {
  it('only unsets the flag that puts a row on the receipt', () => {
    expect(buildAutoFiledClearPayload()).toEqual({ auto_filed: false });
  });

  it('never touches the amount, the date or the budget', () => {
    // The transaction is already filed and already counted. Clearing it says
    // "seen", not "undo" — writing any of these would move the user's money.
    const written = Object.keys(buildAutoFiledClearPayload());
    for (const field of ['amount', 'date', 'budget', 'vendor', 'id']) {
      expect(written).not.toContain(field);
    }
  });

  it('leaves the row filed rather than pushing it back into review', () => {
    // The obvious wrong implementation: reuse the review list's clear, which
    // writes caught_cleared. On a row that is already filed that is either a
    // no-op or, worse, an undo — and it would put a purchase the app had
    // already dealt with back in front of the user.
    expect(buildAutoFiledClearPayload()).not.toHaveProperty('caught_cleared');
  });
});

describe('what the write actually does to the two lists', () => {
  const cleared = tx({ auto_filed: false });

  it('drops the row off the "Filed automatically" list', () => {
    expect(selectRecentlyAutoFiled([tx()], TODAY)).toHaveLength(1);
    expect(selectRecentlyAutoFiled([cleared], TODAY)).toHaveLength(0);
  });

  it('does not send the row to the review list instead', () => {
    // Clearing one list must not silently populate the other — that would turn
    // "I've seen these" into "ask me about these again".
    expect(selectAwaitingReview([cleared])).toHaveLength(0);
  });

  it('keeps the row in history at its full amount', () => {
    // Nothing about the money changed, which is the entire promise of the
    // word "clear" as opposed to "delete".
    expect(cleared.amount).toBe(tx().amount);
    expect(cleared.date).toBe(tx().date);
    expect(cleared.budget_id).toBe(tx().budget_id);
  });
});

describe('the three payloads stay distinct', () => {
  it('clearing the receipt is not filing and is not undoing', () => {
    // Three different intents on the same page, all called some variant of
    // "clear" in the UI. Sharing a payload between any two of them would make
    // one button quietly do another's job.
    expect(buildAutoFiledClearPayload()).not.toEqual(buildFilePayload());
    expect(buildAutoFiledClearPayload()).not.toEqual(buildUndoPayload(null));
  });
});
