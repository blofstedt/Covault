// lib/smartCards.ts
// Generates smart notification cards for the swipeable deck.
//
// Dismissal model: "I saw it, thanks" — a dismissed card is hidden until
// the underlying data changes enough to make it worth showing again.
// We track dismissals as {id, dismissedAt, category, permanent} so each
// card type can decide its own re-show rule. Vendor-suggestion "No"s
// are permanent (the user is telling us not to default that vendor);
// everything else re-shows when the data shifts.

import type { Transaction, BudgetCategory } from '../types';
import { getLocalToday } from './dateUtils';

export type SmartCardType =
  | 'overspend'
  | 'insight'
  | 'upcoming-bill'
  | 'vendor-suggestion'
  | 'partner-total';

export interface SmartCard {
  /** Stable key so we can track dismissals across sessions */
  id: string;
  type: SmartCardType;
  title: string;
  body: string;
  /** Accent colour for the left strip / icon */
  accent: 'amber' | 'emerald' | 'blue' | 'violet' | 'rose';
  /** ISO timestamp when the card was generated */
  createdAt: string;
}

// ── Dismissed-card persistence ────────────────────────────────────
//
// v2 schema: list of {id, dismissedAt, category, permanent?}. v1 was a
// plain Set<string> with no category/timestamp info, so we can't reason
// about re-show rules from it. On first read we look for the v1 key and
// drop it (no migration — old dismissals are forgotten, which is the
// simpler and safer default for a behavior change).
const DISMISSED_KEY = 'covault_dismissed_cards_v2';
const LEGACY_DISMISSED_KEY = 'covault_dismissed_cards';

interface DismissedCard {
  id: string;
  dismissedAt: number;
  category: SmartCardType;
  permanent?: boolean;
}

function getDismissedCards(): DismissedCard[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore corrupt data */ }
  // One-time legacy cleanup so the v1 key doesn't linger forever.
  try { localStorage.removeItem(LEGACY_DISMISSED_KEY); } catch { /* ignore */ }
  return [];
}

function saveDismissedCards(cards: DismissedCard[]): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(cards));
  } catch { /* ignore quota / private mode */ }
}

/**
 * Mark a card as dismissed. Pass `permanent: true` for vendor-suggestion
 * "No" votes — the user is telling us never to ask about that vendor
 * again. All other categories re-surface when the underlying data
 * changes (see `shouldReshow`).
 */
export function dismissCard(id: string, category: SmartCardType, permanent = false): void {
  const all = getDismissedCards();
  const filtered = all.filter((c) => c.id !== id);
  filtered.push({ id, dismissedAt: Date.now(), category, permanent });
  saveDismissedCards(filtered);
}

/** Returns true if the given card is still considered dismissed. */
function isDismissed(card: SmartCard, dismissed: DismissedCard[]): boolean {
  const entry = dismissed.find((d) => d.id === card.id);
  if (!entry) return false;
  if (entry.permanent) return true;
  return !shouldReshow(entry);
}

/**
 * Re-show rules per category. The card's ID is already designed to change
 * when the underlying data changes (e.g. days-away bucket, month rollover),
 * so a card that still matches a dismissed ID means the data hasn't
 * shifted yet. The only category where the ID is stable across the
 * month is `overspend` — that's the one that needs the timestamp check.
 */
function shouldReshow(entry: DismissedCard): boolean {
  const now = new Date();
  switch (entry.category) {
    case 'overspend': {
      // Re-surface at the start of the next calendar month.
      const d = new Date(entry.dismissedAt);
      const startOfNextMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      return now >= startOfNextMonth;
    }
    case 'insight':
    case 'upcoming-bill':
    case 'partner-total':
      // These IDs already include the time bucket (month / days-away /
      // calendar day), so a same-ID match means the data hasn't shifted.
      // Don't re-show via the dismissed check; the ID change will trigger
      // it naturally.
      return false;
    case 'vendor-suggestion':
      // Permanent "no" — never re-show for this vendor.
      return false;
  }
}

// ── Card generators ──────────────────────────────────────────────

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function previousMonthKey(): string {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
}

function txMonthKey(tx: Transaction): string {
  return (tx.date || '').slice(0, 7);
}

/** 1. Budget overspend alerts: fires when a category ≥ 80% or ≥ 100%.
 *  No month key in the ID — re-show logic is handled by shouldReshow
 *  (next calendar month). */
