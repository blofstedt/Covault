// lib/hooks/useTransactionOps.ts
import { log } from '../log';
import { useCallback } from 'react';
import type { Transaction } from '../../types';
import { Recurrence } from '../../types';
import { restFetch } from '../apiHelpers';
import { persistVendorOverride } from '../vendorOverrideWrite';
import { toVendorKey } from '../deviceTransactionParser';
import { cleanVendorInput, formatVendorName } from '../formatVendorName';
import { markReviewQueueStatus, upsertVendorMapEntry } from '../localNotificationMemory';
import { useToSupabaseTransaction, useFromSupabaseTransaction } from './transactionMappers';
import { getSourceTransactionIdFromProjectedId } from '../projectedTransactions';
import { clearCaptureNotificationForRows } from '../covaultNotification';
import {
  applyRecurringDeletePlan,
  planRecurringDelete,
  type RecurringDeletePlan,
} from '../recurringDelete';
import type { UseUserDataParams } from './types';


// Re-exported from where the projected ids are minted, so the pattern has one
// definition. Kept exported here because callers (and tests) already import it
// from this module.
export { getSourceTransactionIdFromProjectedId };

/** PostgREST `in.(...)` list, quoted the way the other bulk calls here do. */
const toIdList = (ids: string[]) => ids.map(id => `"${String(id).replace(/"/g, '')}"`).join(',');

/**
 * The row that is actually written when an edit is saved.
 *
 * Every field the edit form can change is carried across, and the date is one
 * of them: moving an entry to another day — most often forward into next month
 * — used to be dropped here, so the entry snapped back to its original date the
 * moment it was saved, with no error to show for it.
 *
 * The one exception is an edit made on a PROJECTED occurrence. Those are not
 * rows: they are drawn from a recurring row's schedule, and an edit to one is
 * persisted onto that source row, which is a real charge in an earlier month.
 * Writing the occurrence's date onto it would move that historic charge — and
 * with it the whole series — so the source keeps its own date. Changing a
 * projected occurrence's date therefore still does nothing; every other edit to
 * one applies to the series, which is the existing behaviour.
 */
export const buildPersistedUpdateTransaction = (
  updatedTx: Transaction,
  sourceTx?: Transaction,
): Transaction => {
  if (!sourceTx) return updatedTx;
  const isProjectedEdit = getSourceTransactionIdFromProjectedId(updatedTx.id) !== null;
  return {
    ...sourceTx,
    vendor: updatedTx.vendor,
    amount: updatedTx.amount,
    budget_id: updatedTx.budget_id,
    recurrence: updatedTx.recurrence,
    date: isProjectedEdit ? sourceTx.date : updatedTx.date,
    label: updatedTx.label || sourceTx.label,
    userName: updatedTx.userName || sourceTx.userName,
    is_projected: false,
  };
};

