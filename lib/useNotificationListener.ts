// lib/useNotificationListener.ts
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Transaction, User, PendingTransaction, BudgetCategory } from '../types';
import { covaultNotification } from './covaultNotification';
import { processNotificationWithAI } from './notificationProcessor';
import type { AIProcessingResult } from './notificationProcessor';
import { KNOWN_BANKING_APPS } from './bankingApps';

export interface UseNotificationListenerParams {
  user: User | null;
  budgets: BudgetCategory[];
  onTransactionDetected: (tx: Transaction) => void;
  onPendingTransactionCreated?: (pending: PendingTransaction) => void;
  /** Called for auto-accepted transactions that are already saved in the DB. */
  onAutoAcceptedTransaction?: (tx: Transaction) => void;
  /** Called when AI processes a notification (for the parsing UI) */
  onAIProcessingResult?: (result: AIProcessingResult) => void;
}

/**
 * Hook that listens for transactionDetected events from the native CovaultNotification plugin.
 *
 * Uses the AI processing pipeline:
 *   dedup → AI extraction → duplicate check → category assignment → auto-insert
 */
export const useNotificationListener = ({
  user,
  budgets,
  onTransactionDetected,
  onPendingTransactionCreated,
  onAutoAcceptedTransaction,
  onAIProcessingResult,
}: UseNotificationListenerParams) => {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | null = null;

    const setupListener = async () => {
      try {
        if (!covaultNotification) {
          return;
        }

        const handle = await covaultNotification.addListener(
          'transactionDetected',
          async (event) => {
            console.log('[notification] Transaction detected:', event);
            if (!user?.id) {
              console.warn(
                '[notification] No user logged in, ignoring transaction',
              );
              return;
            }

            // Normalize field names from native broadcast
            const rawNotification = event.rawNotification || event.raw_text;
            const bankAppId = (event.bankAppId || event.source_app)?.toLowerCase();
            // Resolve a friendly bank name from the package ID so the UI
            // shows "BMO" instead of "com.bmo.mobile".
            const bankName = event.bankName
              || (bankAppId && KNOWN_BANKING_APPS[bankAppId])
              || event.source_app
              || bankAppId
              || 'Unknown Bank';

            // ── AI Processing pipeline ──
            if (rawNotification && bankAppId && bankName) {
              try {
                const availableCategories = budgets.map(b => ({ id: b.id, name: b.name }));
                const result = await processNotificationWithAI(user.id, {
                  rawNotification,
                  bankAppId,
                  bankName,
                  notificationTimestamp: event.timestamp,
                  fallbackVendor: event.vendor,
                  fallbackAmount: event.amount,
                }, availableCategories);

                // Notify parsing UI about the result
                onAIProcessingResult?.(result);

                if (!result.processed || !result.isTransaction) {
                  console.log(
                    `[notification] Skipped: ${result.skipReason || result.rejectionReason}`,
                  );
                  return;
                }

                // If transaction was inserted, notify the UI
                if (result.transactionId) {
                  const tx: Transaction = {
                    id: result.transactionId,
                    user_id: user.id,
                    vendor: result.vendor || 'Unknown',
                    amount: result.amount || 0,
                    date: new Date().toISOString().slice(0, 10),
                    budget_id: result.categoryId || null,
                    is_projected: false,
                    label: 'AI',
                    userName: user.name || 'User',
                    created_at: new Date().toISOString(),
                  };
                  if (onAutoAcceptedTransaction) {
                    onAutoAcceptedTransaction(tx);
                  } else {
                    onTransactionDetected(tx);
                  }
                }

                return;
              } catch (err) {
                console.error(
                  '[notification] AI pipeline error, falling back to legacy:',
                  err,
                );
              }
            }

            // ── Legacy fallback (no raw notification data, or pipeline error) ──
            const vendor = event.vendor || 'Unknown Merchant';
            const amount = event.amount || 0;

            const tx: Transaction = {
              id: crypto.randomUUID(),
              user_id: user.id,
              vendor,
              amount,
              date: new Date().toISOString().slice(0, 10),
              budget_id: null,
              is_projected: false,
              label: 'AI',
              userName: user.name || 'User',
              created_at: new Date().toISOString(),
            };

            onTransactionDetected(tx);
          },
        );

        cleanup = () => handle.remove();
      } catch (e) {
        console.warn(
          '[notification] Could not set up transaction listener:',
          e,
        );
      }
    };

    setupListener();

    return () => {
      cleanup?.();
    };
  }, [user, budgets, onTransactionDetected, onPendingTransactionCreated, onAutoAcceptedTransaction, onAIProcessingResult]);
};
