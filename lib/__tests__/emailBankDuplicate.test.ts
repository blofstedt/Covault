import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  hasPairedEmail,
  isBankSourcedRow,
  isEmailSourcedRow,
  readCaptureMarker,
  stripCaptureBookkeeping,
  stripCaptureMarker,
  withCaptureMarker,
  withEmailPairedMarker,
} from '../captureChannel';
import { isSameCharge } from '../duplicateCharge';
import { withFuelHoldMarker, readFuelHoldMarker, stripFuelHoldMarker } from '../fuelHold';

const PROCESSOR = readFileSync(resolve(__dirname, '../notificationProcessor.ts'), 'utf-8');

/**
 * One purchase, one row — however many ways the bank announces it.
 *
 * Most banks send both a push and an email for the same charge, and the two are
 * not remotely the same string, so every fingerprint check in the pipeline sees
 * two unrelated events. The near-duplicate check almost catches it and then
 * misses: it demands the same day and the same cent, while an email routinely
 * arrives the next morning and occasionally rounds differently.
 *
 * The rule that closes it has to be careful in both directions. Dropping too
 * eagerly loses a real purchase — which is the failure this app treats as
 * unacceptable — and dropping too little puts every charge on the dashboard
 * twice.
 */
describe('recording which route a capture arrived by', () => {
  it('round-trips, and reads back the app it came from', () => {
    const marked = withCaptureMarker('You spent $12.00 at CAFE', {
      channel: 'email',
      packageName: 'com.google.android.gm',
    });
    expect(readCaptureMarker(marked)).toEqual({
      channel: 'email',
      packageName: 'com.google.android.gm',
    });
    expect(stripCaptureMarker(marked)).toBe('You spent $12.00 at CAFE');
  });

  it('never leaves bookkeeping in text shown to the user', () => {
    const marked = withEmailPairedMarker(
      withCaptureMarker('You spent $12.00 at CAFE', { channel: 'bank' }),
    );
    expect(stripCaptureBookkeeping(marked)).toBe('You spent $12.00 at CAFE');
    expect(stripCaptureBookkeeping(marked)).not.toContain('covault:');
  });

  it('replaces rather than stacks when re-marked', () => {
    const once = withCaptureMarker('text', { channel: 'email' });
    const twice = withCaptureMarker(once, { channel: 'bank' });
    expect(readCaptureMarker(twice)?.channel).toBe('bank');
    expect(twice.match(/covault:capture/g)).toHaveLength(1);
  });

  it('coexists with the fuel-hold marker without disturbing it', () => {
    // Both markers live in the same column. Each must read and strip only its
    // own, or a fuel placeholder stops being recognised the moment email ships.
    const hold = { holdAmount: 150, placeholderAmount: 100, basis: 'default' as const };
    const both = withCaptureMarker(withFuelHoldMarker('SHELL $150.00', hold), {
      channel: 'bank',
      packageName: 'com.bmo.mobile',
    });
    expect(readFuelHoldMarker(both)).toEqual({ holdAmount: 150, placeholderAmount: 100 });
    expect(readCaptureMarker(both)?.channel).toBe('bank');
    expect(stripCaptureBookkeeping(stripFuelHoldMarker(both))).toBe('SHELL $150.00');
  });
});