export const useTransactionOps = ({
  appState,
  setAppState,
  setDbError,
  categoriesLoaded,
}: UseUserDataParams & { categoriesLoaded: boolean }) => {
  const toSupabaseTransaction = useToSupabaseTransaction(appState.budgets);
  const fromSupabaseTransaction = useFromSupabaseTransaction();

  // Add transaction
  const handleAddTransaction = useCallback(
    async (tx: Transaction) => {
      if (!categoriesLoaded) {
        setDbError('Cannot add transaction: categories not yet loaded');
        return;
      }

      // Log transaction details for debugging
      log.debug('[insert] Creating transaction:', {
        vendor: tx.vendor,
        amount: tx.amount,
        budget_id: tx.budget_id,
        recurrence: tx.recurrence,
        date: tx.date
      });

      // Optimistic update. The tx is already passed with the right label by
      // TransactionForm, so we just make sure source is set to 'manual' for
      // user-typed entries. The dedup logic uses this to distinguish manual
      // entries from executor-spawned and notification-inserted rows.
      setAppState(prev => ({
        ...prev,
        transactions: [{ ...tx, source: tx.source ?? 'manual' }, ...prev.transactions],
      }));

      try {
        const row = toSupabaseTransaction(tx);
        // Ensure auto-added transactions appear in the badge until cleared
        if (tx.label === 'Automatic') row.caught_cleared = false;
        log.debug('[insert] payload:', JSON.stringify(row));

        const res = await restFetch(`/transactions`, {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(row),
        });
        const body = await res.text();
        log.debug(
          '[insert] status:',
          res.status,
          'body:',
          body.slice(0, 300),
        );

        if (!res.ok) {
          const msg = `Insert failed (${res.status}): ${body.slice(0, 200)}`;
          log.error(msg);
          log.error('[insert] Failed transaction details:', {
            vendor: tx.vendor,
            recurrence: tx.recurrence,
            budget_id: tx.budget_id
          });
          setDbError(msg);
          setAppState(prev => ({
            ...prev,
            transactions: prev.transactions.filter(t => t.id !== tx.id),
          }));
          return;
        }

        const data = JSON.parse(body);
        const saved = fromSupabaseTransaction(
          Array.isArray(data) ? data[0] : data,
        );

        log.debug('[insert] OK, id:', saved.id);
        setAppState(prev => {
          const hasOptimistic = prev.transactions.some(t => t.id === tx.id);
          if (hasOptimistic) {
            return {
              ...prev,
              transactions: prev.transactions.map(t =>
                t.id === tx.id ? saved : t,
              ),
            };
          }
          // Optimistic entry was removed (e.g., by a concurrent data reload).
          // Add the saved transaction if it isn't already present.
          if (prev.transactions.some(t => t.id === saved.id)) return prev;
          return { ...prev, transactions: [saved, ...prev.transactions] };
        });
      } catch (err: any) {
        const msg = `Insert exception: ${err?.message || err}`;
        log.error(msg);
        setDbError(msg);
        setAppState(prev => ({
          ...prev,
          transactions: prev.transactions.filter(t => t.id !== tx.id),
        }));
      }
    },
    [
      categoriesLoaded,
      fromSupabaseTransaction,
      setAppState,
      setDbError,
      toSupabaseTransaction,
    ],
  );

  // Update transaction
  const handleUpdateTransaction = useCallback(
    async (updatedTx: Transaction) => {
      const sourceTransactionId = getSourceTransactionIdFromProjectedId(updatedTx.id);
      const isProjectedEdit = Boolean(sourceTransactionId);
      const originalTx = appState.transactions.find(t => t.id === (sourceTransactionId || updatedTx.id));

      if (isProjectedEdit && !originalTx) {
        const msg = `[updateTransaction] Could not find source transaction for projected id ${updatedTx.id}`;
        log.error(msg);
        setDbError(msg);
        return;
      }

      const txToPersist = buildPersistedUpdateTransaction(updatedTx, originalTx);

      // Check if this was an AI transaction being re-categorized or renamed
      const isAI = originalTx?.label === 'Automatic';
      const isAIRecategorize = isAI && txToPersist.budget_id !== originalTx?.budget_id;
      const isAIVendorRename = isAI && originalTx && cleanVendorInput(txToPersist.vendor) !== cleanVendorInput(originalTx.vendor);

      setAppState(prev => ({
        ...prev,
        transactions: prev.transactions.map(t =>
          t.id === txToPersist.id ? txToPersist : t,
        ),
      }));

      try {
        const row = toSupabaseTransaction(txToPersist);
        log.debug(
          '[update] id:',
          txToPersist.id,
          'payload:',
          JSON.stringify(row),
          isProjectedEdit ? `(from projected ${updatedTx.id})` : '',
        );

        const res = await restFetch(
          `/transactions?id=eq.${txToPersist.id}`,
          { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) },
        );
        const body = await res.text();
        log.debug(
          '[update] status:',
          res.status,
          'body:',
          body.slice(0, 300),
        );

        if (!res.ok) {
          const msg = `Update failed (${res.status}): ${body.slice(0, 200)}`;
          log.error(msg);
          setDbError(msg);
          // Revert optimistic update
          if (originalTx) {
            setAppState(prev => ({
              ...prev,
              transactions: prev.transactions.map(t =>
                t.id === txToPersist.id ? originalTx : t
              ),
            }));
          }
          return;
        } else {
          markReviewQueueStatus(txToPersist.id, 'reviewed');
          const mappedBudget = appState.budgets.find(b => b.id === txToPersist.budget_id)?.name || 'Other';
          const vendorDisplay = formatVendorName(txToPersist.vendor || 'Unknown');
          const vendorKey = vendorDisplay.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (vendorKey) {
            upsertVendorMapEntry({
              vendor_key: vendorKey,
              vendor_display: vendorDisplay,
              budget: mappedBudget,
              updated_at: new Date().toISOString(),
            });
          }

          // Verify that rows were actually updated
          let updatedRows: any[] = [];
          try {
            updatedRows = body ? JSON.parse(body) : [];
          } catch (parseErr) {
            const msg = `[updateTransaction] failed to parse response: ${body.slice(0, 200)}`;
            log.error(msg);
            setDbError(msg);
            return;
          }

          if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
            const msg = `[updateTransaction] no rows updated for transaction ${txToPersist.id}`;
            log.error(msg);
            setDbError(msg);
          }

          // If AI transaction was re-categorized or vendor renamed, update the overrides table
          // and localStorage so future notifications from the same vendor auto-categorize.
          // overrides schema: (id, user_id, proper_name text, match_key text, category_id Budgets-enum)
          //
          // The lookup key priority for future AI matches is:
          //   1. match_key  (normalized slug — matches across vendor name variants)
          //   2. proper_name (display name — only matches an exact-ish ilike)
          // We always set BOTH on write so the AI pipeline can match either way.
          if ((isAIRecategorize || isAIVendorRename) && appState.user?.id && originalTx) {
            const originalVendorName = cleanVendorInput(originalTx.vendor);
            const newVendorName = cleanVendorInput(txToPersist.vendor);
            const budgetName = appState.budgets.find(b => b.id === txToPersist.budget_id)?.name || mappedBudget;

            // match_key must describe what the BANK sends, not what the user
            // renamed it to. Keying on the new name meant a rule created by
            // renaming "TIM HORTONS #20024" to "Tim Hortons" stored
            // match_key="timhortons", while the next notification still arrives
            // as "TIM HORTONS #20024" and keys to "timhortons20024" — so the
            // rule looked right in the UI but never matched again.
            //
            // proper_name stays the display name the user chose; match_key is
            // the original parsed name, which is the thing that recurs.
            const vendorKey = toVendorKey(originalVendorName) || toVendorKey(newVendorName);
            const displayKey = newVendorName.toLowerCase().replace(/[^a-z0-9]/g, '');
            // Map BOTH the original parsed slug and the display slug locally,
            // so a future capture matches whichever form the bank sends.
            for (const key of new Set([vendorKey, displayKey].filter(Boolean))) {
              upsertVendorMapEntry({ vendor_key: key, vendor_display: newVendorName, budget: budgetName, updated_at: new Date().toISOString() });
            }

            // Persist to DB overrides table (upsert by match_key first, fall back to proper_name)
            try {
              await persistVendorOverride({
                userId: appState.user.id,
                properName: newVendorName,
                matchKey: vendorKey,
                categoryName: budgetName,
                ilikeFallbackName: originalVendorName,
              });
              log.debug('[update] override saved:', newVendorName, '→', budgetName, '(match_key:', vendorKey, ')');
            } catch (overrideErr: any) {
              log.warn('[update] override save failed:', overrideErr?.message || overrideErr);
            }
          }
        }
      } catch (err: any) {
        const msg = `Update exception: ${err?.message || err}`;
        log.error(msg);
        setDbError(msg);
      }
    },
    [appState.transactions, appState.user, appState.budgets, setAppState, setDbError, toSupabaseTransaction],
  );

  // Delete transaction.
  //
  // For a recurring charge this deletes the occurrence the user chose and
  // every later one, and ends the series at that point so the projections and
  // the executor don't bring it back — see lib/recurringDelete.ts. Returns the
  // plan it carried out (null if nothing was deleted) so the caller can offer
  // an Undo that restores all of it.
  const handleDeleteTransaction = useCallback(
    async (id: string): Promise<RecurringDeletePlan | null> => {
      const plan = planRecurringDelete(id, appState.transactions);

      if (!plan) {
        const msg = `Delete failed: no saved transaction behind ${id}`;
        log.error(msg);
        setDbError(msg);
        return null;
      }

      const removedIds = plan.remove.map(t => t.id);
      const endedIds = plan.endSeries.map(t => t.id);

      // Optimistic: drop the deleted occurrences and stop the ones that
      // already elapsed from recurring.
      setAppState(prev => ({
        ...prev,
        transactions: applyRecurringDeletePlan(prev.transactions, plan),
      }));

      const restore = () => {
        setAppState(prev => {
          const present = new Set(prev.transactions.map(t => t.id));
          const recurrenceById = new Map(plan.endSeries.map(t => [t.id, t.recurrence]));
          return {
            ...prev,
            transactions: [
              ...plan.remove.filter(t => !present.has(t.id)),
              ...prev.transactions.map(t =>
                recurrenceById.has(t.id)
                  ? { ...t, recurrence: recurrenceById.get(t.id) }
                  : t,
              ),
            ],
          };
        });
      };

      try {
        if (removedIds.length > 0) {
          const res = await restFetch(
            `/transactions?id=in.(${toIdList(removedIds)})`,
            { method: 'DELETE' },
          );

          if (!res.ok) {
            const body = await res.text();
            const msg = `Delete failed (${res.status}): ${body.slice(0, 200)}`;
            log.error(msg);
            setDbError(msg);
            restore();
            return null;
          }

          // Whichever of the deleted rows still had their capture
          // notification sitting in the tray — best-effort, and a no-op for
          // every row that never carried the marker, which is most of them.
          clearCaptureNotificationForRows(plan.remove);
        }

        // Everything before the cut keeps its money but stops recurring.
        // `recur` is the column the app writes (reads tolerate `recurrence`).
        if (endedIds.length > 0) {
          const res = await restFetch(
            `/transactions?id=in.(${toIdList(endedIds)})`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ recur: Recurrence.ONE_TIME }),
            },
          );

          if (!res.ok) {
            const body = await res.text();
            // The deletes already went through, so this is not restorable by
            // putting the rows back — report it and leave the UI as it is.
            // The series will reappear on the next load if this failed.
            const msg = `Ending recurrence failed (${res.status}): ${body.slice(0, 200)}`;
            log.error(msg);
            setDbError(msg);
            return plan;
          }
        }

        log.debug(
          '[delete] OK:',
          removedIds.join(',') || '(none)',
          plan.isSeries ? `series ended on ${endedIds.length} earlier row(s)` : '',
        );
        return plan;
      } catch (err: any) {
        const msg = `Delete exception: ${err?.message || err}`;
        log.error(msg);
        setDbError(msg);
        restore();
        return null;
      }
    },
    [appState.transactions, setAppState, setDbError],
  );




  // Clear approved transactions by removing the Auto-Added label
  const handleClearApprovedTransactions = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      try {
        const idList = ids.map(id => `"${id.replace(/"/g, '')}"`).join(',');
        const res = await restFetch(`/transactions?id=in.(${idList})`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({ type: 'Manual' }),
        });
        if (!res.ok) {
          const body = await res.text();
          const msg = `[clearApproved] PATCH failed (${res.status}): ${body.slice(0, 200)}`;
          log.error(msg);
          setDbError(msg);
          return;
        }
        // Update UI state: set label to 'Manual' so they no longer appear in "Approved Transactions"
        // but remain visible on the main transactions page
        const idSet = new Set(ids);
        setAppState(prev => ({
          ...prev,
          transactions: prev.transactions.map(t =>
            idSet.has(t.id) ? { ...t, label: 'Manual' as const } : t,
          ),
        }));
        log.debug('[clearApproved] OK, cleared labels for', ids.length, 'approved transactions');
      } catch (err: any) {
        const msg = `Clear approved exception: ${err?.message || err}`;
        log.error(msg);
        setDbError(msg);
      }
    },
    [setAppState, setDbError],
  );

  return {
    handleAddTransaction,
    handleUpdateTransaction,
    handleDeleteTransaction,
    handleClearApprovedTransactions,
  };
};
