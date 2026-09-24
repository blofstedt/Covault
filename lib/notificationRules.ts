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

import { log } from './log';
import { restFetch } from './apiHelpers';
import { covaultNotification, pushSkipRules } from './covaultNotification';
import { shapeMatches } from './notificationShape';

export type PatternType = 'exact' | 'contains';

/**
 * One alert this rule actually silenced.
 *
 * A skip rule works by making things disappear, so a counter is the weakest
 * possible evidence about it: "skipped 6 alerts" says nothing about whether
 * those six were the noise the user meant to silence or a purchase they will
 * now never see. The wording is what answers that, and it is the only place
 * it can be answered from — a skipped alert is dropped, never stored as a row.
 */
export interface RuleUse {
  /** When it fired, ISO. */
  at: string;
  /** The alert's text, truncated — see MAX_USE_TEXT. */
  text: string;
}

/** How many of the most recent uses a rule carries. */
export const MAX_RECENT_USES = 5;

/**
 * How much of each alert is kept.
 *
 * Enough to recognise which alert it was at a glance, which is all the list
 * is for. The whole text would make the rules table carry a copy of every
 * silenced notification indefinitely, for a row that is read once in a while
 * by one person.
 */
const MAX_USE_TEXT = 160;

export interface NotificationRule {
  id: string;
  user_id: string;
  pattern: string;
  pattern_type: PatternType;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  /** The most recent alerts this rule silenced, newest first. Absent on a
   *  database that has not had the `recent_uses` migration run against it. */
  recent_uses?: RuleUse[];
  /**
   * The whole alert this rule was made from.
   *
   * `pattern` is what gets matched and may be a span of a few words out of
   * this; this is the copy those words are chosen from, and the text a rule
   * goes back to when it is set to `exact`. Null on a database without the
   * column, and on nothing else — every rule written before it had `pattern`
   * holding both jobs, which is what the migration backfilled from.
   */
  source_text?: string | null;
}

/** The alert a rule was made from, falling back to the pattern itself. */
export function ruleSourceText(rule: NotificationRule): string {
  const source = (rule.source_text || '').trim();
  return source || rule.pattern;
}

/** The stored uses of a rule, defensively — the column is free-form jsonb. */
export function readRecentUses(rule: NotificationRule): RuleUse[] {
  const raw = rule.recent_uses;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is RuleUse =>
      !!row && typeof row === 'object'
      && typeof (row as RuleUse).text === 'string'
      && typeof (row as RuleUse).at === 'string')
    .slice(0, MAX_RECENT_USES);
}

export interface CreateNotificationRuleInput {
  pattern: string;
  pattern_type?: PatternType;
}

/**
 * Check whether a raw notification text matches any active rule for the
 * given user. Returns the matched rule or null. The lookup uses a single
 * `select=*` and matches in memory — rules tables are small (low tens
 * of rows even for power users) so the in-memory filter is cheaper
 * than per-row network calls.
 */
/**
 * Short-lived cache of the rules table, keyed by user.
 *
 * checkNotificationRules runs once per captured notification, and a
 * scanActiveNotifications() burst processes every banking notification in the
 * shade back-to-back — which meant one identical GET per notification. The TTL
 * is deliberately short, and every write path calls
 * invalidateNotificationRulesCache() so a rule the user just created or
 * deleted takes effect immediately rather than after the TTL.
 */
const RULES_CACHE_TTL_MS = 30_000;
let rulesCache: { userId: string; rows: NotificationRule[]; at: number } | null = null;

export function invalidateNotificationRulesCache(): void {
  rulesCache = null;
}

async function fetchRules(userId: string): Promise<NotificationRule[] | null> {
  const now = Date.now();
  if (rulesCache && rulesCache.userId === userId && now - rulesCache.at < RULES_CACHE_TTL_MS) {
    return rulesCache.rows;
  }
  const res = await restFetch(
    `/notification_rules?select=*&user_id=eq.${userId}`,
    { cache: 'no-store' },
  );
  if (!res.ok) return null;
  const rows: NotificationRule[] = (await res.json()) || [];
  rulesCache = { userId, rows, at: now };
  mirrorRulesToNative(rows);
  return rows;
}

