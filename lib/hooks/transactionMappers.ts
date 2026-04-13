// lib/hooks/transactionMappers.ts
import { useCallback } from 'react';
import type { Transaction } from '../../types';
import { Recurrence } from '../../types';
import { SYSTEM_CATEGORIES } from '../../constants';

// Valid recurrence values that must match the database CHECK constraint
const VALID_RECURRENCES = [
  Recurrence.ONE_TIME,
  Recurrence.BIWEEKLY,
  Recurrence.MONTHLY,
];

const normalizeBudgetName = (value: string) => value.trim().toLowerCase();

const toLocalIsoDay = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toIsoDay = (value: unknown): string => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

export const shouldSolidifyProjectedTransaction = (
  isProjected: boolean,
  transactionDate: unknown,
  now: Date = new Date(),
) => {
  if (!isProjected) return false;
  const txIsoDay = toIsoDay(transactionDate);
  if (!txIsoDay) return false;
  return txIsoDay <= toLocalIsoDay(now);
};

const systemCategoryIdByName = new Map(
  SYSTEM_CATEGORIES.map(category => [normalizeBudgetName(category.name), category.id]),
);

export const resolveBudgetNameForInsert = (
  budgetId: string | null,
  budgets: { id: string; name: string }[] = [],
): string => {
  if (!budgetId) {
    throw new Error(`Transaction must have a valid budget_id (category_id). Got: ${budgetId}`);
  }

  const directIdMatch = budgets.find(b => b.id === budgetId);
  if (directIdMatch?.name) return directIdMatch.name;

  const normalizedInput = normalizeBudgetName(budgetId);
  const nameMatch = budgets.find(b => normalizeBudgetName(b.name) === normalizedInput);
  if (nameMatch?.name) return nameMatch.name;

  if (budgetId.startsWith('budget:')) {
    const fromPrefixedId = budgetId.slice('budget:'.length).replace(/-/g, ' ');
    const prefixedMatch = budgets.find(
      b => normalizeBudgetName(b.name) === normalizeBudgetName(fromPrefixedId),
    );
    if (prefixedMatch?.name) return prefixedMatch.name;
  }

  throw new Error(
    `Cannot map budget_id "${budgetId}" to a valid budget name for transactions.budget`,
  );
};

export const resolveBudgetIdFromRow = (row: any): string | null => {
  const budgetRaw = row.Budget || row.budget;
  if (budgetRaw) {
    const budgetName = String(budgetRaw);
    const normalizedName = normalizeBudgetName(budgetName);
    const systemId = systemCategoryIdByName.get(normalizedName);
    if (systemId) return systemId;

    return `budget:${normalizedName.replace(/\s+/g, '-')}`;
  }

  return null;
};

// Build the object Supabase expects — only columns that exist in the table
export const toSupabaseTransaction = (
  tx: Transaction,
  budgets: { id: string; name: string }[] = [],
) => {
  // Extract the YYYY-MM-DD portion directly from the date string to avoid
  // timezone-related date shifts that occur when round-tripping through the
  // Date constructor (e.g. "2025-03-01T00:00:00Z" parsed in UTC-8 becomes
  // Feb 28 locally).
  const dateStr = tx.date.slice(0, 10);

  // Validate required fields
  if (!tx.budget_id) {
    throw new Error(`Transaction must have a valid budget_id (category_id). Got: ${tx.budget_id}`);
  }

  // Validate and set recurrence value
  let recurrence: string = Recurrence.ONE_TIME;
  if (tx.recurrence) {
    if (VALID_RECURRENCES.includes(tx.recurrence as Recurrence)) {
      recurrence = tx.recurrence;
    } else {
      console.warn(`Invalid recurrence value "${tx.recurrence}", defaulting to "${Recurrence.ONE_TIME}"`);
    }
  }

  const budgetName = resolveBudgetNameForInsert(tx.budget_id, budgets);

  const row: Record<string, any> = {
    id: tx.id,
    user_id: tx.user_id,
    vendor: tx.vendor,
    amount: Number(tx.amount),
    date: dateStr,
    is_projected: tx.is_projected ?? false,
    // Current schema columns (public.transactions)
    // type enum only has 'Manual' and 'Automatic' — map AI/Automatic labels to 'Automatic'
    budget: budgetName,
    type: tx.label === 'Automatic' ? 'Automatic' : 'Manual',
    recur: recurrence,
  };

  return row;
};

export const useToSupabaseTransaction = (budgets: { id: string; name: string }[] = []) =>
  useCallback((tx: Transaction) => toSupabaseTransaction(tx, budgets), [budgets]);

// Convert Supabase transaction to app format
export const useFromSupabaseTransaction = () =>
  useCallback((row: any): Transaction => {
    // Validate recurrence value from database (supports recur or recurrence)
    let recurrence: Recurrence = Recurrence.ONE_TIME;
    const recurrenceRaw = row.recur || row.recurrence;
    if (recurrenceRaw) {
      if (VALID_RECURRENCES.includes(recurrenceRaw as Recurrence)) {
        recurrence = recurrenceRaw as Recurrence;
      } else {
        console.warn(`Invalid recurrence value "${recurrenceRaw}" from database, using "${Recurrence.ONE_TIME}"`);
      }
    }

    const shouldSolidify = shouldSolidifyProjectedTransaction(row.is_projected, row.date);

    return {
      id: row.id,
      user_id: row.user_id,
      vendor: row.vendor,
      amount: parseFloat(row.amount),
      // Keep date as a YYYY-MM-DD string (with a noon-UTC timestamp appended so
      // that slicing to 10 chars always yields the correct calendar date regardless
      // of the user's timezone).
      date: typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
        ? row.date + 'T12:00:00.000Z'
        : new Date(row.date).toISOString(),
      budget_id: resolveBudgetIdFromRow(row),
      recurrence: recurrence,
      // Map DB type enum ('Automatic'|'Manual') to app-level label.
      label: row.type === 'Automatic' ? 'Automatic' : 'Manual',
      is_projected: shouldSolidify ? false : row.is_projected,
      is_income: row.is_income === true,
      caught_cleared: row.caught_cleared === true,
      userName: row.user_name || '',
      created_at: row.created_at,
    };
  }, []);
