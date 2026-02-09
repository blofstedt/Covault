// lib/useNotificationListener.ts
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Transaction, User, PendingTransaction } from '../types';
import { covaultNotification } from './covaultNotification';
import { processNotification } from './notificationProcessor';

export interface UseNotificationListenerParams {
  user: User | null;
  onTransactionDetected: (tx: Transaction) => void;
  onPendingTransactionCreated?: (pending: PendingTransaction) => void;
  /** Called for auto-accepted transactions that are already saved in the DB. */
  onAutoAcceptedTransaction?: (tx: Transaction) => void;
}

/**
 * Hook that listens for transactionDetected events from the native CovaultNotification plugin.
 *
 * Uses the manual-regex processing pipeline:
 *   dedup → rule lookup → regex apply → pending insert → auto-approve
 */
export const useNotificationListener = ({
  user,
  onTransactionDetected,
  onPendingTransactionCreated,
  onAutoAcceptedTransaction,
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
            const bankAppId = event.bankAppId || event.source_app;
            const bankName = event.bankName || event.source_app;

            // ── Processing pipeline ──
            if (rawNotification && bankAppId && bankName) {
              try {
                const result = await processNotification(user.id, {
                  rawNotification,
                  bankAppId,
                  bankName,
                  fallbackVendor: event.vendor,
                  fallbackAmount: event.amount,
                });

                if (!result.processed) {
                  console.log(
                    `[notification] Skipped: ${result.skipReason}`,
                  );
                  return;
                }

                // Notify about pending transaction for UI update
                if (result.pendingTransaction) {
                  onPendingTransactionCreated?.(result.pendingTransaction);
                }

                // If auto-accepted, notify via the UI-only callback
                if (result.autoAccepted && result.transactionId && result.pendingTransaction) {
                  const tx: Transaction = {
                    id: result.transactionId,
                    user_id: user.id,
                    vendor: result.pendingTransaction.extracted_vendor,
                    amount: result.pendingTransaction.extracted_amount,
                    date: new Date().toISOString().slice(0, 10),
                    budget_id: result.categoryId || null,
                    is_projected: false,
                    label: 'Auto-Added',
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
                  '[notification] Pipeline error, falling back to legacy:',
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
              label: 'Auto-Added',
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
  }, [user, onTransactionDetected, onPendingTransactionCreated, onAutoAcceptedTransaction]);
};
