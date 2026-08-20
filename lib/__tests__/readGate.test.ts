import { describe, it, expect } from 'vitest';
import { createReadGate } from '../readGate';

/**
 * The rule that stops a slow answer from undoing a purchase.
 *
 * Two reads of the transaction list are in flight whenever the app is launched
 * by tapping a capture notification: the one the launch issues, and the one the
 * capture issues after writing its row. Both REPLACE the list. When the launch
 * read — sent first, from before the row existed — came back last, the list
 * went back to not having the purchase in it, and nothing reloaded again.
 *
 * On a capture waiting in review that was survivable; the user files it and the
 * PATCH reloads. On one filed automatically there is nothing to file, so the
 * purchase simply was not on screen — and it was typed in a second time.
 */
describe('the read gate', () => {
  it('applies the first answer, when nothing has been applied yet', () => {
    const gate = createReadGate();

    expect(gate.accepts(gate.take())).toBe(true);
  });

  it('refuses an older read that answers after a newer one', () => {
    const gate = createReadGate();
    const launch = gate.take();   // issued at app start, before the capture
    const capture = gate.take();  // issued once the captured row was written

    // The capture's answer lands first — it knows about the purchase.
    expect(gate.accepts(capture)).toBe(true);
    // Then the launch's answer arrives, carrying a list from before it.
    expect(gate.accepts(launch)).toBe(false);
  });

  it('applies them in order when they answer in order', () => {
    const gate = createReadGate();
    const first = gate.take();
    const second = gate.take();

    expect(gate.accepts(first)).toBe(true);
    expect(gate.accepts(second)).toBe(true);
  });

  it('keeps refusing everything older, not just the one it last saw', () => {
    const gate = createReadGate();
    const a = gate.take();
    const b = gate.take();
    const c = gate.take();

    expect(gate.accepts(c)).toBe(true);
    expect(gate.accepts(b)).toBe(false);
    expect(gate.accepts(a)).toBe(false);
  });

  it('lets a later read win again after an older one was refused', () => {
    // A refusal must not wedge the gate: the next read the app issues — a
    // resume, a pull-to-refresh — still has to be able to update the screen.
    const gate = createReadGate();
    const stale = gate.take();
    const fresh = gate.take();
    gate.accepts(fresh);
    gate.accepts(stale);

    expect(gate.accepts(gate.take())).toBe(true);
  });

  it('gives every read its own ticket', () => {
    const gate = createReadGate();
    const tickets = [gate.take(), gate.take(), gate.take()];

    expect(new Set(tickets).size).toBe(3);
  });

  it('keeps two gates independent', () => {
    // One gate per hook instance. Sharing module state between them would let
    // one screen's read silence another's.
    const a = createReadGate();
    const b = createReadGate();
    a.take();
    a.accepts(a.take());

    expect(b.accepts(b.take())).toBe(true);
  });
});
