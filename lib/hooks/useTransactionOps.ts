// lib/hooks/useTransactionOps.ts
import { useCallback } from 'react';
import type { Transaction } from '../../types';
import { REST_BASE, getAuthHeaders } from '../apiHelpers';
import { formatVendorName } from '../formatVendorName';
import { checkDuplicateTransaction } from '../notificationProcessor';
import { useToSupabaseTransaction, useFromSupabaseTransaction } from './transactionMappers';
import type { UseUserDataParams } from './types';

export const useTransactionOps = ({
  appState,
  setAppState,
  setDbError,
  categoriesLoaded,
}: UseUserDataParams & { categoriesLoaded: boolean }) => {
  const toSupabaseTransaction = useToSupabaseTransaction();
  const fromSupabaseTransaction = useFromSupabaseTransaction();

  // Save split records to transaction_budget_splits table
  const saveSplits = useCallback(
    async (transactionId: string, splits: { budget_id: string; amount: number }[]) => {
      try {
        const headers = await getAuthHeaders();

        // Delete any existing splits for this transaction
        await fetch(
          `${REST_BASE}/transaction_budget_splits?transaction_id=eq.${transactionId}`,
          { method: 'DELETE', headers },
        );

        // Find budget names from appState; the DB column is budget_category (text name)
        const totalAmount = splits.reduce((sum, sp) => sum + sp.amount, 0);
        const rows = splits.map(s => {
          const budget = appState.budgets.find(b => b.id === s.budget_id);
          return {
            transaction_id: transactionId,
            budget_category: budget?.name || s.budget_id,
            amount: s.amount,
            percentage: totalAmount > 0 ? parseFloat(((s.amount / totalAmount) * 100).toFixed(2)) : 0,
          };
        });

        (headers as any)['Prefer'] = 'return=representation';
        const res = await fetch(`${REST_BASE}/transaction_budget_splits`, {
          method: 'POST',
          headers,
          body: JSON.stringify(rows),
        });

        if (!res.ok) {
          const body = await res.text();
          console.error('[saveSplits] failed:', body.slice(0, 200));
        } else {
          console.log('[saveSplits] OK, saved', rows.length, 'splits for transaction', transactionId);
        }
      } catch (err: any) {
        console.error('[saveSplits] exception:', err?.message || err);
      }
    },
    [appState.budgets],
  );

  // Add transaction
  const handleAddTransaction = useCallback(
    async (tx: Transaction) => {
      if (!categoriesLoaded) {
        setDbError('Cannot add transaction: categories not yet loaded');
        return;
      }

      // Log transaction details for debugging
      console.log('[insert] Creating transaction:', {
        vendor: tx.vendor,
        amount: tx.amount,
        budget_id: tx.budget_id,
        recurrence: tx.recurrence,
        date: tx.date
      });

      // Optimistic update
      setAppState(prev => ({
        ...prev,
        transactions: [tx, ...prev.transactions],
      }));

      try {
        const row = toSupabaseTransaction(tx);
        console.log('[insert] payload:', JSON.stringify(row));

        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';

        const res = await fetch(`${REST_BASE}/transactions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(row),
        });
        const body = await res.text();
        console.log(
          '[insert] status:',
          res.status,
          'body:',
          body.slice(0, 300),
        );

        if (!res.ok) {
          const msg = `Insert failed (${res.status}): ${body.slice(0, 200)}`;
          console.error(msg);
          console.error('[insert] Failed transaction details:', {
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

        // Persist splits if present
        if (tx.splits && tx.splits.length > 1) {
          await saveSplits(saved.id, tx.splits);
          saved.splits = tx.splits;
        }

        console.log('[insert] OK, id:', saved.id);
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
        console.error(msg);
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
      saveSplits,
      setAppState,
      setDbError,
      toSupabaseTransaction,
    ],
  );

  // Update transaction
  const handleUpdateTransaction = useCallback(
    async (updatedTx: Transaction) => {
      setAppState(prev => ({
        ...prev,
        transactions: prev.transactions.map(t =>
          t.id === updatedTx.id ? updatedTx : t,
        ),
      }));

      try {
        const row = toSupabaseTransaction(updatedTx);
        console.log(
          '[update] id:',
          updatedTx.id,
          'payload:',
          JSON.stringify(row),
        );

        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';
        const res = await fetch(
          `${REST_BASE}/transactions?id=eq.${updatedTx.id}`,
          { method: 'PATCH', headers, body: JSON.stringify(row) },
        );
        const body = await res.text();
        console.log(
          '[update] status:',
          res.status,
          'body:',
          body.slice(0, 300),
        );

        if (!res.ok) {
          const msg = `Update failed (${res.status}): ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
        } else {
          // Verify that rows were actually updated
          let updatedRows: any[] = [];
          try {
            updatedRows = body ? JSON.parse(body) : [];
          } catch (parseErr) {
            const msg = `[updateTransaction] failed to parse response: ${body.slice(0, 200)}`;
            console.error(msg);
            setDbError(msg);
            return;
          }
          
          if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
            const msg = `[updateTransaction] no rows updated for transaction ${updatedTx.id}`;
            console.error(msg);
            setDbError(msg);
          }

          // Persist splits (replace existing ones)
          if (updatedTx.splits && updatedTx.splits.length > 1) {
            await saveSplits(updatedTx.id, updatedTx.splits);
          } else {
            // If no splits, delete any existing ones
            const deleteHeaders = await getAuthHeaders();
            await fetch(
              `${REST_BASE}/transaction_budget_splits?transaction_id=eq.${updatedTx.id}`,
              { method: 'DELETE', headers: deleteHeaders },
            );
          }
        }
      } catch (err: any) {
        const msg = `Update exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
      }
    },
    [saveSplits, setAppState, setDbError, toSupabaseTransaction],
  );

  // Delete transaction
  const handleDeleteTransaction = useCallback(
    async (id: string) => {
      const deletedTx = appState.transactions.find(t => t.id === id);

      setAppState(prev => ({
        ...prev,
        transactions: prev.transactions.filter(t => t.id !== id),
      }));

      try {
        const headers = await getAuthHeaders();
        const res = await fetch(
          `${REST_BASE}/transactions?id=eq.${id}`,
          { method: 'DELETE', headers },
        );

        if (!res.ok) {
          const body = await res.text();
          const msg = `Delete failed (${res.status}): ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          if (deletedTx) {
            setAppState(prev => ({
              ...prev,
              transactions: [deletedTx, ...prev.transactions],
            }));
          }
        } else {
          console.log('[delete] OK:', id);
        }
      } catch (err: any) {
        const msg = `Delete exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
        if (deletedTx) {
          setAppState(prev => ({
            ...prev,
            transactions: [deletedTx, ...prev.transactions],
          }));
        }
      }
    },
    [appState.transactions, setAppState, setDbError],
  );

  // Approve a pending transaction (convert to actual transaction)
  const handleApprovePendingTransaction = useCallback(
    async (pendingId: string, categoryId: string, preferredName?: string) => {
      try {
        const userId = appState.user?.id;
        if (!userId) return;

        const pending = appState.pendingTransactions?.find(p => p.id === pendingId);
        if (!pending) {
          setDbError('Pending transaction not found');
          return;
        }

        // 0) Check for duplicate against existing transactions
        const dupResult = await checkDuplicateTransaction(userId, pending);

        if (dupResult.isDuplicate) {
          // Mark as rejected with reason
          const rejectHeaders = await getAuthHeaders();
          (rejectHeaders as any)['Prefer'] = 'return=representation';
          await fetch(`${REST_BASE}/pending_transactions?id=eq.${pendingId}`, {
            method: 'PATCH',
            headers: rejectHeaders,
            body: JSON.stringify({
              needs_review: false,
              reviewed_at: new Date().toISOString(),
              approved: false,
              rejection_reason: dupResult.reason,
            }),
          });

          // Update UI state: move from pending to show as rejected
          setAppState(prev => ({
            ...prev,
            pendingTransactions: (prev.pendingTransactions || []).map(p =>
              p.id === pendingId
                ? { ...p, needs_review: false, approved: false, rejection_reason: dupResult.reason, reviewed_at: new Date().toISOString() }
                : p,
            ),
          }));

          console.log(`[approvePending] Duplicate detected: ${dupResult.reason}`);
          return;
        }

        if (dupResult.updatedExistingId) {
          // Recurring transaction date was updated — mark pending as approved without new insert
          const patchHeaders = await getAuthHeaders();
          (patchHeaders as any)['Prefer'] = 'return=representation';
          await fetch(`${REST_BASE}/pending_transactions?id=eq.${pendingId}`, {
            method: 'PATCH',
            headers: patchHeaders,
            body: JSON.stringify({
              needs_review: false,
              reviewed_at: new Date().toISOString(),
              approved: true,
            }),
          });

          // Update the recurring transaction date in local state
          const now = new Date();
          const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
          setAppState(prev => ({
            ...prev,
            transactions: prev.transactions.map(t =>
              t.id === dupResult.updatedExistingId ? { ...t, date: todayStr } : t,
            ),
            pendingTransactions: prev.pendingTransactions?.filter(p => p.id !== pendingId) || [],
          }));

          console.log(`[approvePending] Updated recurring transaction ${dupResult.updatedExistingId} date`);
          return;
        }

        // 1) Insert the actual transaction directly into Supabase
        const dateStr = new Date(pending.extracted_timestamp || pending.posted_at || new Date()).toISOString().split('T')[0];
        const transactionRow = {
          user_id: userId,
          vendor: formatVendorName(pending.extracted_vendor),
          amount: Number(pending.extracted_amount),
          date: dateStr,
          category_id: categoryId,
          recurrence: 'One-time',
          label: 'Auto-Added',
          is_projected: false,
        };

        const insertHeaders = await getAuthHeaders();
        (insertHeaders as any)['Prefer'] = 'return=representation';
        const insertRes = await fetch(`${REST_BASE}/transactions`, {
          method: 'POST',
          headers: insertHeaders,
          body: JSON.stringify(transactionRow),
        });
        const insertBody = await insertRes.text();

        if (!insertRes.ok) {
          const msg = `[approvePending] INSERT transaction failed (${insertRes.status}): ${insertBody.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          return;
        }

        let savedRow: any;
        try {
          const parsed = JSON.parse(insertBody);
          savedRow = Array.isArray(parsed) ? parsed[0] : parsed;
        } catch {
          const msg = `[approvePending] failed to parse INSERT response: ${insertBody.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          return;
        }

        const savedTransaction = { ...fromSupabaseTransaction(savedRow), label: 'Auto-Added' as const };
        console.log('[approvePending] transaction inserted, id:', savedTransaction.id);

        // 2) Mark pending transaction as reviewed and approved
        const patchHeaders = await getAuthHeaders();
        (patchHeaders as any)['Prefer'] = 'return=representation';
        const patchRes = await fetch(`${REST_BASE}/pending_transactions?id=eq.${pendingId}`, {
          method: 'PATCH',
          headers: patchHeaders,
          body: JSON.stringify({
            needs_review: false,
            reviewed_at: new Date().toISOString(),
            approved: true,
          }),
        });

        if (!patchRes.ok) {
          const body = await patchRes.text();
          console.error(`[approvePending] PATCH pending failed (${patchRes.status}): ${body.slice(0, 200)}`);
          // Transaction was created, so continue even if PATCH fails
        }

        // 3) Save vendor_override so future transactions from this vendor auto-categorize
        try {
          const overrideHeaders = await getAuthHeaders();
          (overrideHeaders as any)['Prefer'] = 'return=representation';
          const trimmedPreferredName = preferredName?.trim() || null;
          const overridePatchBody: Record<string, any> = { category_id: categoryId };
          if (trimmedPreferredName) {
            overridePatchBody.proper_name = trimmedPreferredName;
          }
          // Try to update existing override (preserves auto_accept)
          const patchOverrideRes = await fetch(
            `${REST_BASE}/vendor_overrides?user_id=eq.${userId}&vendor_name=eq.${encodeURIComponent(formatVendorName(pending.extracted_vendor))}`,
            {
              method: 'PATCH',
              headers: overrideHeaders,
              body: JSON.stringify(overridePatchBody),
            },
          );
          const patchOverrideBody = await patchOverrideRes.text();
          let patchedRows: any[] = [];
          try {
            patchedRows = patchOverrideBody ? JSON.parse(patchOverrideBody) : [];
          } catch (parseErr) {
            console.warn('[approvePending] vendor_override PATCH response parse error:', parseErr);
            patchedRows = [];
          }
          if (!patchOverrideRes.ok || !Array.isArray(patchedRows) || patchedRows.length === 0) {
            // No existing override found, insert a new one
            const overrideInsertBody: Record<string, any> = {
              user_id: userId,
              vendor_name: formatVendorName(pending.extracted_vendor),
              category_id: categoryId,
            };
            if (trimmedPreferredName) {
              overrideInsertBody.proper_name = trimmedPreferredName;
            }
            const postRes = await fetch(`${REST_BASE}/vendor_overrides`, {
              method: 'POST',
              headers: overrideHeaders,
              body: JSON.stringify(overrideInsertBody),
            });
            if (!postRes.ok) {
              const postBody = await postRes.text();
              console.warn('[approvePending] vendor_override POST failed:', postRes.status, postBody.slice(0, 200));
            } else {
              console.log('[approvePending] vendor_override saved for', pending.extracted_vendor);
            }
          } else {
            console.log('[approvePending] vendor_override updated for', pending.extracted_vendor);
          }
        } catch (overrideErr: any) {
          // Non-critical: log but don't fail the approval
          console.warn('[approvePending] vendor_override save failed:', overrideErr?.message || overrideErr);
        }

        // 4) Update UI state: add transaction + remove from pending list
        setAppState(prev => ({
          ...prev,
          transactions: [savedTransaction, ...prev.transactions],
          pendingTransactions: prev.pendingTransactions?.filter(p => p.id !== pendingId) || [],
        }));

        console.log('[approvePending] OK, approved pending transaction', pendingId);
      } catch (err: any) {
        const msg = `Approve pending exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
      }
    },
    [appState.user, appState.pendingTransactions, fromSupabaseTransaction, setAppState, setDbError],
  );

  // Reject a pending transaction
  const handleRejectPendingTransaction = useCallback(
    async (pendingId: string) => {
      try {
        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';

        // Mark as reviewed and not approved
        const res = await fetch(`${REST_BASE}/pending_transactions?id=eq.${pendingId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            needs_review: false,
            reviewed_at: new Date().toISOString(),
            approved: false,
            rejection_reason: 'Manually rejected',
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          const msg = `[rejectPending] PATCH failed (${res.status}): ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          return;
        }

        const body = await res.text();
        let updatedRows: any[] = [];
        try {
          updatedRows = body ? JSON.parse(body) : [];
        } catch (parseErr) {
          const msg = `[rejectPending] failed to parse response: ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          return;
        }
        
        if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
          const msg = `[rejectPending] no rows updated for pending transaction ${pendingId}`;
          console.error(msg);
          setDbError(msg);
          return;
        }

        // Update pending transaction in UI state to show as rejected
        setAppState(prev => ({
          ...prev,
          pendingTransactions: (prev.pendingTransactions || []).map(p =>
            p.id === pendingId
              ? { ...p, needs_review: false, approved: false, rejection_reason: 'Manually rejected', reviewed_at: new Date().toISOString() }
              : p,
          ),
        }));

        console.log('[rejectPending] OK, rejected pending transaction', pendingId);
      } catch (err: any) {
        const msg = `Reject pending exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
      }
    },
    [setAppState, setDbError],
  );

  return {
    handleAddTransaction,
    handleUpdateTransaction,
    handleDeleteTransaction,
    handleApprovePendingTransaction,
    handleRejectPendingTransaction,
  };
};
