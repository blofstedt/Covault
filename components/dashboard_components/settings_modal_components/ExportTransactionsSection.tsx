import React, { useState, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { Transaction, BudgetCategory } from '../../../types';

interface ExportTransactionsSectionProps {
  transactions: Transaction[];
  budgets: BudgetCategory[];
}

const ExportTransactionsSection: React.FC<ExportTransactionsSectionProps> = ({
  transactions,
  budgets,
}) => {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [exported, setExported] = useState(false);

  const handleExport = async () => {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T23:59:59');

    const filtered = transactions.filter((tx) => {
      const [y, m, d] = tx.date.slice(0, 10).split('-').map(Number);
      const txDate = new Date(y, m - 1, d);
      return txDate >= start && txDate <= end && !tx.is_projected;
    });

    if (filtered.length === 0) {
      return;
    }

    // Sort by date ascending
    filtered.sort(
      (a, b) => {
        const [ay, am, ad] = a.date.slice(0, 10).split('-').map(Number);
        const [by, bm, bd] = b.date.slice(0, 10).split('-').map(Number);
        return new Date(ay, am - 1, ad).getTime() - new Date(by, bm - 1, bd).getTime();
      },
    );

    const escapeCSV = (value: string): string => {
      if (
        value.includes(',') ||
        value.includes('"') ||
        value.includes('\n')
      ) {
        return '"' + value.replace(/"/g, '""') + '"';
      }
      return value;
    };

    const budgetMap = new Map(budgets.map((b) => [b.id, b.name]));

    const headers = ['Date', 'Vendor', 'Amount', 'Category', 'Recurrence', 'Label'];
    const rows = filtered.map((tx) => [
      escapeCSV((() => { const [y, m, d] = tx.date.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(); })()),
      escapeCSV(tx.vendor),
      escapeCSV(tx.amount.toFixed(2)),
      escapeCSV(tx.budget_id ? (budgetMap.get(tx.budget_id) || tx.budget_id) : ''),
      escapeCSV(tx.recurrence || 'One-time'),
      escapeCSV(tx.label || ''),
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join(
      '\r\n',
    );

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const fileName = `covault-transactions-${startDate}-to-${endDate}.csv`;

    // On native platforms, save the CSV directly to the Documents folder so
    // the user can find it in their device's file manager without going
    // through the share sheet.  Falls back to the cache + share approach
    // if the direct write fails (e.g. on devices where Documents is
    // unavailable).
    if (Capacitor.isNativePlatform()) {
      try {
        await Filesystem.writeFile({
          path: fileName,
          data: csvContent,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
      } catch (docErr) {
        // Directory.Documents may not be available on all devices – fall
        // back to writing to Cache and opening the system share sheet.
        console.warn('[ExportCSV] Documents write failed, falling back to share:', docErr);
        try {
          await Filesystem.writeFile({
            path: fileName,
            data: csvContent,
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
          });

          const uriResult = await Filesystem.getUri({
            path: fileName,
            directory: Directory.Cache,
          });

          await Share.share({
            title: 'Covault Transactions',
            files: [uriResult.uri],
            dialogTitle: 'Save or share CSV',
          });
        } catch (shareErr) {
          // User cancelled share or an unexpected error
          console.warn('[ExportCSV] Share fallback failed:', shareErr);
        }
      }
      setExported(true);
      setTimeout(() => setExported(false), 2000);
      return;
    }

    // Fallback: standard blob download for desktop/web browsers
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setExported(true);
    setTimeout(() => setExported(false), 2000);
  };

  const filteredCount = useMemo(() => {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T23:59:59');
    return transactions.filter((tx) => {
      const [y, m, d] = tx.date.slice(0, 10).split('-').map(Number);
      const txDate = new Date(y, m - 1, d);
      return txDate >= start && txDate <= end && !tx.is_projected;
    }).length;
  }, [transactions, startDate, endDate]);

  return (
    <div id="settings-export-container" className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-black text-slate-800 dark:text-slate-100 uppercase tracking-[0.2em]">
          Export Transactions
        </span>
      </div>
      <span className="text-[11px] text-slate-400 dark:text-slate-500 block mb-4">
        Download a CSV report for a date range.
      </span>

      <div className="flex gap-3 mb-4">
        <div className="flex-1">
          <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-1">
            From
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>
        <div className="flex-1">
          <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-1">
            To
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
        </div>
      </div>

      <button
        onClick={handleExport}
        disabled={filteredCount === 0}
        className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-xs font-black uppercase tracking-[0.15em] transition-all active:scale-[0.97] ${
          exported
            ? 'bg-emerald-500 text-white'
            : filteredCount === 0
              ? 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'
              : 'bg-emerald-50 dark:bg-emerald-900/20 border-2 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
        }`}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {exported ? (
            <path d="M20 6L9 17l-5-5" />
          ) : (
            <>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </>
          )}
        </svg>
        {exported
          ? 'Downloaded!'
          : filteredCount === 0
            ? 'No Transactions'
            : `Export ${filteredCount} Transaction${filteredCount !== 1 ? 's' : ''}`}
      </button>
    </div>
  );
};

export default ExportTransactionsSection;