describe('deciding what a stored row came from', () => {
  it('reads an unmarked automatic capture as bank-sourced', () => {
    // THE HISTORY CASE. Every row captured before this feature existed carries
    // no marker, and every one of them came from a bank app — email was not a
    // source at all. Read the other way, the app would ignore the entire
    // existing history when deciding whether an email is a duplicate, and file
    // a second copy of purchases the user already has.
    expect(isBankSourcedRow({ raw_notification: 'Purchase of $10', source: 'notification' }))
      .toBe(true);
    expect(isBankSourcedRow({ raw_notification: null, source: 'notification' })).toBe(true);
  });

  it('does not treat a typed-in row as a bank capture', () => {
    expect(isBankSourcedRow({ raw_notification: null, source: 'manual' })).toBe(false);
    expect(isBankSourcedRow({ raw_notification: null, source: 'executor' })).toBe(false);
  });

  it('tells a marked email row from a marked bank row', () => {
    const email = withCaptureMarker('x', { channel: 'email' });
    const bank = withCaptureMarker('x', { channel: 'bank' });
    expect(isEmailSourcedRow({ raw_notification: email })).toBe(true);
    expect(isBankSourcedRow({ raw_notification: email, source: 'notification' })).toBe(false);
    expect(isBankSourcedRow({ raw_notification: bank, source: 'notification' })).toBe(true);
  });

  it('marks a bank row as spent once it has absorbed an email', () => {
    const bank = withCaptureMarker('x', { channel: 'bank' });
    expect(hasPairedEmail(bank)).toBe(false);
    const paired = withEmailPairedMarker(bank);
    expect(hasPairedEmail(paired)).toBe(true);
    // Still recognisably a bank row afterwards.
    expect(isBankSourcedRow({ raw_notification: paired, source: 'notification' })).toBe(true);
  });
});

describe('the tolerance a push-versus-email match needs', () => {
  const push = { vendor: 'LOBLAWS', amount: 42.10, date: '2026-09-01' };

  it('matches the same charge reported a day later and a cent apart', () => {
    // The exact drift that previously left a phantom row on the dashboard.
    expect(isSameCharge(push, { vendor: 'Loblaws #1234', amount: 42.11, date: '2026-09-02' }))
      .toBe(true);
  });

  it('does not match a different purchase at the same shop', () => {
    expect(isSameCharge(push, { vendor: 'LOBLAWS', amount: 71.55, date: '2026-09-02' }))
      .toBe(false);
  });

  it('does not match a refund of the same amount', () => {
    expect(isSameCharge(push, { vendor: 'LOBLAWS', amount: -42.10, date: '2026-09-01' }))
      .toBe(false);
  });

  it('does not reach beyond the window', () => {
    expect(isSameCharge(push, { vendor: 'LOBLAWS', amount: 42.10, date: '2026-09-09' }))
      .toBe(false);
  });
});

/**
 * The rule itself runs deep inside the pipeline, against Supabase. What can be
 * pinned here is its shape — and every one of these guards is load-bearing.
 */
describe('the rule is wired the way it has to be', () => {
  it('only an email defers, so a bank alert is never the one dropped', () => {
    expect(PROCESSOR).toMatch(/input\.channel === 'email' && existingTx/);
  });

  it('an email only ever defers to a bank-sourced row', () => {
    // Never to another email: two mails about two real purchases must both
    // survive.
    expect(PROCESSOR).toMatch(/isBankSourcedRow\(tx\)/);
  });

  it('one email cancels at most one bank row', () => {
    // Without the pairing mark, a second genuine purchase at the same merchant
    // for the same amount inside the window would vanish into the same row —
    // the trap two Fizz charges three days apart already sprang once.
    expect(PROCESSOR).toMatch(/!hasPairedEmail\(tx\.raw_notification\)/);
    expect(PROCESSOR).toMatch(/withEmailPairedMarker\(/);
  });

  it('uses the looser same-charge test, not the same-day same-cent one', () => {
    expect(PROCESSOR).toMatch(/isSameCharge\(\{ vendor, amount, date: today \}/);
  });

  it('a later bank alert upgrades the email row instead of duplicating it', () => {
    expect(PROCESSOR).toMatch(/input\.channel !== 'email' && existingTx/);
    expect(PROCESSOR).toMatch(/isEmailSourcedRow\(tx\)/);
  });

  it('nothing captured from email is ever filed without being seen', () => {
    expect(PROCESSOR).toMatch(/input\.channel !== 'email'\s*\n\s*&& !fuelHold/);
  });

  it('every capture records the route it came by', () => {
    expect(PROCESSOR).toMatch(/raw_notification: withCaptureMarker\(/);
  });

  it('the email sender is vetted before anything else is read', () => {
    expect(PROCESSOR).toMatch(/parseEmailAlert\(\{/);
  });
});
