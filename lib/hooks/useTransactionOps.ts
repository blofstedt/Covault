// lib/hooks/useTransactionOps.ts
import { useCallback } from 'react';
import type { Transaction } from '../../types';
import { REST_BASE, getAuthHeaders } from '../apiHelpers';
import { formatVendorName } from '../formatVendorName';
import { checkDuplicateTransaction } from '../notificationProcessor';
import { markReviewQueueStatus, upsertVendorMapEntry } from '../localNotificationMemory';
import { useToSupabaseTransaction, useFromSupabaseTransaction } from './transactionMappers';
import type { UseUserDataParams } from './types';


const PROJECTED_TRANSACTION_ID_REGEX = /^projected-(.+)-(\d{4}-\d{2}-\d{2})$/;

export const getSourceTransactionIdFromProjectedId = (transactionId: string): string | null => {
  const match = PROJECTED_TRANSACTION_ID_REGEX.exec(String(transactionId || ''));
  return match ? match[1] : null;
};

export const buildPersistedUpdateTransaction = (
  updatedTx: Transaction,
  sourceTx?: Transaction,
): Transaction => {
  if (!sourceTx) return updatedTx;
  return {
    ...sourceTx,
    vendor: updatedTx.vendor,
    amount: updatedTx.amount,
    budget_id: updatedTx.budget_id,
    recurrence: updatedTx.recurrence,
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
        console.error(msg);
        setDbError(msg);
        return;
      }

      const txToPersist = buildPersistedUpdateTransaction(updatedTx, originalTx);

      // Check if this was an AI transaction being re-categorized or renamed
      const isAI = originalTx?.label === 'AI';
      const isAIRecategorize = isAI && txToPersist.budget_id !== originalTx?.budget_id;
      const isAIVendorRename = isAI && originalTx && formatVendorName(txToPersist.vendor) !== formatVendorName(originalTx.vendor);

      setAppState(prev => ({
        ...prev,
        transactions: prev.transactions.map(t =>
          t.id === txToPersist.id ? txToPersist : t,
        ),
      }));

      try {
        const row = toSupabaseTransaction(txToPersist);
        console.log(
          '[update] id:',
          txToPersist.id,
          'payload:',
          JSON.stringify(row),
          isProjectedEdit ? `(from projected ${updatedTx.id})` : '',
        );

        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';
        const res = await fetch(
          `${REST_BASE}/transactions?id=eq.${txToPersist.id}`,
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
            console.error(msg);
            setDbError(msg);
            return;
          }

          if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
            const msg = `[updateTransaction] no rows updated for transaction ${txToPersist.id}`;
            console.error(msg);
            setDbError(msg);
          }

          // If AI transaction was re-categorized or vendor renamed, update vendor_overrides
          if ((isAIRecategorize || isAIVendorRename) && appState.user?.id && originalTx) {
            try {
              const overrideHeaders = await getAuthHeaders();
              (overrideHeaders as any)['Prefer'] = 'return=representation';
              // Use the original vendor name as the key for lookup
              const originalVendorName = formatVendorName(originalTx.vendor);
              const newVendorName = formatVendorName(txToPersist.vendor);

              // Build the update payload
              const overridePayload: Record<string, string> = {};
              if (isAIRecategorize && txToPersist.budget_id) {
                overridePayload.category_id = txToPersist.budget_id;
              }
              if (isAIVendorRename) {
                overridePayload.proper_name = newVendorName;
              }

              // Try to update existing override (match on original vendor name)
              const patchRes = await fetch(
                `${REST_BASE}/vendor_overrides?user_id=eq.${appState.user.id}&vendor_name=eq.${encodeURIComponent(originalVendorName)}`,
                {
                  method: 'PATCH',
                  headers: overrideHeaders,
                  body: JSON.stringify(overridePayload),
                },
              );
              const patchBody = await patchRes.text();
              let patchedRows: any[] = [];
              try { patchedRows = patchBody ? JSON.parse(patchBody) : []; } catch (e) { console.warn('[update] vendor_override PATCH parse error:', e); patchedRows = []; }

              if (!patchRes.ok || !Array.isArray(patchedRows) || patchedRows.length === 0) {
                // Insert new override
                await fetch(`${REST_BASE}/vendor_overrides`, {
                  method: 'POST',
                  headers: overrideHeaders,
                  body: JSON.stringify({
                    user_id: appState.user.id,
                    vendor_name: originalVendorName,
                    category_id: txToPersist.budget_id || originalTx.budget_id,
                    ...(isAIVendorRename ? { proper_name: newVendorName } : {}),
                  }),
                });
              }
              console.log('[update] vendor_override saved for AI transaction:', originalVendorName,
                isAIVendorRename ? `→ proper_name: ${newVendorName}` : '',
                isAIRecategorize ? `→ category_id: ${txToPersist.budget_id}` : '');
            } catch (overrideErr: any) {
              console.warn('[update] vendor_override save failed:', overrideErr?.message || overrideErr);
            }
          }
        }
      } catch (err: any) {
        const msg = `Update exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
      }
    },
    [appState.transactions, appState.user, appState.budgets, setAppState, setDbError, toSupabaseTransaction],
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
              status: 'rejected',
              reviewed_at: new Date().toISOString(),
              rejection_reason: dupResult.reason,
            }),
          });

          // Remove rejected transaction from UI state
          setAppState(prev => ({
            ...prev,
            pendingTransactions: (prev.pendingTransactions || []).filter(p => p.id !== pendingId),
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
              status: 'approved',
              reviewed_at: new Date().toISOString(),
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
        // Use local date to avoid UTC conversion shifting the date forward by a day
        const txDate = new Date(pending.extracted_timestamp || pending.posted_at || new Date());
        const dateStr = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}-${String(txDate.getDate()).padStart(2, '0')}`;
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
            status: 'approved',
            reviewed_at: new Date().toISOString(),
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
          // Try to update existing override
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
            status: 'rejected',
            reviewed_at: new Date().toISOString(),
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

        // Remove rejected transaction from UI state immediately
        setAppState(prev => ({
          ...prev,
          pendingTransactions: (prev.pendingTransactions || []).filter(p => p.id !== pendingId),
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

  // Clear filtered (keyword-ignored) pending transactions by deleting from DB
  const handleClearFilteredNotifications = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      try {
        const headers = await getAuthHeaders();
        const idList = ids.map(id => `"${id}"`).join(',');
        const res = await fetch(`${REST_BASE}/pending_transactions?id=in.(${idList})`, {
          method: 'DELETE',
          headers,
        });
        if (!res.ok) {
          const body = await res.text();
          const msg = `[clearFiltered] DELETE failed (${res.status}): ${body.slice(0, 200)}`;
          console.error(msg);
          setDbError(msg);
          return;
        }
        // Remove from UI state
        const idSet = new Set(ids);
        setAppState(prev => ({
          ...prev,
          pendingTransactions: (prev.pendingTransactions || []).filter(p => !idSet.has(p.id)),
        }));
        console.log('[clearFiltered] OK, cleared', ids.length, 'filtered notifications');
      } catch (err: any) {
        const msg = `Clear filtered exception: ${err?.message || err}`;
        console.error(msg);
        setDbError(msg);
      }
    },
    [setAppState, setDbError],
  );

  // Clear approved transactions by removing the Auto-Added label
  const handleClearApprovedTransactions = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      try {
        const headers = await getAuthHeaders();
        (headers as any)['Prefer'] = 'return=representation';
        const idList = ids.map(id => `"${id}"`).join(',');
        const res = await fetch(`${REST_BASE}/transactions?id=in.(${idList})`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ label: 'Manual' }),
        });
        if (!res.ok) {
          const body = await res.text();
          const msg = `[clearApproved] PATCH failed (${res.status}): ${body.slice(0, 200)}`;
          console.error(msg);
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
        console.log('[clearApproved] OK, cleared labels for', ids.length, 'approved transactions');
      } catch (err: any) {
        const msg = `Clear approved exception: ${err?.message || err}`;
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
    handleClearFilteredNotifications,
    handleClearApprovedTransactions,
  };
};
