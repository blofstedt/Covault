// lib/smartCards.ts
// Generates smart notification cards for the swipeable deck.
// Cards are ephemeral — dismissed IDs are tracked in localStorage
// so the same card never reappears until a new event triggers it.

import type { Transaction, BudgetCategory } from '../types';
import { getLocalToday } from './dateUtils';

export type SmartCardType =
  | 'overspend'
  | 'insight'
  | 'upcoming-bill'
  | 'vendor-suggestion'
  | 'partner-activity';

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

const DISMISSED_KEY = 'covault_dismissed_cards';

function getDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore corrupt data */ }
  return new Set();
}

export function dismissCard(id: string): void {
  const dismissed = getDismissedIds();
  dismissed.add(id);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]));
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

/** 1. Budget overspend alerts: fires when a category ≥ 80% or ≥ 100% */
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
        id: `overspend-100-${b.id}-${mk}`,
        type: 'overspend',
        title: `${b.name} Over Budget`,
        body: `You've spent $${spent.toFixed(0)} of your $${b.totalLimit.toFixed(0)} ${b.name} budget this month.`,
        accent: 'rose',
        createdAt: new Date().toISOString(),
      });
    } else if (pct >= 0.8) {
      cards.push({
        id: `overspend-80-${b.id}-${mk}`,
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

/** 2. Month-over-month insight card */
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

/** 3. Upcoming bills (recurring transactions due within 3 days) */
/**
 * Calculate the next occurrence date of a recurring transaction on or after `from`.
 * Returns null if it can never recur.
 */
function nextOccurrence(txDate: string, recurrence: string, from: Date): Date | null {
  const rec = recurrence.toLowerCase();
  if (rec === 'one-time' || !rec) return null;

  const baseStr = txDate.slice(0, 10);
  const parts = baseStr.split('-');
  if (parts.length < 3) return null;
  const base = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  if (isNaN(base.getTime())) return null;

  // If the base date itself is in the future, it's the next occurrence
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
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 3);

  const budgetMap = new Map(budgets.map((b) => [b.id, b.name]));
  const cards: SmartCard[] = [];

  for (const tx of transactions) {
    const rec = ((tx as any).recur ?? tx.recurrence ?? '').toString().toLowerCase();
    if (rec === 'one-time' || !rec) continue;

    const dueDate = nextOccurrence(tx.date, rec, now);
    if (!dueDate || dueDate > horizon) continue;

    const daysAway = Math.round((dueDate.getTime() - now.getTime()) / 86400000);
    const when = daysAway === 0 ? 'today' : daysAway === 1 ? 'tomorrow' : `in ${daysAway} days`;
    const category = tx.budget_id ? budgetMap.get(tx.budget_id) : undefined;
    const dueDateStr = `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, '0')}-${String(dueDate.getDate()).padStart(2, '0')}`;

    cards.push({
      id: `bill-${tx.id}-${dueDateStr}`,
      type: 'upcoming-bill',
      title: 'Upcoming Payment',
      body: `$${Math.abs(tx.amount).toFixed(2)} to ${tx.vendor}${category ? ` (${category})` : ''} is due ${when}.`,
      accent: 'violet',
      createdAt: new Date().toISOString(),
    });
  }

  return cards;
}

/** 4. Smart vendor categorization suggestion */
export function generateVendorSuggestionCards(
  transactions: Transaction[],
  budgets: BudgetCategory[],
): SmartCard[] {
  // Count how many times a vendor was manually re-categorized
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
    if (cats.size < 2) continue; // Only one category ever used — no conflict

    // Find the dominant category
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

    // Only suggest if there's a clear winner used ≥ 3 times and in > 60% of cases
    if (topCount >= 3 && topCount / total > 0.6) {
      const displayVendor = transactions.find((t) => t.vendor.toLowerCase() === vendor)?.vendor || vendor;
      const catName = budgetMap.get(topId) || 'this category';

      cards.push({
        id: `vendor-suggest-${vendor}-${topId}-${currentMonthKey()}`,
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

/** 5. Partner activity card */
export function generatePartnerActivityCards(
  transactions: Transaction[],
  currentUserId: string | undefined,
  partnerName: string | undefined,
): SmartCard[] {
  if (!currentUserId || !partnerName) return [];

  const mk = currentMonthKey();
  const cards: SmartCard[] = [];

  // Show cards for recent partner transactions (today only)
  const todayStr = getLocalToday();

  for (const tx of transactions) {
    if (tx.user_id === currentUserId) continue; // Skip own transactions
    if (tx.is_projected) continue;
    if (txMonthKey(tx) !== mk) continue;
    if (tx.date !== todayStr) continue;

    cards.push({
      id: `partner-${tx.id}`,
      type: 'partner-activity',
      title: 'Partner Activity',
      body: `${partnerName} added $${Math.abs(tx.amount).toFixed(2)} at ${tx.vendor}.`,
      accent: 'blue',
      createdAt: tx.created_at || new Date().toISOString(),
    });
  }

  return cards;
}

// ── Aggregate all cards, filter dismissed ────────────────────────

export function collectSmartCards(
  budgets: BudgetCategory[],
  transactions: Transaction[],
  allTransactionsIncludingProjected: Transaction[],
  currentUserId: string | undefined,
  partnerName: string | undefined,
): SmartCard[] {
  const dismissed = getDismissedIds();

  const all = [
    ...generateOverspendCards(budgets, transactions),
    ...generateInsightCards(budgets, transactions),
    ...generateUpcomingBillCards(allTransactionsIncludingProjected, budgets),
    ...generateVendorSuggestionCards(transactions, budgets),
    ...generatePartnerActivityCards(transactions, currentUserId, partnerName),
  ];

  return all.filter((c) => !dismissed.has(c.id));
}