/**
 * Keep the native listener's copy of the skip rules in step with this one.
 *
 * Applying a rule in here is only half the job. The web pipeline decides
 * whether a row reaches the ledger, but the "$X at Y — captured" notification
 * is posted by a service that runs with the WebView dead — so a rule known
 * only here silences the row and leaves the notification, which is precisely
 * the case where the user is told about a capture that never appears in
 * Review.
 *
 * Fire-and-forget, and called from the paths that already know the full set:
 * every refresh of the cache, and every create/delete. A failed mirror costs
 * one unwanted notification, never a purchase, so it must not be allowed to
 * fail a capture or block the caller.
 */
function mirrorRulesToNative(rows: NotificationRule[]): void {
  void pushSkipRules(
    rows.map((row) => ({ pattern: row.pattern, pattern_type: row.pattern_type })),
  );
}

/**
 * Re-read the rules and push them down after a create or delete.
 *
 * Waiting for the next capture to refresh the cache would leave the native
 * copy one notification behind — and the notification the user wants silenced
 * is usually the very next one, since they only just told us to ignore it.
 */
function refreshNativeSkipRules(userId: string): void {
  // The read exists only to feed the native copy, so there is no reason to
  // make it anywhere there is no native copy to feed.
  if (!covaultNotification) return;
  void fetchRules(userId).catch(() => {
    // Best-effort. The rule is already saved and the web pipeline honours it;
    // only the native silence is delayed until the next successful read.
  });
}

export async function checkNotificationRules(
  userId: string,
  rawNotification: string,
): Promise<NotificationRule | null> {
  if (!userId || !rawNotification) return null;
  try {
    const rows = await fetchRules(userId);
    if (!rows) return null;
    const normalized = rawNotification.trim();
    for (const rule of rows) {
      if (matchesRule(normalized, rule)) return rule;
    }
    return null;
  } catch (err) {
    log.warn('[notificationRules] check failed:', err);
    return null;
  }
}

/**
 * The patterns the user has told Covault to ignore, for the second look the
 * model takes at anything close to one of them.
 *
 * Reads through the same cache the check above just filled, so on the path
 * that uses it this costs nothing. A failed read is an empty list: no
 * patterns, no candidates, no second look — which is where the app was before
 * any of this existed.
 */
export async function listIgnoredPatterns(userId: string): Promise<string[]> {
  if (!userId) return [];
  try {
    const rows = await fetchRules(userId);
    return (rows || []).map((row) => row.pattern).filter((pattern) => !!pattern);
  } catch {
    return [];
  }
}

export function matchesRule(rawNotification: string, rule: NotificationRule): boolean {
  return matchesPattern(rawNotification, rule.pattern, rule.pattern_type);
}

/**
 * The one answer to "would this pattern silence this alert?".
 *
 * Split out from matchesRule so the screen that lets a user shorten a pattern
 * can ask the same question of their own past purchases before saving it. A
 * preview that decided this a second way would be a preview of something the
 * app does not do.
 */
export function matchesPattern(
  rawNotification: string,
  rawPattern: string,
  patternType: PatternType,
): boolean {
  if (!rawPattern) return false;
  const text = (rawNotification || '').trim();
  const pattern = rawPattern.trim();
  if (!text || !pattern) return false;
  if (patternType === 'contains') {
    // A pattern with no words in it cannot say WHICH alert it means, and as a
    // `contains` rule it would silence every alert carrying that figure — a
    // rule made from an alert that is only "$42.10" would have swallowed every
    // $42.10 purchase the household ever made. The shape comparison below has
    // refused this since it was written; the plain substring test did not, and
    // now that a rule's width can be changed after the fact, the flick of a
    // switch is all it would take to reach it.
    if (!/[a-z]/i.test(pattern)) return false;
    if (text.toLowerCase().includes(pattern.toLowerCase())) return true;
  } else if (text === pattern) {
    return true;
  }
  // ── The same alert, a different number ──
  //
  // A rule is created from the whole text of the alert the user marked, and
  // that text carries the alert's own figure. So a rule made from a price
  // alert, a balance warning or a points update could never fire again — the
  // next one says a different number — while sitting in the rules list looking
  // like an instruction the app was following.
  //
  // Comparing shapes instead is what makes "ignore alerts like this one" mean
  // what the user meant. It only ever ADDS matches to the comparison above, so
  // nothing a rule used to catch stops being caught. See notificationShape.ts
  // for why this cannot quietly widen to a different merchant.
  return shapeMatches(pattern, text, patternType === 'contains' ? 'contains' : 'exact');
}

