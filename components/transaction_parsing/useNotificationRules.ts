import { useState, useCallback, useEffect } from 'react';
import {
  listNotificationRules,
  createNotificationRule,
  deleteNotificationRule,
  updateNotificationRulePatternType,
  type NotificationRule,
  type CreateNotificationRuleInput,
  type PatternType,
} from '../../lib/notificationRules';

interface UseNotificationRulesOptions {
  userId?: string;
}

export function useNotificationRules({ userId }: UseNotificationRulesOptions) {
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setRules([]);
      return;
    }
    setLoading(true);
    try {
      const data = await listNotificationRules(userId);
      setRules(data);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(
    async (input: CreateNotificationRuleInput): Promise<NotificationRule | null> => {
      if (!userId) return null;
      const rule = await createNotificationRule(userId, input);
      if (rule) {
        setRules((prev) => [rule, ...prev]);
      }
      return rule;
    },
    [userId],
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
    [userId],
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
      const previous = rules.find((r) => r.id === ruleId)?.pattern_type;
      if (!previous || previous === patternType) return true;

      setRules((prev) =>
        prev.map((r) => (r.id === ruleId ? { ...r, pattern_type: patternType } : r)),
      );
      const ok = await updateNotificationRulePatternType(userId, ruleId, patternType);
      if (!ok) {
        setRules((prev) =>
          prev.map((r) => (r.id === ruleId ? { ...r, pattern_type: previous } : r)),
        );
      }
      return ok;
    },
    [userId, rules],
  );

  return { rules, loading, load, create, remove, setPatternType };
}