export function generateOverspendCards(
  budgets: BudgetCategory[],
  transactions: Transaction[],
): SmartCard[] {
  const mk = currentMonthKey();
  const cards: SmartCard[] = [];

  for (const b of budgets) {
    const spent = transactions
      .filter((t) => t.budget_id === b.id && txMonthKey(t) === mk && !t.is_projected)
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);

    const pct = b.totalLimit > 0 ? spent / b.totalLimit : 0;

    if (pct >= 1) {
      cards.push({
        id: `overspend-100-${b.id}`,
        type: 'overspend',
        title: `${b.name} Over Budget`,
        body: `You've spent $${spent.toFixed(0)} of your $${b.totalLimit.toFixed(0)} ${b.name} budget this month.`,
        accent: 'rose',
        createdAt: new Date().toISOString(),
      });
    } else if (pct >= 0.8) {
      cards.push({
        id: `overspend-80-${b.id}`,
        type: 'overspend',
        title: `${b.name} Almost Full`,
        body: `You've used ${Math.round(pct * 100)}% of your $${b.totalLimit.toFixed(0)} ${b.name} budget.`,
        accent: 'amber',
        createdAt: new Date().toISOString(),
      });
    }
  }

  return cards;
}

/** 2. Month-over-month insight card. ID includes the month key so
 *  next month naturally gets a new card; within a month the
 *  same-ID dismissal holds. */
export function generateInsightCards(
  budgets: BudgetCategory[],
  transactions: Transaction[],
): SmartCard[] {
  const current = currentMonthKey();
  const previous = previousMonthKey();

  type Delta = { name: string; diff: number };
  const deltas: Delta[] = [];

  for (const b of budgets) {
    const curSpent = transactions
      .filter((t) => t.budget_id === b.id && txMonthKey(t) === current && !t.is_projected)
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const prevSpent = transactions
      .filter((t) => t.budget_id === b.id && txMonthKey(t) === previous && !t.is_projected)
      .reduce((s, t) => s + Math.abs(t.amount), 0);

    if (prevSpent > 0 || curSpent > 0) {
      deltas.push({ name: b.name, diff: curSpent - prevSpent });
    }
  }

  if (deltas.length === 0) return [];

  deltas.sort((a, b) => b.diff - a.diff);

  const biggest = deltas[0];
  const smallest = deltas[deltas.length - 1];

  const parts: string[] = [];
  if (biggest && biggest.diff > 0) {
    parts.push(`$${Math.abs(biggest.diff).toFixed(0)} more on ${biggest.name}`);
  }
  if (smallest && smallest.diff < 0) {
    parts.push(`$${Math.abs(smallest.diff).toFixed(0)} less on ${smallest.name}`);
  }

  if (parts.length === 0) return [];

  // Only surface the insight if the data is interesting — at least one
  // category shifted by ≥ 20% of last month's spend. Otherwise it's
  // just noise.
  const totalPrev = deltas.reduce((s, d) => s + Math.max(0, -d.diff) + Math.max(0, d.diff), 0) / 2;
  const biggestAbs = Math.max(Math.abs(biggest?.diff ?? 0), Math.abs(smallest?.diff ?? 0));
  if (totalPrev > 0 && biggestAbs / totalPrev < 0.2) return [];

  return [
    {
      id: `insight-${current}`,
      type: 'insight',
      title: 'Monthly Snapshot',
      body: `You spent ${parts.join(' and ')} last month.`,
      accent: 'blue',
      createdAt: new Date().toISOString(),
    },
  ];
}

/** 3. Upcoming bills (recurring transactions due within 3 days).
 *  The ID includes a bucket so the card re-surfaces when urgency
 *  crosses a threshold: 3 days out is one card, "due in 1 day" or
 *  "due today" is a separate card. Dismissing the 3-day card doesn't
 *  suppress the urgent card. */
function nextOccurrence(txDate: string, recurrence: string, from: Date): Date | null {
  const rec = recurrence.toLowerCase();
  if (rec === 'one-time' || !rec) return null;

  const baseStr = txDate.slice(0, 10);
  const parts = baseStr.split('-');
  if (parts.length < 3) return null;
  const base = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  if (isNaN(base.getTime())) return null;

  if (base >= from) return base;

  let current = new Date(base);
  while (current < from) {
    if (rec === 'biweekly') {
      current = new Date(current);
      current.setDate(current.getDate() + 14);
    } else if (rec === 'monthly') {
      current = new Date(current);
      current.setMonth(current.getMonth() + 1);
    } else {
      return null;
    }
  }
  return current;
}

