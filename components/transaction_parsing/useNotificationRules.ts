import { useState, useCallback, useEffect } from 'react';
import {
  listNotificationRules,
  createNotificationRule,
  deleteNotificationRule,
  type NotificationRule,
  type CreateNotificationRuleInput,
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

  return { rules, loading, load, create, remove };
}
