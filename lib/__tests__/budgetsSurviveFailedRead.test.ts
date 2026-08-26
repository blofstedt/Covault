import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  budgetsAfterFailedRead,
  looksLikeWrongColumn,
  worthRetryingWithFreshToken,
} from '../budgetFallback';
import { SYSTEM_CATEGORIES } from '../../constants';

/**
 * The user opened the app and found their budgets back at the starter figures,
 * with the categories they had hidden showing again. Nothing was wrong in the
 * database — every limit was still there, and reopening the app brought them
 * back.
 *
 * The server log of the moment tells the whole story. Four requests left
 * together; settings, transactions and overrides were answered, and the budgets
 * read came back 401 — the access token had rotated in that instant and this
 * one request went out holding the retired one. `loadUserBudgets` then did two
 * things wrong with that one failure:
 *
 *   1. It answered a 401 by re-asking for a column this schema does not have
 *      (the user_uuid/user_id fallback, which ran on any non-ok status), so the
 *      recoverable failure became a certain 400.
 *   2. It then put SYSTEM_CATEGORIES into app state — reading "I could not
 *      ask" as "you have not set any budgets".
 *
 * Step 2 is the damaging one, and not only on screen: the limits shown are what
 * the settings screen edits and writes back, so the starter figures sat one tap
 * away from being saved over the real ones.
 *
 * There is no React renderer in this project's test setup, so the rule lives in
 * lib/budgetFallback.ts where it can be exercised, and the wiring around it is
 * pinned by reading the source. What cannot be tested here is the phone.
 */

const source = readFileSync(
  resolve(__dirname, '../hooks/useDataLoading.ts'),
  'utf8',
);

describe('what a failed budgets read may change', () => {
  it('leaves the budgets already on screen alone', () => {
    const mine = [
      { id: 'budget:groceries', name: 'Groceries', totalLimit: 1000 },
      { id: 'budget:transport', name: 'Transport', totalLimit: 1952 },
    ];
    expect(budgetsAfterFailedRead(mine, SYSTEM_CATEGORIES)).toBe(mine);
  });

  it('does not quietly reset a limit to the starter figure', () => {
    const mine = [{ id: 'budget:housing', name: 'Housing', totalLimit: 1148 }];
    const after = budgetsAfterFailedRead(mine, SYSTEM_CATEGORIES);
    expect(after.map((b) => b.totalLimit)).toEqual([1148]);
  });

  it('still seeds the starter set when there is genuinely nothing', () => {
    // A first-ever load, where showing something beats showing an empty
    // dashboard and nothing of the user's can be lost.
    expect(budgetsAfterFailedRead([], SYSTEM_CATEGORIES)).toBe(SYSTEM_CATEGORIES);
  });
});

describe('which failures mean what', () => {
  it('retries only a 401, which is the one a new token fixes', () => {
    expect(worthRetryingWithFreshToken(401)).toBe(true);
    // A policy refusal and a server fault are not helped by asking again.
    expect(worthRetryingWithFreshToken(403)).toBe(false);
    expect(worthRetryingWithFreshToken(500)).toBe(false);
    expect(worthRetryingWithFreshToken(200)).toBe(false);
  });

  it('tries the other column name only where the column is the complaint', () => {
    expect(looksLikeWrongColumn(400)).toBe(true);
    expect(looksLikeWrongColumn(404)).toBe(true);
    // The bug: a 401 sent the loader after a column this schema lacks.
    expect(looksLikeWrongColumn(401)).toBe(false);
    expect(looksLikeWrongColumn(403)).toBe(false);
    expect(looksLikeWrongColumn(500)).toBe(false);
  });
});

describe('the loader is wired to those rules', () => {
  it('has no path left that overwrites budgets with the starter set', () => {
    // Every former `budgets: SYSTEM_CATEGORIES` assignment was an unconditional
    // overwrite on failure. The only mention that may remain is the seeding
    // helper's, which goes through budgetsAfterFailedRead.
    expect(source).not.toContain('budgets: SYSTEM_CATEGORIES');
    expect(source).toContain('budgetsAfterFailedRead');
  });

  it('routes every failure path through the seeding helper', () => {
    const calls = source.match(/seedDefaultBudgetsIfEmpty\(\)/g) ?? [];
    // The three ways the read can fail: table missing, non-ok, thrown.
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('retries the read once with a freshly read token', () => {
    expect(source).toContain('worthRetryingWithFreshToken(res.status)');
    expect(source).toContain('clearCachedAccessToken()');
  });

  it('keeps the column-name fallback, but behind the right question', () => {
    // The fallback is load-bearing — some installs really do use user_id — so
    // it must survive, just not as the answer to every failure.
    expect(source).toContain('looksLikeWrongColumn(res.status)');
    expect(source).toContain('user_id=eq.${userId}');
  });
});