/**
 * Whether this database has the `recent_uses` column.
 *
 * Asked once, by watching whether a select naming it comes back. PostgREST
 * 400s a whole select on one unknown column, so a database without the
 * migration would otherwise cost two requests on every skipped alert — and,
 * worse, a PATCH naming the column would fail outright and take the use COUNT
 * down with it. The count is the older, load-bearing half: it is what the
 * rules list has always shown.
 *
 * `null` means not yet known. Never cached as false permanently — a reload
 * after the migration is run picks it up.
 */
let recentUsesColumn: boolean | null = null;

/**
 * Whether this database has the `source_text` column, learned the same way and
 * for the same reason: a write naming a column that is not there is refused
 * whole, and a skip rule the user just asked for matters more than remembering
 * which alert it came from.
 */
let sourceTextColumn: boolean | null = null;

/** One stored use, from an alert. */
function recentUseEntry(alertText: string): RuleUse {
  const text = alertText.replace(/\s+/g, ' ').trim().slice(0, MAX_USE_TEXT);
  return { at: new Date().toISOString(), text };
}

/**
 * Record that a rule fired: one on the count, and the alert itself on the
 * short list of what it has silenced.
 *
 * Best-effort and never blocks the caller — the capture pipeline has already
 * decided to drop this notification and must not wait on bookkeeping.
 *
 * Read-modify-write with optimistic concurrency rather than a Postgres
 * expression, to keep this dependency-free: if the count moves under us the
 * bump is skipped rather than clobbering whatever else wrote.
 */
