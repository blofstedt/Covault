// lib/scheduledReportRunner.ts
// Client-side runner that checks whether any scheduled reports are due and
// sends them via the send-report edge function.
//
// Because Covault stores scheduled reports in localStorage (not in a server-
// side cron), this runner is evaluated each time the app loads.  It compares
// the current date against each report's schedule and `lastSentAt` timestamp
// to decide whether a report should fire.

import type { ScheduledReport, BudgetCategory, Transaction } from '../types';
import { supabase } from './supabase';

/** Build a budget summary suitable for the send-report edge function. */
function buildBudgetSummary(
  budgets: BudgetCategory[],
  transactions: Transaction[],
) {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  return budgets.map((b) => {
    const spent = transactions
      .filter((tx) => {
        if (tx.is_projected) return false;
        if (tx.budget_id !== b.id) return false;
        const txDate = new Date(tx.date);
        return (
          txDate.getMonth() === currentMonth &&
          txDate.getFullYear() === currentYear
        );
      })
      .reduce((sum, tx) => sum + tx.amount, 0);

    return { name: b.name, limit: b.totalLimit, spent };
  });
}

/**
 * Determine whether `report` is due to be sent right now.
 *
 * Monthly reports fire on (or after) their configured dayOfMonth each
 * calendar month, provided they haven't already been sent this month.
 *
 * Yearly reports fire on (or after) their configured month + dayOfMonth each
 * year, provided they haven't already been sent this year.
 */
export function isReportDue(report: ScheduledReport): boolean {
  if (!report.enabled) return false;

  const now = new Date();
  const today = now.getDate();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  if (report.frequency === 'monthly') {
    // Is today on or past the scheduled day?
    if (today < report.dayOfMonth) return false;

    // Has it already been sent this month?
    if (report.lastSentAt) {
      const last = new Date(report.lastSentAt);
      if (
        last.getMonth() === currentMonth &&
        last.getFullYear() === currentYear
      ) {
        return false;
      }
    }
    return true;
  }

  if (report.frequency === 'yearly') {
    const scheduledMonth = report.month ?? 0;
    // Not yet reached the scheduled month/day this year
    if (
      currentMonth < scheduledMonth ||
      (currentMonth === scheduledMonth && today < report.dayOfMonth)
    ) {
      return false;
    }

    // Has it already been sent this year?
    if (report.lastSentAt) {
      const last = new Date(report.lastSentAt);
      if (last.getFullYear() === currentYear) {
        return false;
      }
    }
    return true;
  }

  // one_time reports are handled immediately in the UI builder
  return false;
}

/**
 * Run all scheduled reports that are due and return updated report objects
 * with `lastSentAt` set on success.  The caller is responsible for
 * persisting the updated reports back into app state / localStorage.
 */
export async function runDueReports(
  reports: ScheduledReport[],
  budgets: BudgetCategory[],
  transactions: Transaction[],
  userName?: string,
): Promise<{ updatedReports: ScheduledReport[]; sentCount: number }> {
  const budgetSummary = buildBudgetSummary(budgets, transactions);
  let sentCount = 0;
  const updatedReports = [...reports];

  for (let i = 0; i < updatedReports.length; i++) {
    const report = updatedReports[i];
    if (!isReportDue(report)) continue;

    try {
      const { error } = await supabase.functions.invoke('send-report', {
        body: {
          emails: report.emails,
          budgets: budgetSummary,
          userName,
        },
      });

      if (!error) {
        updatedReports[i] = {
          ...report,
          lastSentAt: new Date().toISOString(),
        };
        sentCount++;
      } else {
        console.error(
          `[scheduledReportRunner] failed to send report ${report.id}:`,
          error,
        );
      }
    } catch (err) {
      console.error(
        `[scheduledReportRunner] exception sending report ${report.id}:`,
        err,
      );
    }
  }

  return { updatedReports, sentCount };
}
