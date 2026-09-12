/**
 * The "Filed automatically" receipt does not lose rows out from under the
 * person reading it.
 *
 * The card marks its rows read while they are still on screen, which means the
 * very next reload drops them from the list it is handed. Without the
 * retention pinned here, the visible symptom is a card that empties itself
 * mid-read — indistinguishable, to the person watching, from the app losing a
 * purchase. It is the kind of thing a later "simplification" back to reading
 * the prop directly would reintroduce without anything failing.
 */
import { describe, it, expect } from 'vitest';
import { mergeReceiptRows } from '../autoFiledReceipt';
import type { Transaction } from '../../types';

const tx = (id: string, vendor: string, date: string, extra: Partial<Transaction> = {}): Transaction => ({
  id,
  user_id: 'u',
  vendor,
  amount: 10,
  date,
  budget_id: 'b1',
  label: 'Automatic',
  auto_filed: true,
  is_projected: false,
  created_at: `${date}T10:00:00Z`,
  ...extra,
});

describe('mergeReceiptRows', () => {
  it('shows what it is handed on the first pass', () => {
    const shown = new Map<string, Transaction>();
    const rows = mergeReceiptRows(shown, [tx('a', 'Save On Foods', '2026-09-05')]);
    expect(rows.map((r) => r.vendor)).toEqual(['Save On Foods']);
  });

  it('keeps a row that has left the incoming list', () => {
    // This is the one that matters: marking the row read is a write to the
    // row, so the next load legitimately stops returning it — and it still has
    // to stay drawn until the user leaves the page.
    const shown = new Map<string, Transaction>();
    mergeReceiptRows(shown, [tx('a', 'Save On Foods', '2026-09-05')]);
    const afterReload = mergeReceiptRows(shown, []);
    expect(afterReload.map((r) => r.vendor)).toEqual(['Save On Foods']);
  });

  it('takes the newer copy of a row it is already showing', () => {
    // A row moved to another budget has to redraw in its new colour rather
    // than stay pinned to whichever version arrived first.
    const shown = new Map<string, Transaction>();
    mergeReceiptRows(shown, [tx('a', 'Save On Foods', '2026-09-05', { budget_id: 'groceries' })]);
    const rows = mergeReceiptRows(shown, [tx('a', 'Save On Foods', '2026-09-05', { budget_id: 'leisure' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0].budget_id).toBe('leisure');
  });

  it('puts the newest first, however the rows arrived', () => {
    // A retained row and a freshly arrived one come from different places, so
    // the order has to be imposed rather than inherited.
    const shown = new Map<string, Transaction>();
    mergeReceiptRows(shown, [tx('a', 'Older', '2026-09-01')]);
    const rows = mergeReceiptRows(shown, [tx('b', 'Newer', '2026-09-09')]);
    expect(rows.map((r) => r.vendor)).toEqual(['Newer', 'Older']);
  });

  it('drops a row the user has just moved', () => {
    // Moving a row does not unset `auto_filed`, so without this it would come
    // straight back under its new category and restate a decision the user
    // just made.
    const shown = new Map<string, Transaction>();
    const rows = mergeReceiptRows(
      shown,
      [tx('a', 'Save On Foods', '2026-09-05'), tx('b', 'A&W', '2026-09-06')],
      new Set(['a']),
    );
    expect(rows.map((r) => r.vendor)).toEqual(['A&W']);
  });

  it('ignores a row with no id rather than drawing a keyless one', () => {
    const shown = new Map<string, Transaction>();
    const rows = mergeReceiptRows(shown, [
      tx('a', 'Save On Foods', '2026-09-05'),
      { ...tx('', 'Nameless', '2026-09-06'), id: '' },
    ]);
    expect(rows.map((r) => r.vendor)).toEqual(['Save On Foods']);
  });
});
