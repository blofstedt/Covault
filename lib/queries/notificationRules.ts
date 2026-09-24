// lib/queries/notificationRules.ts
//
// The Review page's skip-rules list as a cached query.
//
// It used to be fetched from scratch every time Review opened, so the
// "learned rules" card started empty on every visit. Now the list is kept
// between visits, and it is fetched ahead of time — once the dashboard has
// settled, and again the moment a finger lands on the Review button (the
// phone's equivalent of hovering a link) — so it is usually already there
// when the page opens.
import type { QueryClient } from '@tanstack/react-query';
import { fetchNotificationRuleList, type NotificationRule } from '../notificationRules';

export const notificationRulesKey = (userId: string) => ['notification-rules', userId] as const;

/** Only a real signed-in user has rules to fetch; the walkthrough's demo user does not. */
export const canFetchNotificationRules = (userId: string | undefined): userId is string =>
  !!userId && userId !== 'tour';

export const notificationRulesQuery = (userId: string) => ({
  queryKey: notificationRulesKey(userId),
  queryFn: (): Promise<NotificationRule[]> => fetchNotificationRuleList(userId),
});

/**
 * Warm the cache. Does nothing while the cached copy is still fresh, so
 * calling it on every touch of the Review button costs nothing.
 */
export function prefetchNotificationRules(client: QueryClient, userId: string | undefined): void {
  if (!canFetchNotificationRules(userId)) return;
  void client.prefetchQuery(notificationRulesQuery(userId));
}