export function generateUpcomingBillCards(
  transactions: Transaction[],
  budgets: BudgetCategory[],
): SmartCard[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const budgetMap = new Map(budgets.map((b) => [b.id, b.name]));
  const cards: SmartCard[] = [];

  for (const tx of transactions) {
    const rec = ((tx as any).recur ?? tx.recurrence ?? '').toString().toLowerCase();
    if (rec === 'one-time' || !rec) continue;

    const dueDate = nextOccurrence(tx.date, rec, now);
    if (!dueDate) continue;

    const daysAway = Math.round((dueDate.getTime() - now.getTime()) / 86400000);
    // One heads-up at the 3-day mark. No escalation to "due tomorrow" /
    // "due today" — the user either saw it or didn't.
    if (daysAway !== 3) continue;

    const category = tx.budget_id ? budgetMap.get(tx.budget_id) : undefined;
    const dueDateStr = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;

    cards.push({
      id: `bill-${tx.id}-${dueDateStr}`,
      type: 'upcoming-bill',
      title: 'Upcoming Payment',
      body: `$${Math.abs(tx.amount).toFixed(2)} to ${tx.vendor}${category ? ` (${category})` : ''} is due in 3 days.`,
      accent: 'violet',
      createdAt: new Date().toISOString(),
    });
  }

  return cards;
}

/** 4. Smart vendor categorization suggestion. No month key — dismissal
 *  is permanent via dismissCard(..., 'vendor-suggestion', true). */
export function generateVendorSuggestionCards(
  transactions: Transaction[],
  budgets: BudgetCategory[],
): SmartCard[] {
  const vendorCategories = new Map<string, Map<string, number>>();
  const budgetMap = new Map(budgets.map((b) => [b.id, b.name]));

  for (const tx of transactions) {
    if (!tx.vendor || !tx.budget_id) continue;
    const key = tx.vendor.toLowerCase();
    if (!vendorCategories.has(key)) vendorCategories.set(key, new Map());
    const cats = vendorCategories.get(key)!;
    cats.set(tx.budget_id, (cats.get(tx.budget_id) || 0) + 1);
  }

  const cards: SmartCard[] = [];

  for (const [vendor, cats] of vendorCategories) {
    if (cats.size < 2) continue;

    let topId = '';
    let topCount = 0;
    let total = 0;
    for (const [catId, count] of cats) {
      total += count;
      if (count > topCount) {
        topCount = count;
        topId = catId;
      }
    }

    if (topCount >= 3 && topCount / total > 0.6) {
      const displayVendor = transactions.find((t) => t.vendor.toLowerCase() === vendor)?.vendor || vendor;
      const catName = budgetMap.get(topId) || 'this category';

      cards.push({
        id: `vendor-suggest-${vendor}-${topId}`,
        type: 'vendor-suggestion',
        title: 'Smart Category',
        body: `Always categorize "${displayVendor}" as ${catName}?`,
        accent: 'emerald',
        createdAt: new Date().toISOString(),
      });
    }
  }

  return cards;
}

/** 5. Partner activity — one card per day showing the total the
 *  partner added. Re-shows the next day (or sooner if the total
 *  changes by a meaningful amount). */
export function generatePartnerActivityCards(
  transactions: Transaction[],
  currentUserId: string | undefined,
  partnerName: string | undefined,
): SmartCard[] {
  if (!currentUserId || !partnerName) return [];

  const todayStr = getLocalToday();

  let total = 0;
  let count = 0;
  for (const tx of transactions) {
    if (tx.user_id === currentUserId) continue;
    if (tx.is_projected) continue;
    if (tx.date !== todayStr) continue;
    total += Math.abs(tx.amount);
    count += 1;
  }

  if (count === 0) return [];

  return [
    {
      id: `partner-total-${todayStr}`,
      type: 'partner-total',
      title: 'Partner Activity',
      body: count === 1
        ? `${partnerName} added $${total.toFixed(2)} today.`
        : `${partnerName} added $${total.toFixed(2)} across ${count} transactions today.`,
      accent: 'blue',
      createdAt: new Date().toISOString(),
    },
  ];
}

// ── Aggregate all cards, filter dismissed ────────────────────────

export function collectSmartCards(
  budgets: BudgetCategory[],
  transactions: Transaction[],
  allTransactionsIncludingProjected: Transaction[],
  currentUserId: string | undefined,
  partnerName: string | undefined,
): SmartCard[] {
  const dismissed = getDismissedCards();

  const all = [
    ...generateOverspendCards(budgets, transactions),
    ...generateInsightCards(budgets, transactions),
    ...generateUpcomingBillCards(allTransactionsIncludingProjected, budgets),
    ...generateVendorSuggestionCards(transactions, budgets),
    ...generatePartnerActivityCards(transactions, currentUserId, partnerName),
  ];

  return all.filter((c) => !isDismissed(c, dismissed));
}
