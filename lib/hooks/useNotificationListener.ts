// lib/useNotificationListener.ts
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Transaction, User, PendingTransaction, BudgetCategory } from '../../types';
import { covaultNotification } from '../covaultNotification';
import { processNotificationWithAI } from '../notificationProcessor';
import { sendPartnerActivityNotification, sendExpenseCapturedNotification } from '../appNotifications';
import type { NotificationSettingsShape } from '../appNotifications';
import type { AIProcessingResult } from '../notificationProcessor';
import { getBankingApps } from '../bankingApps';
import { getLocalToday } from '../dateUtils';

export interface UseNotificationListenerParams {
  user: User | null;
  budgets: BudgetCategory[];
  settings?: NotificationSettingsShape;
  onTransactionDetected: (tx: Transaction) => void;
  onPendingTransactionCreated?: (pending: PendingTransaction) => void;
  /** Called for auto-accepted transactions that are already saved in the DB. */
  onAutoAcceptedTransaction?: (tx: Transaction) => void;
  /** Called when AI processes a notification (for the parsing UI) */
  onAIProcessingResult?: (result: AIProcessingResult) => void;
}

/**
 * Front-line dedup at the listener level. The native side can fire the same
 * `transactionDetected` event multiple times for the same notification
 * (e.g. when both the native NotificationListener.onListenerConnected and
 * the JS useEffect trigger a scan at app start). If the raw text and
 * timestamp are identical and they arrive within this window, the second
 * one is dropped immediately — no DB round-trip, no AI inference, no
 * chance of a double-insert.
 *
 * This is a defense-in-depth layer on top of the in-memory + persistent
 * dedup inside processNotificationWithAI. The two layers are independent:
 *   - Listener-level dedup catches the event before it ever reaches the
 *     pipeline (cheapest possible stop).
 *   - Pipeline-level dedup catches anything that slips through (e.g. a
 *     re-broadcast on the next app start that's outside this window but
 *     inside the TTL/DB dedup window).
 */
const LISTENER_DEDUP_WINDOW_MS = 30_000;

type ListenerDedupEntry = { key: string; at: number };
const recentListenerEvents: ListenerDedupEntry[] = [];

/**
 * Hook that listens for transactionDetected events from the native CovaultNotification plugin.
 *
 * Uses the AI processing pipeline:
 *   dedup → AI extraction → duplicate check → category assignment → auto-insert
 */
export const useNotificationListener = ({
  user,
  budgets,
  settings,
  onTransactionDetected,
  onPendingTransactionCreated,
  onAutoAcceptedTransaction,
  onAIProcessingResult,
}: UseNotificationListenerParams) => {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cleanup: (() => void) | null = null;
    // If the effect re-runs (e.g. user/budgets reference changes) while
    // addListener is still resolving, the old listener is already in-flight
    // and must be removed as soon as the promise settles — otherwise we leak
    // a native handle per re-render and the user gets duplicate transactions.
    let cancelled = false;

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

            // ── Front-line dedup ──
            // Drop re-broadcasts of the same notification within a short
            // window. The native side sometimes fires the same event
            // twice in rapid succession (e.g. when both the native
            // onListenerConnected and the JS useEffect trigger a scan at
            // app start). Catching it here means the pipeline below never
            // even runs.
            //
            // The key is CONTENT-ONLY (no `event.timestamp`). The
            // timestamp-based key was unstable when the native side fell
            // back to `System.currentTimeMillis()` for missing fields,
            // letting two events for the same notification get different
            // keys and both slip through to the pipeline — the
            // double-capture bug. See `buildInMemoryDedupKey` in
            // notificationProcessor.ts for the full rationale.
            const rawNotification = event.rawNotification || event.raw_text;
            const bankAppId = (event.bankAppId || event.source_app)?.toLowerCase();
            let dedupHash = 5381;
            const text = rawNotification || '';
            for (let i = 0; i < text.length; i++) {
              dedupHash = ((dedupHash << 5) + dedupHash + text.charCodeAt(i)) >>> 0;
            }
            const dedupKey = `${bankAppId || '?'}|h${dedupHash.toString(36)}`;
            const now = Date.now();
            // Evict expired entries opportunistically
            while (
              recentListenerEvents.length > 0 &&
              now - recentListenerEvents[0].at > LISTENER_DEDUP_WINDOW_MS
            ) {
              recentListenerEvents.shift();
            }
            if (recentListenerEvents.some((e) => e.key === dedupKey)) {
              console.log(
                '[notification] Listener-level dedup hit, ignoring re-broadcast within',
                LISTENER_DEDUP_WINDOW_MS,
                'ms',
              );
              return;
            }
            recentListenerEvents.push({ key: dedupKey, at: now });

            // rawNotification + bankAppId are already declared above for
            // the dedup key; reuse them here.
            // Resolve a friendly bank name from the package ID so the UI
            // shows "BMO" instead of "com.bmo.mobile".
            const bankingApps = getBankingApps();
            const bankName = event.bankName
              || (bankAppId && bankingApps[bankAppId])
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
                  forceReprocess: event.from_scan === true || event.fromScan === true,
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
                    date: getLocalToday(),
                    budget_id: result.categoryId || null,
                    is_projected: false,
                    label: 'Automatic',
                    userName: user.name || 'User',
                    created_at: new Date().toISOString(),
                  };

                  // Soft-dup warning from the AI pipeline. The transaction
                  // was inserted anyway (the user prefers not to miss
                  // charges), but the parsing UI should know to surface a
                  // "possible duplicate" badge so the user can review.
                  if (result.softDuplicateOf) {
                    console.warn(
                      `[notification] ⚠️ Soft-dup: new ${tx.vendor} $${tx.amount} ` +
                      `looks similar to existing ${result.softDuplicateOf.vendor} $${result.softDuplicateOf.amount} ` +
                      `on ${result.softDuplicateOf.date}`,
                    );
                    (tx as any).softDuplicateOf = result.softDuplicateOf;
                  }
                  if (onAutoAcceptedTransaction) {
                    onAutoAcceptedTransaction(tx);
                  } else {
                    onTransactionDetected(tx);
                  }

                  // "Expense captured!" local notification. Gated on
                  // app_notifications_enabled inside the helper. Skipped
                  // automatically if the insert was a race-loser (the
                  // pipeline doesn't return transactionId in that case).
                  sendExpenseCapturedNotification(
                    result.transactionId,
                    result.vendor || 'Unknown',
                    result.amount || 0,
                    result.categoryName || null,
                    settings || {},
                  );

                  // If this transaction came from a partner's device (different
                  // user_id on the event) send a push alert to the current user.
                  const eventUserId = (event as any).user_id || (event as any).userId;
                  if (eventUserId && eventUserId !== user.id && user.partnerName) {
                    sendPartnerActivityNotification(
                      user.partnerName,
                      result.vendor || 'Unknown',
                      result.amount || 0,
                      settings || {},
                    );
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
              date: getLocalToday(),
              budget_id: null,
              is_projected: false,
              label: 'Automatic',
              userName: user.name || 'User',
              created_at: new Date().toISOString(),
            };

            onTransactionDetected(tx);
          },
        );

        if (cancelled) {
          // The effect re-ran while we were awaiting; remove the just-added
          // listener immediately so we don't accumulate stale handles.
          handle.remove();
          return;
        }
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
      cancelled = true;
      cleanup?.();
    };
  }, [user, budgets, onTransactionDetected, onPendingTransactionCreated, onAutoAcceptedTransaction, onAIProcessingResult]);
};
