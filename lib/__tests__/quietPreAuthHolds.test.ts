import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.has(k) ? this.store.get(k)! : null; }
  setItem(k: string, v: string) { this.store.set(k, String(v)); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
}
vi.stubGlobal('localStorage', new MemoryStorage());

import { parseNotificationText } from '../deviceTransactionParser';
import {
  rememberHold, settleHold, holdsToAsk, forgetHold, readHolds, pruneHolds,
  HOLD_SETTLE_DAYS, MIN_HOLD_TO_ASK,
} from '../pendingHold';

/**
 * Money held is not money spent, and the app may say neither that it was nor
 * that it wasn't.
 *
 * A hotel, a car rental or a pay-at-pump station reserves a figure it chose.
 * The parser has always refused to record it — correctly: the held number is
 * almost never what was spent. But the phone's listener knew nothing about
 * holds, so it announced every one as a captured purchase and nudged the
 * home-screen widget, which put a $340 hotel hold on the home screen as
 * spending until the app was next opened.
 *
 * And refusing in silence loses the other half: when the charge settles and
 * the bank sends nothing the second time, that purchase is simply gone.
 */

const LISTENER = readFileSync(
  resolve(__dirname, '../../android-custom/NotificationListener.java'), 'utf8');
const PARSER = readFileSync(
  resolve(__dirname, '../../lib/deviceTransactionParser.ts'), 'utf8');

