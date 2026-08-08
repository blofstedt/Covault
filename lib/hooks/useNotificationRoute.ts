// lib/hooks/useNotificationRoute.ts
import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { consumePendingRoute, parseNotificationRoute } from '../covaultNotification';
import { addNotificationTapListener } from '../appNotifications';

/**
 * Open the Review page when the user taps a capture notification.
 *
 * A capture notification says "tap to review", so it has to land there rather
 * than on whatever screen the app happened to be showing. There are two ways
 * the tap reaches us, and both are needed:
 *
 *   - **Cold / background start.** The native listener posts these, and it
 *     outlives the WebView, so on tap there may be no JS running to hear an
 *     event. MainActivity parks the destination in SharedPreferences and we
 *     collect it here on mount and on resume. The native side clears it as it
 *     hands it over, so a route fires exactly once — an ordinary launch later
 *     won't bounce the user to Review.
 *   - **App already open.** Notifications scheduled from JS carry the
 *     destination in their `extra`, delivered through
 *     localNotificationActionPerformed.
 *
 * `onReview` is held in a ref so a caller passing an inline arrow doesn't
 * re-register the native listeners on every render.
 */
export function useNotificationRoute(
  onReview: () => void,
  onBudget?: (budget: string) => void,
): void {
  const onReviewRef = useRef(onReview);
  useEffect(() => {
    onReviewRef.current = onReview;
  }, [onReview]);

  const onBudgetRef = useRef(onBudget);
  useEffect(() => {
    onBudgetRef.current = onBudget;
  }, [onBudget]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;

    const drain = async () => {
      const route = await consumePendingRoute();
      if (cancelled || route === null) return;
      if (route === 'review') onReviewRef.current();
      else onBudgetRef.current?.(route.budget);
    };

    void drain();

    let removeResume: (() => void) | null = null;
    let resumeCancelled = false;
    CapApp.addListener('resume', () => {
      void drain();
    })
      .then((handle) => {
        if (resumeCancelled) handle.remove();
        else removeResume = () => handle.remove();
      })
      .catch(() => {});

    const removeTap = addNotificationTapListener((raw) => {
      const route = parseNotificationRoute(raw);
      if (route === 'review') onReviewRef.current();
      else if (route !== null) onBudgetRef.current?.(route.budget);
    });

    return () => {
      cancelled = true;
      resumeCancelled = true;
      removeResume?.();
      removeTap();
    };
  }, []);
}