export async function bumpRuleUseCount(ruleId: string, alertText?: string): Promise<void> {
  try {
    const wantRecent = recentUsesColumn !== false;
    const columns = wantRecent ? 'use_count,recent_uses' : 'use_count';
    let readRes = await restFetch(
      `/notification_rules?id=eq.${ruleId}&select=${columns}`,
      { cache: 'no-store' },
    );
    if (!readRes.ok && wantRecent) {
      // The migration has not been run here. Remembered, so the next skipped
      // alert asks for the column that does exist and costs one request.
      recentUsesColumn = false;
      readRes = await restFetch(
        `/notification_rules?id=eq.${ruleId}&select=use_count`,
        { cache: 'no-store' },
      );
    }
    if (!readRes.ok) return;

    const rows: Array<{ use_count: number; recent_uses?: unknown }> = await readRes.json();
    if (!rows || rows.length === 0) return;
    const haveColumn = recentUsesColumn !== false && 'recent_uses' in rows[0];
    if (haveColumn) recentUsesColumn = true;

    const current = rows[0].use_count ?? 0;
    const body: Record<string, unknown> = {
      use_count: current + 1,
      last_used_at: new Date().toISOString(),
    };
    if (haveColumn && alertText) {
      const existing = Array.isArray(rows[0].recent_uses)
        ? (rows[0].recent_uses as RuleUse[]).filter(
            (row) => !!row && typeof row.text === 'string' && typeof row.at === 'string')
        : [];
      // Newest first, trimmed here rather than in the database: the column is
      // the app's own list and nothing else writes it.
      body.recent_uses = [recentUseEntry(alertText), ...existing].slice(0, MAX_RECENT_USES);
    }

    await restFetch(
      `/notification_rules?id=eq.${ruleId}&use_count=eq.${current}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(body),
      },
    );
  } catch (err) {
    // Non-fatal: the rule still works, we just lose the count update.
    log.warn('[notificationRules] bumpUseCount failed:', err);
  }
}

export async function listNotificationRules(userId: string): Promise<NotificationRule[]> {
  if (!userId) return [];
  try {
    const res = await restFetch(
      `/notification_rules?select=*&user_id=eq.${userId}&order=created_at.desc`,
      { cache: 'no-store' },
    );
    if (!res.ok) return [];
    const rows: NotificationRule[] = (await res.json()) || [];
    mirrorRulesToNative(rows);
    return rows;
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
    const body: Record<string, unknown> = {
      user_id: userId,
      pattern: input.pattern,
      pattern_type: input.pattern_type || 'exact',
    };
    // The alert is written twice on purpose: once as what this rule matches,
    // and once as the copy the user picks words out of later. They are the
    // same text today and stop being the same the moment the pattern is
    // shortened.
    if (sourceTextColumn !== false) body.source_text = input.pattern;
    let res = await restFetch(`/notification_rules`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(body),
    });
    if (!res.ok && sourceTextColumn !== false && 'source_text' in body) {
      // The migration has not been run here. A rule that cannot remember which
      // alert it came from is still a working rule, so it is written without.
      sourceTextColumn = false;
      delete body.source_text;
      res = await restFetch(`/notification_rules`, {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(body),
      });
    }
    if (!res.ok) {
      log.error('[notificationRules] create failed:', res.status, await res.text());
      return null;
    }
    const rows: NotificationRule[] = await res.json();
    invalidateNotificationRulesCache();
    refreshNativeSkipRules(userId);
    return rows[0] || null;
  } catch (err) {
    log.error('[notificationRules] create exception:', err);
    return null;
  }
}

/**
 * Change a rule's match type between "exact" and "contains".
 *
 * The one thing about a skip rule the user can change without deleting it and
 * starting again. The pattern itself is the text of the alert they marked, so
 * it is not editable — what they actually get wrong is how WIDE it should be:
 * a rule made from one promo push is written `exact` and then never fires
 * again because the next promo is worded slightly differently.
 *
 * Widening is the direction that can cost a purchase — a `contains` rule on a
 * short, common phrase silences everything carrying it, and a silenced alert
 * with the app closed is a spend nothing downstream can recover. That is what
 * the use count next to the control is for: it is the only evidence the user
 * has about what a rule has actually been doing.
 *
 * Both copies have to move together. The web pipeline decides whether a row
 * reaches the ledger, but the "captured" notification is posted by a service
 * running with the WebView dead, so a type known only here silences the row
 * and leaves the notification — see mirrorRulesToNative.
 */
export async function updateNotificationRulePatternType(
  userId: string,
  ruleId: string,
  patternType: PatternType,
  /** The alert the rule was made from, when the caller knows it. */
  sourceText?: string,
): Promise<boolean> {
  if (!userId || !ruleId) return false;
  const body: Record<string, unknown> = { pattern_type: patternType };
  // Going back to `exact` restores the whole alert. A rule left holding three
  // words out of the middle would be asking whether the bank ever sends an
  // alert that is only those three words — never, in silence, while the rules
  // list goes on showing it as a rule the app is following.
  const full = (sourceText || '').trim();
  if (patternType === 'exact' && full) body.pattern = full;
  return patchRule(userId, ruleId, body);
}

/**
 * Change which words of its alert a rule matches on.
 *
 * Only meaningful for a `contains` rule: `exact` means the whole alert, so a
 * shortened pattern under it would be a rule asking whether a bank ever sends
 * an alert consisting of three words and nothing else — which is to say a rule
 * that never fires again, sitting in the list looking like one that does. That
 * is why setting a rule back to `exact` restores its full text rather than
 * keeping the span; see updateNotificationRulePatternType.
 *
 * Whether the phrase is fit to save is decided before this is called — see
 * checkSkipPhrase in lib/skipPhrase.ts, which tests it against the alerts the
 * household's own captured purchases arrived on.
 */
export async function updateNotificationRulePattern(
  userId: string,
  ruleId: string,
  pattern: string,
): Promise<boolean> {
  const next = (pattern || '').trim();
  if (!userId || !ruleId || !next) return false;
  return patchRule(userId, ruleId, { pattern: next });
}

/** One PATCH against one rule, owner-scoped, with the cache and the phone told. */
async function patchRule(
  userId: string,
  ruleId: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await restFetch(
      `/notification_rules?id=eq.${ruleId}&user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      log.error('[notificationRules] update failed:', res.status, await res.text());
      return false;
    }
    invalidateNotificationRulesCache();
    refreshNativeSkipRules(userId);
    return true;
  } catch (err) {
    log.error('[notificationRules] update exception:', err);
    return false;
  }
}

export async function deleteNotificationRule(userId: string, ruleId: string): Promise<boolean> {
  if (!userId || !ruleId) return false;
  try {
    const res = await restFetch(
      `/notification_rules?id=eq.${ruleId}&user_id=eq.${userId}`,
      { method: 'DELETE' },
    );
    if (res.ok) {
      invalidateNotificationRulesCache();
      refreshNativeSkipRules(userId);
    }
    return res.ok;
  } catch {
    return false;
  }
}
