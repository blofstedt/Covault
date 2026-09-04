// lib/communityRules.ts
//
// The community layer: what most households file a merchant under.
//
// ── Downloaded, never queried ────────────────────────────────────────────────
//
// The obvious implementation would ask the server about each captured merchant
// as the alert arrives. That would hand the server a live feed of where this
// household shops — strictly worse than the app is today, and not something a
// promise not to log it can undo. So the pool arrives as a PACK: the whole
// published table, fetched at most once a day, cached on the device, and
// matched locally. The server is never told what was captured, and the layer
// keeps working on a plane, in a basement, and with the app closed.
//
// That is the same shape lib/bankingApps.ts already uses for the bank list —
// a globally readable table, cached, with a local fallback — and it keeps the
// promise lib/merchantCategorySignals.ts makes about the capture path: nothing
// about the household's spending leaves the device.
//
// ── What it may do ───────────────────────────────────────────────────────────
//
// Suggest, never file. A community match sets a category on a row that goes to
// Review wearing a badge saying where the suggestion came from; it carries no
// match confidence, so it can never clear the auto-accept threshold. Accepting
// it once turns it into a rule of the user's own, and from then on it is theirs
// — see the adopt-on-accept path in components/TransactionParsing.tsx.
//
// ── Exact matches only ───────────────────────────────────────────────────────
//
// A user's own rules may match by prefix or by "contains"; the pool's may not.
// A short key from a stranger matching by substring is exactly the case the
// confidence scoring exists to distrust ("tim" against "TIM HORTONS"), and
// nobody is around to notice it went wrong. The pool answers on the whole
// normalised key or not at all.

import { restFetch } from './apiHelpers';
import { log } from './log';

/** One published pair: a merchant slug and the category most households file it under. */
export interface CommunityRule {
  matchKey: string;
  category: string;
}

const PACK_KEY = 'covault_community_rules_v1';
const FLAGS_KEY = 'covault_community_flags_v1';
/** How often the pack is re-fetched. The pool moves in weeks, not minutes. */
const PACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A ceiling, because this sits in the capture path and in localStorage. */
const MAX_PACK_ENTRIES = 20000;

interface StoredPack {
  fetchedAt: number;
  rules: CommunityRule[];
}

interface CommunityFlags {
  /** Use the pool's suggestions. On by default: nothing about the user leaves. */
  enabled: boolean;
  /** Volunteer this household's own pairs. Off until deliberately turned on. */
  contribute: boolean;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    log.warn('[communityRules] Could not write to local storage');
  }
}

/**
 * The user's two answers, mirrored where the capture path can read them.
 *
 * The pipeline runs with the app closed and has no access to React state, so
 * the settings row is mirrored here whenever it loads. A phone that has never
 * seen the settings row gets the defaults, which are the safe ones: receive,
 * do not send.
 */
export function getCommunityFlags(): CommunityFlags {
  const stored = readJson<Partial<CommunityFlags>>(FLAGS_KEY, {});
  return {
    enabled: stored.enabled !== false,
    contribute: stored.contribute === true,
  };
}

export function setCommunityFlags(flags: Partial<CommunityFlags>): void {
  writeJson(FLAGS_KEY, { ...getCommunityFlags(), ...flags });
}

/** The cached pack, whatever its age. Empty when there has never been one. */
export function getCommunityPack(): CommunityRule[] {
  const stored = readJson<StoredPack | null>(PACK_KEY, null);
  return Array.isArray(stored?.rules) ? stored!.rules : [];
}

/**
 * What the pool says about a merchant, or null.
 *
 * Null on every uncertainty, deliberately — the flag being off, an empty or
 * never-fetched pack, a key the pool has no decided answer for. A miss here
 * falls through to the model's guess and the offline descriptor hint, which is
 * where the app was before this layer existed. The one thing this must never
 * do is fail into a *wrong* answer; the skip-rules table already documents how
 * quietly a fail-open read goes wrong.
 */
