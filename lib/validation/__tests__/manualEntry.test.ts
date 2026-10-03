import { describe, expect, it } from 'vitest';
import { Recurrence } from '../../../types';
import { createManualEntrySchema, type ManualEntryDraft } from '../manualEntry';

const schema = createManualEntrySchema(['food', 'transport']);
const draft: ManualEntryDraft = {
  amount: '12.34', vendor: '  A&W   Market  ', budgetId: 'food',
  date: '2024-02-29', recurrence: Recurrence.MONTHLY, isRefund: false,
};

describe('completed manual entry', () => {
  it('returns exact money and a cleaned vendor without changing their case', () => {
    expect(schema.safeParse(draft)).toEqual({
      success: true,
      data: {
        amount: 12.34, vendor: 'A&W Market', budgetId: 'food',
        date: '2024-02-29', recurrence: Recurrence.MONTHLY, isRefund: false,
      },
    });
  });

  it.each([
    ['amount', '12abc', 'Enter an amount greater than zero, with up to two decimal places.'],
    ['amount', '0', 'Enter an amount greater than zero, with up to two decimal places.'],
    ['amount', '12.345', 'Enter an amount greater than zero, with up to two decimal places.'],
    ['amount', '1e3', 'Enter an amount greater than zero, with up to two decimal places.'],
    ['amount', '10000000000', 'Enter an amount of $9,999,999,999.99 or less.'],
    ['amount', '90071992547409.90', 'Enter an amount of $9,999,999,999.99 or less.'],
    ['vendor', ' \t\n ', 'Name the vendor.'],
    ['budgetId', 'deleted-vault', 'Choose a target vault.'],
    ['budgetId', null, 'Choose a target vault.'],
    ['date', '2026-02-29', 'Choose a valid date.'],
    ['date', '2026-04-31', 'Choose a valid date.'],
    ['date', 'tomorrow', 'Choose a valid date.'],
    ['recurrence', 'Weekly', 'Choose a recurrence.'],
    ['isRefund', 'true', 'Choose Expense or Refund.'],
  ])('rejects invalid %s with a repair instruction', (field, value, message) => {
    const result = schema.safeParse({ ...draft, [field]: value });
    if (result.success) throw new Error('Invalid draft was accepted');
    expect(result.error.issues.map(issue => ({ path: issue.path, message: issue.message })))
      .toContainEqual({ path: [field], message });
  });

  it('accepts a refund choice and yearly recurrence without changing the magnitude', () => {
    expect(schema.safeParse({ ...draft, amount: '0.01', isRefund: true, recurrence: Recurrence.YEARLY })).toEqual({
      success: true,
      data: {
        amount: 0.01, vendor: 'A&W Market', budgetId: 'food',
        date: '2024-02-29', recurrence: Recurrence.YEARLY, isRefund: true,
      },
    });
  });

  it('accepts only the choices handed to it, including an existing hidden vault', () => {
    const available = createManualEntrySchema(['existing-hidden']);
    expect(available.safeParse({ ...draft, budgetId: 'existing-hidden' })).toEqual({
      success: true,
      data: {
        amount: 12.34, vendor: 'A&W Market', budgetId: 'existing-hidden',
        date: '2024-02-29', recurrence: Recurrence.MONTHLY, isRefund: false,
      },
    });
    const missing = available.safeParse(draft);
    if (missing.success) throw new Error('Unavailable vault was accepted');
    expect(missing.error.issues.map(issue => issue.path)).toEqual([['budgetId']]);
  });
});
