import { describe, it, expect } from 'vitest';
import { resolveToastMessage } from '../toastSubject';
import type { Toast, Transaction } from '../../types';
import { Recurrence } from '../../types';

/**
 * The toast that reports a filed capture names the vendor. Renaming the row
 * while that strip is still on screen used to leave the old name sitting at
 * the bottom of the display, which reads as the rename not having saved.
 */

const tx = (id: string, vendor: string): Transaction => ({
  id,
  user_id: 'u1',
  vendor,
  amount: 105.94,
  date: '2026-08-21T12:00:00.000Z',
  budget_id: 'leisure',
  recurrence: Recurrence.ONE_TIME,
  label: 'Automatic',
  is_projected: false,
  created_at: '2026-08-21T19:54:04.804Z',
});

const filedToast = (id: string, vendor: string): Toast => ({
  message: `Filed ${vendor}`,
  tone: 'info',
  subject: { transactionId: id, vendor },
  action: { label: 'Undo', run: () => {} },
});

describe('resolveToastMessage', () => {
  it('shows the new name when the row has been renamed since', () => {
    const toast = filedToast('t1', 'Tst-pizza Culture');
    expect(resolveToastMessage(toast, [tx('t1', 'Pizza Culture')])).toBe('Filed Pizza Culture');
  });

  it('leaves the message alone when nothing has changed', () => {
    const toast = filedToast('t1', 'Tst-pizza Culture');
    expect(resolveToastMessage(toast, [tx('t1', 'Tst-pizza Culture')])).toBe('Filed Tst-pizza Culture');
  });

  it('keeps the recorded name when the row is gone', () => {
    const toast = filedToast('t1', 'Tst-pizza Culture');
    expect(resolveToastMessage(toast, [tx('t2', 'Superstore')])).toBe('Filed Tst-pizza Culture');
  });

  it('rewrites every mention, so a longer sentence stays consistent', () => {
    const toast: Toast = {
      message: 'Learned Tst-pizza Culture → Leisure · that vendor will now ask',
      tone: 'info',
      subject: { transactionId: 't1', vendor: 'Tst-pizza Culture' },
    };
    expect(resolveToastMessage(toast, [tx('t1', 'Pizza Culture')])).toBe(
      'Learned Pizza Culture → Leisure · that vendor will now ask',
    );
  });

  it('passes messages with no named row straight through', () => {
    const toast: Toast = { message: 'Filed 3 transactions', tone: 'info' };
    expect(resolveToastMessage(toast, [tx('t1', 'Pizza Culture')])).toBe('Filed 3 transactions');
  });

  it('ignores a blank recorded name rather than mangling the message', () => {
    const toast: Toast = {
      message: 'Filed something',
      tone: 'info',
      subject: { transactionId: 't1', vendor: '' },
    };
    expect(resolveToastMessage(toast, [tx('t1', 'Pizza Culture')])).toBe('Filed something');
  });

  it('keeps the recorded name when the row has lost its vendor', () => {
    const toast = filedToast('t1', 'Tst-pizza Culture');
    expect(resolveToastMessage(toast, [tx('t1', '   ')])).toBe('Filed Tst-pizza Culture');
  });
});
