import React, { useState } from 'react';
import type { BudgetCategory, Transaction } from '../../../types';
import { buildHtmlReport } from '../../../lib/reportEmailSender';
import type { BudgetSummary, TransactionSummary } from '../../../lib/reportEmailSender';

interface ReportSectionProps {
  budgets: BudgetCategory[];
  transactions: Transaction[];
  userName?: string;
  totalIncome?: number;
}

const ReportSection: React.FC<ReportSectionProps> = ({
  budgets,
  transactions,
  userName,
  totalIncome,
}) => {
  const [reportOpened, setReportOpened] = useState(false);

  /** Build a budget summary from current budgets + transactions for the report. */
  const buildBudgetSummary = (): BudgetSummary[] => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    return budgets.map((b) => {
      const spent = transactions
        .filter((tx) => {
          if (tx.is_projected) return false;
          if (tx.budget_id !== b.id) return false;
          const txDate = new Date(tx.date);
          return txDate.getMonth() === currentMonth && txDate.getFullYear() === currentYear;
        })
        .reduce((sum, tx) => sum + tx.amount, 0);

      return { name: b.name, limit: b.totalLimit, spent };
    });
  };

  /** Build a transaction list for the current month for the report. */
  const buildTransactionList = (): TransactionSummary[] => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const budgetNameById = new Map(budgets.map((b) => [b.id, b.name]));

    return transactions
      .filter((tx) => {
        if (tx.is_projected) return false;
        const txDate = new Date(tx.date);
        return txDate.getMonth() === currentMonth && txDate.getFullYear() === currentYear;
      })
      .map((tx) => ({
        vendor: tx.vendor,
        amount: tx.amount,
        date: tx.date,
        category: tx.budget_id ? budgetNameById.get(tx.budget_id) || 'Other' : 'Other',
      }));
  };

  const handleGenerateReport = () => {
    const html = buildHtmlReport(
      buildBudgetSummary(),
      buildTransactionList(),
      totalIncome ?? 0,
      userName,
    );

    const now = new Date();
    const subject = `Covault Budget Report – ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;

    // Build a Gmail compose URL with the report as the email body
    const gmailUrl =
      `https://mail.google.com/mail/?view=cm&fs=1` +
      `&su=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(html)}`;

    window.open(gmailUrl, '_blank');

    setReportOpened(true);
    setTimeout(() => setReportOpened(false), 2500);
  };

  return (
    <div id="settings-reports-container" className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
      <div className="flex flex-col mb-3">
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Budget Report
        </span>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
          Generate a visual report and open it in Gmail to send.
        </p>
      </div>

      <button
        onClick={handleGenerateReport}
        className="w-full py-3 rounded-2xl border-2 border-dashed border-emerald-300 dark:border-emerald-700 text-emerald-500 dark:text-emerald-400 text-[11px] font-black uppercase tracking-[0.15em] hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors active:scale-[0.98] flex items-center justify-center gap-1.5"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={3}
          strokeLinecap="round"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Generate Report
      </button>

      {reportOpened && (
        <div className="mt-2 py-2 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-wider text-center animate-in fade-in duration-300">
          ✓ Report opened in Gmail
        </div>
      )}
    </div>
  );
};

export default ReportSection;