function listFrom(source: string, marker: string): string[] {
  const start = source.indexOf(`${marker}_BEGIN`);
  const end = source.indexOf(`${marker}_END`, start);
  expect(start, `${marker} not found`).toBeGreaterThan(-1);
  return [...source.slice(start, end).matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

describe('the phone and the parser agree on what a hold is', () => {
  it('carries the same hold phrases on both sides', () => {
    // The whole safety argument for silencing anything: the listener runs with
    // the app closed and nothing downstream can recover a spend it decided to
    // ignore, so it may only ever be a COPY of a refusal the parser already
    // makes — never an opinion of its own.
    const parser = PARSER.slice(PARSER.indexOf('const PRE_AUTH_PHRASES'));
    const fromParser = [...parser.slice(0, parser.indexOf('];')).matchAll(/'([^']+)'/g)]
      .map((m) => m[1]);
    expect(listFrom(LISTENER, '// PRE_AUTH_PHRASES')).toEqual(fromParser);
  });

  it('carries the same settlement words, which beat a hold word', () => {
    const parser = PARSER.slice(PARSER.indexOf('const SETTLEMENT_PHRASES'));
    const fromParser = [...parser.slice(0, parser.indexOf('];')).matchAll(/'([^']+)'/g)]
      .map((m) => m[1]);
    expect(listFrom(LISTENER, '// SETTLEMENT_PHRASES')).toEqual(fromParser);
  });

  it('knows the bare verb cannot be a substring', () => {
    // 'held' also matches "withheld" and "upheld", which are not holds.
    expect(LISTENER).toContain('HELD_VERB = Pattern.compile("\\\\bheld\\\\b")');
  });
});

describe('the listener stays quiet about a hold', () => {
  it('has a verdict of its own, folded into the one quiet flag', () => {
    expect(LISTENER).toMatch(/boolean onlyHeld = /);
    expect(LISTENER).toMatch(
      /boolean captureQuietly = ignoredByUser \|\| knownRecurring \|\| notAPurchase \|\| moneyComingIn\s*\n\s*\|\| chargeDidNotHappen \|\| nothingSpent \|\| onlyHeld;/);
  });

  it('leaves the bank its own alert, and says why', () => {
    // Covault posted nothing, so there is nothing to dismiss it in favour of —
    // and for a hotel hold the bank's alert is the user's only notice that a
    // figure is sitting against their card.
    expect(LISTENER).toMatch(/if \(onlyHeld\) \{\s*\n\s*recordOutcome\([^)]*OUTCOME_ONLY_HELD\);/);
  });
});

describe('the parser still refuses every hold, gas included', () => {
  // This is why copying the rule to the phone is faithful rather than a new
  // opinion: the hold test returns before a vendor is even extracted, so no
  // row is ever created from one.
  for (const text of [
    'Authorization hold of $340.00 at MARRIOTT DOWNTOWN',
    'A temporary hold of $250.00 was placed at HERTZ',
    'Held $75.00 at PETRO-CANADA',
    'Authorized $150.00 at SHELL',
    'Pending transaction: $88.00 at ENTERPRISE RENT A CAR',
  ]) {
    it(`refuses "${text.slice(0, 34)}…"`, () => {
      const parsed = parseNotificationText(text);
      expect(parsed.isOutgoing).toBe(false);
      expect(parsed.isPreAuth).toBe(true);
    });
  }

  it('still captures an ordinary completed purchase', () => {
    const parsed = parseNotificationText('A transaction of $18.75 was approved at MCDONALDS');
    expect(parsed.isOutgoing).toBe(true);
  });

  it('captures a hold word that a settlement word overrules', () => {
    const parsed = parseNotificationText('Your pending transaction of $54.10 at HILTON has posted');
    expect(parsed.isOutgoing).toBe(true);
  });
});

describe('remembering a hold rather than recording it', () => {
  const DAY = 86_400_000;
  const NOW = Date.parse('2026-09-13T12:00:00Z');
  beforeEach(() => localStorage.clear());

  it('keeps the hold without ever writing the held amount to a row', () => {
    const hold = rememberHold('Marriott Downtown', 340, NOW);
    expect(hold).not.toBeNull();
    expect(readHolds()).toHaveLength(1);
  });

  it('ignores the pings that mean nothing', () => {
    // A pump's $1 card check is a hold in exactly the same sense. Asking about
    // it trains the user to dismiss the prompt without reading it, which is
    // how the $340 one gets dismissed too.
    expect(rememberHold('Shell', 1, NOW)).toBeNull();
    expect(rememberHold('Shell', MIN_HOLD_TO_ASK - 0.01, NOW)).toBeNull();
    expect(rememberHold('Shell', MIN_HOLD_TO_ASK, NOW)).not.toBeNull();
  });

  it('does not ask twice about one hold two apps reported', () => {
    rememberHold('Marriott Downtown', 340, NOW);
    rememberHold('Marriott Downtown', 340, NOW + 30_000);
    expect(readHolds()).toHaveLength(1);
  });

  it('forgets it when a real charge from that merchant lands', () => {
    rememberHold('Marriott Downtown', 340, NOW);
    // A different amount, which is the normal case — the held figure is the
    // one the hotel picked, not the one that was spent.
    expect(settleHold('Marriott Downtown', NOW + 2 * DAY)?.amount).toBe(340);
    expect(readHolds()).toHaveLength(0);
  });

  it('clears at most one hold per charge', () => {
    // Two stays at one hotel in a week are two purchases. Letting one charge
    // clear both loses the question about the second.
    rememberHold('Marriott Downtown', 340, NOW);
    rememberHold('Marriott Downtown', 512, NOW + DAY);
    settleHold('Marriott Downtown', NOW + 2 * DAY);
    expect(readHolds()).toHaveLength(1);
  });

  it('does not let an unrelated merchant settle it', () => {
    rememberHold('Marriott Downtown', 340, NOW);
    expect(settleHold('Hertz', NOW + DAY)).toBeNull();
    expect(readHolds()).toHaveLength(1);
  });

  it('asks only once a settling charge has had its week', () => {
    rememberHold('Marriott Downtown', 340, NOW);
    expect(holdsToAsk(NOW + 3 * DAY)).toHaveLength(0);
    expect(holdsToAsk(NOW + (HOLD_SETTLE_DAYS + 1) * DAY)).toHaveLength(1);
  });

  it('stops asking about one nobody answered for a month', () => {
    rememberHold('Marriott Downtown', 340, NOW);
    expect(holdsToAsk(NOW + 120 * DAY)).toHaveLength(0);
    pruneHolds(NOW + 120 * DAY);
    expect(readHolds()).toHaveLength(0);
  });

  it('stops asking once the user answers', () => {
    const hold = rememberHold('Marriott Downtown', 340, NOW)!;
    forgetHold(hold.id);
    expect(holdsToAsk(NOW + 30 * DAY)).toHaveLength(0);
  });
});
