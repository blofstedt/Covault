import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createNotificationRule,
  deleteNotificationRule,
  updateNotificationRulePatternType,
  updateNotificationRulePattern,
  ruleSourceText,
  type NotificationRule,
  type CreateNotificationRuleInput,
  type PatternType,
} from '../../lib/notificationRules';
import {
  canFetchNotificationRules,
  notificationRulesKey,
  notificationRulesQuery,
} from '../../lib/queries/notificationRules';

interface UseNotificationRulesOptions {
  userId?: string;
}

const NO_RULES: NotificationRule[] = [];

export function useNotificationRules({ userId }: UseNotificationRulesOptions) {
  const queryClient = useQueryClient();
  const enabled = canFetchNotificationRules(userId);

  // Cached between visits and usually prefetched before Review opens — see
  // lib/queries/notificationRules.ts. A failed read keeps the list already
  // on screen rather than emptying it.
  const query = useQuery({
    ...notificationRulesQuery(userId ?? ''),
    enabled,
  });
  const rules = enabled ? query.data ?? NO_RULES : NO_RULES;
  const loading = query.isFetching;
  const { refetch } = query;

  const load = useCallback(async () => {
    if (enabled) await refetch();
  }, [enabled, refetch]);

  // Every write below edits the cached list in place, exactly as it used to
  // edit component state — so the change also survives leaving the page.
  const setRules = useCallback(
    (update: (prev: NotificationRule[]) => NotificationRule[]) => {
      if (!userId) return;
      queryClient.setQueryData<NotificationRule[]>(
        notificationRulesKey(userId),
        (prev) => update(prev ?? []),
      );
    },
    [queryClient, userId],
  );

  const create = useCallback(
    async (input: CreateNotificationRuleInput): Promise<NotificationRule | null> => {
      if (!userId) return null;
      const rule = await createNotificationRule(userId, input);
      if (rule) {
        setRules((prev) => [rule, ...prev]);
      }
      return rule;
    },
    [userId, setRules],
  );

  const remove = useCallback(
    async (ruleId: string): Promise<boolean> => {
      if (!userId) return false;
      const ok = await deleteNotificationRule(userId, ruleId);
      if (ok) {
        setRules((prev) => prev.filter((r) => r.id !== ruleId));
      }
      return ok;
    },
    [userId, setRules],
  );

  /**
   * Widen or narrow a rule in place.
   *
   * Applied to the list before the write is confirmed, and put back if it
   * fails: the control is a two-state switch, so a flick that visibly does
   * nothing for a second reads as a broken switch rather than a slow one.
   */
  const setPatternType = useCallback(
    async (ruleId: string, patternType: PatternType): Promise<boolean> => {
      if (!userId) return false;
      // Read before the optimistic write, not inside the updater: a state
      // updater runs when React gets round to it, which is not guaranteed to
      // be before the network call below resolves — so the undo value has to
      // be taken from the list as it stands now.
      const rule = rules.find((r) => r.id === ruleId);
      if (!rule || rule.pattern_type === patternType) return true;
      const previous = rule;
      const source = ruleSourceText(rule);
      // `exact` means the whole alert, so it takes the pattern back to the
      // full text — see updateNotificationRulePatternType.
      const nextPattern = patternType === 'exact' && source ? source : rule.pattern;

      setRules((prev) =>
        prev.map((r) =>
          r.id === ruleId ? { ...r, pattern_type: patternType, pattern: nextPattern } : r),
      );
      const ok = await updateNotificationRulePatternType(userId, ruleId, patternType, source);
      if (!ok) {
        setRules((prev) =>
          prev.map((r) =>
            r.id === ruleId
              ? { ...r, pattern_type: previous.pattern_type, pattern: previous.pattern }
              : r),
        );
      }
      return ok;
    },
    [userId, rules, setRules],
  );

  /**
   * Narrow a rule to a few words of the alert it came from.
   *
   * Optimistic like the type switch above, and put back the same way: the
   * pattern is what the user just chose on screen, so it has to appear as
   * chosen rather than a second later.
   */
  const setPattern = useCallback(
    async (ruleId: string, pattern: string): Promise<boolean> => {
      if (!userId) return false;
      const previous = rules.find((r) => r.id === ruleId)?.pattern;
      if (previous === undefined || previous === pattern) return true;

      setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, pattern } : r)));
      const ok = await updateNotificationRulePattern(userId, ruleId, pattern);
      if (!ok) {
        setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, pattern: previous } : r)));
      }
      return ok;
    },
    [userId, rules, setRules],
  );

  return { rules, loading, load, create, remove, setPatternType, setPattern };
}
