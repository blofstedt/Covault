// lib/useNotificationListener.ts
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Transaction, User, PendingTransaction } from '../types';
import { covaultNotification } from './covaultNotification';
import { processNotification, flagAndRegenerateRule } from './notificationProcessor';

// Re-export for backward compatibility (used by FlagTransactionButton)
export const flagNotificationAndRegenerateRule = flagAndRegenerateRule;

export interface UseNotificationListenerParams {
  user: User | null;
  onTransactionDetected: (tx: Transaction) => void;
  onPendingTransactionCreated?: (pending: PendingTransaction) => void;
  /** Called when a notification is rejected (duplicate, failed AI parsing) */
  onRejectedTransactionCreated?: (pending: PendingTransaction) => void;
  /** Called for auto-accepted transactions that are already saved in the DB.
   *  Unlike onTransactionDetected, this only updates local UI state without
   *  attempting a duplicate DB insert. */
  onAutoAcceptedTransaction?: (tx: Transaction) => void;
}

/**
 * Hook that listens for transactionDetected events from the native CovaultNotification plugin.
 *
 * When rawNotification + bankAppId + bankName are present, uses the full
 * processing pipeline (dedup → regex → validate → pending → auto-accept).
 * Otherwise falls back to event.vendor / event.amount (legacy).
 */
export const useNotificationListener = ({
  user,
  onTransactionDetected,
  onPendingTransactionCreated,
  onRejectedTransactionCreated,
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
            // Java sends raw_text/source_app; TS expects rawNotification/bankAppId/bankName
            const rawNotification = event.rawNotification || event.raw_text;
            const bankAppId = event.bankAppId || event.source_app;
            const bankName = event.bankName || event.source_app;

            // ── Full processing pipeline (new path) ──
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

                // Notify about the result
                if (result.pendingTransaction) {
                  if (result.autoAccepted) {
                    // Auto-accepted: notify via the UI-only callback
                    // (transaction is already saved in the DB by processNotification)
                    if (result.transactionId) {
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
                  } else {
                    // Rejected (duplicate or failed): add to rejected list
                    onRejectedTransactionCreated?.(result.pendingTransaction);
                  }
                }

                return;
              } catch (err) {
                console.error(
                  '[notification] Pipeline error, falling back to legacy:',
                  err,
                );
                // Fall through to legacy path below
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
  }, [user, onTransactionDetected, onPendingTransactionCreated, onRejectedTransactionCreated, onAutoAcceptedTransaction]);
};
