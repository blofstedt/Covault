// lib/useNotificationListener.ts
import { log } from '../log';
import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import type { Transaction, User, BudgetCategory } from '../../types';
import { covaultNotification, cancelCaptureNotification } from '../covaultNotification';
import type { TransactionDetectedEvent } from '../covaultNotification';
import { drainQueuedNotifications } from '../pendingCaptureQueue';
import { processNotificationWithAI, buildInMemoryDedupKey } from '../notificationProcessor';
import { sendPartnerActivityNotification, sendExpenseCapturedNotification } from '../appNotifications';
import type { NotificationSettingsShape } from '../appNotifications';
import type { AIProcessingResult } from '../notificationProcessor';
import { getBankingApps, isExcludedApp, isBankingApp } from '../bankingApps';
import { getLocalToday } from '../dateUtils';

export interface UseNotificationListenerParams {
  user: User | null;
  budgets: BudgetCategory[];
  settings?: NotificationSettingsShape;
  onTransactionDetected: (tx: Transaction) => void;
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
  onAutoAcceptedTransaction,
  onAIProcessingResult,
}: UseNotificationListenerParams) => {
  // `settings` is read inside the native event handler but is deliberately not
  // an effect dependency: adding it would re-register the listener on every
  // toggle, and omitting it left the handler reading a stale value. A ref gives
  // the handler the current settings without touching the subscription.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

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

        const handleEvent = async (event: TransactionDetectedEvent) => {
            log.debug('[notification] Transaction detected:', event);
            if (!user?.id) {
              // Only reachable from a live native broadcast. That purchase is
              // also sitting in the native queue, so it is not lost — the drain
              // below picks it up once the session has been restored. Draining
              // is what must never run without a user, since it empties the
              // queue as it reads it.
              log.warn(
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

            // Hard exclusion (Google Wallet). The Java listener already drops
            // these before they are broadcast, so normally nothing arrives
            // here — but events also reach this pipeline from the offline
            // queue and from rescans, and a device can still be running an
            // older native build than the web bundle. Cheap backstop.
            //
            // Placed before the dedup bookkeeping so an excluded event does
            // not consume a slot in the recent-events window.
            if (isExcludedApp(bankAppId)) {
              log.debug('[notification] Ignoring excluded app:', bankAppId);
              return;
            }

            // Banks only. The native listener no longer forwards anything else,
            // but events also arrive from the offline queue and from rescans,
            // and a phone can be running an older APK than its web bundle —
            // which is exactly where a chat message quoting a dollar figure used
            // to get in. Dropped before the dedup bookkeeping so a non-bank
            // event does not consume a slot in the recent window.
            if (!isBankingApp(bankAppId)) {
              log.debug('[notification] Ignoring non-banking app:', bankAppId);
              return;
            }
            // Reuse the processor's key builder rather than re-implementing it,
            // so the two dedup layers cannot drift apart.
            const dedupKey = buildInMemoryDedupKey(bankAppId || '', rawNotification || '');
            const now = Date.now();
            // Evict expired entries opportunistically
            while (
              recentListenerEvents.length > 0 &&
              now - recentListenerEvents[0].at > LISTENER_DEDUP_WINDOW_MS
            ) {
              recentListenerEvents.shift();
            }
            if (recentListenerEvents.some((e) => e.key === dedupKey)) {
              log.debug(
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
                  // Read through the ref so toggling it takes effect on the
                  // next capture without re-registering the native listener.
                  autoAcceptKnownVendors:
                    settingsRef.current?.auto_accept_known_vendors === true,
                }, availableCategories);

                // Notify parsing UI about the result
                onAIProcessingResult?.(result);

                if (!result.processed || !result.isTransaction) {
                  log.debug(
                    `[notification] Skipped: ${result.skipReason || result.rejectionReason}`,
                  );
                  // ── Take back the capture notification ──
                  // The native listener posted "$X at Y — captured" the moment
                  // the bank alert arrived, before anything had decided whether
                  // it was a purchase at all. It has to: with the app closed it
                  // is the only part of Covault running. Now that the pipeline
                  // has said this is not an expense, the notification is a
                  // promise of a row that will never appear in Review — so it
                  // goes.
                  //
                  // Only for 'not_transaction'. A duplicate is a re-broadcast
                  // of a purchase that WAS captured, and its notification is
                  // the one still standing for that purchase; cancelling on a
                  // duplicate would silently erase the notice for a real
                  // capture.
                  if (result.skipReason === 'not_transaction') {
                    void cancelCaptureNotification(event.capture_notification_id);
                  }
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
                    log.warn(
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
                    settingsRef.current || {},
                    result.autoAccepted === true,
                    result.fuelHold ?? null,
                  );

                  // If this transaction came from a partner's device (different
                  // user_id on the event) send a push alert to the current user.
                  const eventUserId = (event as any).user_id || (event as any).userId;
                  if (eventUserId && eventUserId !== user.id && user.partnerName) {
                    sendPartnerActivityNotification(
                      user.partnerName,
                      result.vendor || 'Unknown',
                      result.amount || 0,
                      settingsRef.current || {},
                    );
                  }
                }

                return;
              } catch (err) {
                log.error(
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
        };

        const handle = await covaultNotification.addListener('transactionDetected', handleEvent);

        if (cancelled) {
          // The effect re-ran while we were awaiting; remove the just-added
          // listener immediately so we don't accumulate stale handles.
          handle.remove();
          return;
        }
        cleanup = () => handle.remove();

        // Drain anything the native service captured while the JS side was not
        // running. Without this, a notification that arrives with the app closed
        // is broadcast to nobody, and once the user swipes it away a rescan can
        // never recover it — which is why capture appeared to need a manual
        // refresh before dismissing notifications.
        //
        // Never before there is a user, though. Draining empties the native
        // queue as it reads it, and on a cold start — exactly what tapping the
        // capture notification does — this hook mounts a long way before
        // Supabase has restored the session. Every drained purchase was then
        // dropped for having nobody to file it under, with the bank's own alert
        // already dismissed and the queue already cleared. The effect re-runs
        // when the session lands, and drains then.
        if (user?.id) void drainQueuedNotifications(handleEvent);

        // Also drain when the app comes back to the foreground, so a purchase
        // made while it sat in the background shows up without a manual scan.
        const resumeHandle = await CapApp.addListener('resume', () => {
          if (!user?.id) return;
          void drainQueuedNotifications(handleEvent);
        });
        const removeListener = cleanup;
        cleanup = () => {
          removeListener?.();
          resumeHandle.remove();
        };
      } catch (e) {
        log.warn(
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
    // `user` is read for id/name/partnerName only, so those three are the real
    // dependencies. Depending on the whole object meant every token refresh
    // (which rebuilds it in useAuthState) tore down and re-added the native
    // listener across the JS<->native bridge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.name, user?.partnerName, budgets, onTransactionDetected, onAutoAcceptedTransaction, onAIProcessingResult]);
};