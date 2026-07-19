// lib/notificationRules.ts
//
// Skip-rule management for the notification pipeline.
//
// A "notification rule" is a user-created pattern that tells the parser
// to ignore future notifications matching it. This is the user's
// correction channel for "this isn't a transaction" cases (e.g. a bank
// promo push that mentions a dollar amount but isn't a charge).
//
// Different from `overrides` (which corrects/redirects) so kept in its
// own table.
//
// Pattern matching types:
//   - exact   : the raw notification text must equal the pattern.
//   - contains: the raw notification text must contain the pattern as a substring.

import { REST_BASE, getAuthHeaders } from './apiHelpers';

export type PatternType = 'exact' | 'contains';

export interface NotificationRule {
  id: string;
  user_id: string;
  pattern: string;
  pattern_type: PatternType;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
}

export interface CreateNotificationRuleInput {
  pattern: string;
  pattern_type?: PatternType;
}

export interface UpdateNotificationRuleInput {
  pattern?: string;
  pattern_type?: PatternType;
}

/**
 * Check whether a raw notification text matches any active rule for the
 * given user. Returns the matched rule or null. The lookup uses a single
 * `select=*` and matches in memory — rules tables are small (low tens
 * of rows even for power users) so the in-memory filter is cheaper
 * than per-row network calls.
 */
export async function checkNotificationRules(
  userId: string,
  rawNotification: string,
): Promise<NotificationRule | null> {
  if (!userId || !rawNotification) return null;
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `${REST_BASE}/notification_rules?select=*&user_id=eq.${userId}`,
      { headers, cache: 'no-store' },
    );
    if (!res.ok) return null;
    const rows: NotificationRule[] = await res.json();
    const normalized = rawNotification.trim();
    for (const rule of rows) {
      if (matchesRule(normalized, rule)) return rule;
    }
    return null;
  } catch (err) {
    console.warn('[notificationRules] check failed:', err);
    return null;
  }
}

export function matchesRule(rawNotification: string, rule: NotificationRule): boolean {
  if (!rule.pattern) return false;
  const text = rawNotification.trim();
  const pattern = rule.pattern.trim();
  if (!text || !pattern) return false;
  if (rule.pattern_type === 'contains') {
    return text.toLowerCase().includes(pattern.toLowerCase());
  }
  // default: exact
  return text === pattern;
}

/**
 * Increment the use_count of a rule (best-effort; doesn't block the
 * caller if it fails). The parser calls this whenever a rule matches.
 */
export async function bumpRuleUseCount(ruleId: string): Promise<void> {
  try {
    const headers = await getAuthHeaders();
    (headers as any)['Prefer'] = 'return=minimal';
    // We use a Postgres expression via the RPC-shaped header if the
    // project has it; otherwise we read-modify-write. To keep this
    // dependency-free we do read-modify-write with optimistic
    // concurrency: if the count moves under us, we just skip the bump.
    const readRes = await fetch(
      `${REST_BASE}/notification_rules?id=eq.${ruleId}&select=use_count`,
      { headers, cache: 'no-store' },
    );
    if (!readRes.ok) return;
    const rows: Array<{ use_count: number }> = await readRes.json();
    if (!rows || rows.length === 0) return;
    const current = rows[0].use_count ?? 0;
    await fetch(
      `${REST_BASE}/notification_rules?id=eq.${ruleId}&use_count=eq.${current}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          use_count: current + 1,
          last_used_at: new Date().toISOString(),
        }),
      },
    );
  } catch (err) {
    // Non-fatal: the rule still works, we just lose the count update.
    console.warn('[notificationRules] bumpUseCount failed:', err);
  }
}

export async function listNotificationRules(userId: string): Promise<NotificationRule[]> {
  if (!userId) return [];
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `${REST_BASE}/notification_rules?select=*&user_id=eq.${userId}&order=created_at.desc`,
      { headers, cache: 'no-store' },
    );
    if (!res.ok) return [];
    return (await res.json()) || [];
  } catch {
    return [];
  }
}

export async function createNotificationRule(
  userId: string,
  input: CreateNotificationRuleInput,
): Promise<NotificationRule | null> {
  if (!userId || !input.pattern) return null;
  try {
    const headers = await getAuthHeaders();
    (headers as any)['Prefer'] = 'return=representation';
    const body = {
      user_id: userId,
      pattern: input.pattern,
      pattern_type: input.pattern_type || 'exact',
    };
    const res = await fetch(`${REST_BASE}/notification_rules`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('[notificationRules] create failed:', res.status, await res.text());
      return null;
    }
    const rows: NotificationRule[] = await res.json();
    return rows[0] || null;
  } catch (err) {
    console.error('[notificationRules] create exception:', err);
    return null;
  }
}

export async function deleteNotificationRule(userId: string, ruleId: string): Promise<boolean> {
  if (!userId || !ruleId) return false;
  try {
    const headers = await getAuthHeaders();
    const res = await fetch(
      `${REST_BASE}/notification_rules?id=eq.${ruleId}&user_id=eq.${userId}`,
      { method: 'DELETE', headers },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function updateNotificationRule(
  userId: string,
  ruleId: string,
  patch: UpdateNotificationRuleInput,
): Promise<boolean> {
  if (!userId || !ruleId) return false;
  try {
    const headers = await getAuthHeaders();
    (headers as any)['Prefer'] = 'return=representation';
    const res = await fetch(
      `${REST_BASE}/notification_rules?id=eq.${ruleId}&user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