export function lookupCommunityRule(vendorKey: string): CommunityRule | null {
  if (!vendorKey) return null;
  if (!getCommunityFlags().enabled) return null;
  const pack = getCommunityPack();
  if (pack.length === 0) return null;
  const key = vendorKey.toLowerCase();
  for (const rule of pack) {
    if (rule.matchKey === key) return rule;
  }
  return null;
}

/**
 * Refresh the pack if it is older than a day. Safe to call on every launch.
 *
 * A failed fetch leaves the previous pack in place and says nothing: the pool
 * is an optimisation, and an app that cannot reach it must behave exactly like
 * an app that has never heard of it.
 */
export async function refreshCommunityPack(force = false): Promise<void> {
  if (!getCommunityFlags().enabled) return;

  const stored = readJson<StoredPack | null>(PACK_KEY, null);
  const age = stored ? Date.now() - (stored.fetchedAt || 0) : Infinity;
  if (!force && age < PACK_MAX_AGE_MS) return;

  try {
    const res = await restFetch(
      `/community_rules?select=match_key,category_id&limit=${MAX_PACK_ENTRIES}`,
      { cache: 'no-store' },
    );
    // A 404 is the honest answer on a project where the migration has not been
    // applied. Treated exactly like any other failure: keep what we have.
    if (!res.ok) {
      log.debug('[communityRules] pack unavailable:', res.status);
      return;
    }
    const rows = await res.json();
    if (!Array.isArray(rows)) return;
    const rules: CommunityRule[] = rows
      .map((row: any) => ({
        matchKey: String(row?.match_key || '').toLowerCase(),
        category: String(row?.category_id || ''),
      }))
      .filter((rule: CommunityRule) => rule.matchKey && rule.category);
    writeJson(PACK_KEY, { fetchedAt: Date.now(), rules } satisfies StoredPack);
    log.debug(`[communityRules] pack refreshed: ${rules.length} merchants`);
  } catch (e) {
    log.warn('[communityRules] Could not refresh the pack:', e);
  }
}

/**
 * Volunteer one pair, if this household has opted in.
 *
 * A no-op when they have not, which is the default. What goes out is the
 * merchant slug and the category name — never an amount, a date, a bank, the
 * user's own spelling of the vendor, or anything about how often they shop.
 *
 * One row per household per merchant (the table's primary key), so teaching a
 * merchant a second category replaces the household's contribution rather than
 * casting a second vote.
 */
export async function contributeRule(
  userId: string | undefined,
  matchKey: string,
  categoryName: string,
): Promise<void> {
  if (!userId || !matchKey || !categoryName) return;
  if (!getCommunityFlags().contribute) return;

  try {
    await restFetch('/rule_contributions', {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      // Three fields, and the list is the privacy promise: who is
      // contributing (so it can be withdrawn), which shop, which category. Not
      // even a timestamp — the database stamps its own, and one supplied by
      // the client would say when this household taught the rule, which is a
      // fact about them rather than about the shop.
      body: JSON.stringify({
        user_id: userId,
        match_key: matchKey.toLowerCase(),
        category_id: categoryName,
      }),
    });
  } catch (e) {
    // Best effort, always. Contributing is a courtesy to other households and
    // must never be able to fail the user's own rule write.
    log.warn('[communityRules] Could not contribute a rule:', e);
  }
}

/** Take one pair back, when the rule it came from is deleted. */
export async function withdrawRule(userId: string | undefined, matchKey: string): Promise<void> {
  if (!userId || !matchKey) return;
  try {
    await restFetch(
      `/rule_contributions?user_id=eq.${userId}&match_key=eq.${encodeURIComponent(matchKey.toLowerCase())}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
    );
  } catch (e) {
    log.warn('[communityRules] Could not withdraw a rule:', e);
  }
}

/**
 * Take everything back — what turning contribution off has to mean.
 *
 * Opting out that only stopped future contributions would leave everything
 * already sent in the pool for good, which would make the switch a lie.
 */
export async function withdrawAllContributions(userId: string | undefined): Promise<void> {
  if (!userId) return;
  try {
    await restFetch(`/rule_contributions?user_id=eq.${userId}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    log.debug('[communityRules] withdrew every contribution');
  } catch (e) {
    log.warn('[communityRules] Could not withdraw contributions:', e);
  }
}
