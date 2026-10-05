import { z } from 'zod';
import { Recurrence } from '../../../types';
import { cleanVendorInput } from '../../vendors/formatVendorName';
import { isManualAmountOverLimit, parseManualAmount } from '../../money/manualAmount';

export const MANUAL_AMOUNT_ERROR = 'Enter an amount greater than zero, with up to two decimal places.';
export const MANUAL_AMOUNT_LIMIT_ERROR = 'Enter an amount of $9,999,999,999.99 or less.';
export const MANUAL_AMOUNT_TYPING_ERROR = 'Enter numbers only, with up to two decimal places.';
export const MANUAL_AMOUNT_PASTE_ERROR = 'Paste an amount only, with up to two decimal places.';

/** Incomplete editing states are allowed, but formatting must not hide errors. */
export const manualAmountDraftSchema = z.string()
  .regex(/^\d*(?:\.\d{0,2})?$/, { error: MANUAL_AMOUNT_TYPING_ERROR })
  .refine(value => !isManualAmountOverLimit(value), { error: MANUAL_AMOUNT_LIMIT_ERROR });

export const manualAmountSchema = z.string({ error: MANUAL_AMOUNT_ERROR })
  .refine(value => !isManualAmountOverLimit(value), { error: MANUAL_AMOUNT_LIMIT_ERROR })
  .transform(parseManualAmount)
  .pipe(z.number({ error: MANUAL_AMOUNT_ERROR }));

/** The completed manual-entry draft, before it becomes a transaction. */
export const manualEntrySchema = z.object({
  amount: manualAmountSchema,
  vendor: z.string({ error: 'Name the vendor.' })
    .transform(cleanVendorInput)
    .pipe(z.string().min(1, { error: 'Name the vendor.' })),
  budgetId: z.string({ error: 'Choose a target vault.' })
    .min(1, { error: 'Choose a target vault.' }),
  date: z.iso.date({ error: 'Choose a valid date.' }),
  recurrence: z.enum(Recurrence, { error: 'Choose a recurrence.' }),
  isRefund: z.boolean({ error: 'Choose Expense or Refund.' }),
});

export type ManualEntryDraft = z.input<typeof manualEntrySchema>;
export type ManualEntry = z.output<typeof manualEntrySchema>;

/** Validate the choice against the vaults this form actually offers. */
export function createManualEntrySchema(selectableBudgetIds: readonly string[]) {
  const selectableIds = new Set(selectableBudgetIds);
  return manualEntrySchema.extend({
    budgetId: manualEntrySchema.shape.budgetId.refine(
      id => selectableIds.has(id),
      { error: 'Choose a target vault.' },
    ),
  });
}
