import React, { useState } from 'react';
import type { BudgetCategory, Transaction } from '../../../types';

interface BudgetSummary {
  name: string;
  limit: number;
  spent: number;
}

interface TransactionSummary {
  vendor: string;
  amount: number;
  date: string;
  category: string;
}

interface ReportSectionProps {
  budgets: BudgetCategory[];
  transactions: Transaction[];
  userName?: string;
  totalIncome?: number;
}

// ── SVG icon paths for each budget category (inline-friendly) ──

function getBudgetIconSvg(name: string): string {
  const lower = name.toLowerCase();
  const attrs = `width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;

  if (lower.includes('housing'))
    return `<svg ${attrs}><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>`;
  if (lower.includes('groceries'))
    return `<svg ${attrs}><path d="M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37L2.27 21.7z"/><path d="M18.4 5.6 19.1 3.5"/><path d="M17 10.4 18.4 11.8"/><path d="M13.6 17 15 18.4"/><path d="M18.4 5.6 20.5 4.9"/><path d="M18.4 5.6 19.8 7"/></svg>`;
  if (lower.includes('transport'))
    return `<svg ${attrs}><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 13.1V16c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`;
  if (lower.includes('dining') || lower.includes('leisure'))
    return `<svg ${attrs}><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`;
  if (lower.includes('utilities'))
    return `<svg ${attrs}><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>`;
  if (lower.includes('services'))
    return `<svg ${attrs}><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>`;
  return `<svg ${attrs}><path d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"/></svg>`;
}

// ── Category color palette matching the app ──

const CATEGORY_COLORS: Record<string, string> = {
  Housing: '#0d9488',
  Groceries: '#059669',
  Transport: '#10b981',
  Utilities: '#34d399',
  Leisure: '#1EA078',
  Services: '#047857',
  Other: '#6ee7b7',
};
const FALLBACK_COLORS = ['#0d9488', '#059669', '#10b981', '#34d399', '#1EA078', '#047857', '#6ee7b7'];

function getCategoryColor(name: string, index: number): string {
  return CATEGORY_COLORS[name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  /** Build a plain-text fallback for email body. */
  const buildPlainTextReport = (
    budgetSummary: BudgetSummary[],
    transactionList: TransactionSummary[],
    income: number,
  ): string => {
    const now = new Date();
    const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const title = userName ? `${userName}'s Budget Report` : 'Your Budget Report';

    const totalSpent = budgetSummary.reduce((sum, b) => sum + b.spent, 0);
    const totalBudget = budgetSummary.reduce((sum, b) => sum + b.limit, 0);
    const remaining = income > 0 ? income - totalSpent : totalBudget - totalSpent;

    let text = `COVAULT — ${title}\n${monthYear}\n`;
    text += `${'─'.repeat(40)}\n\n`;

    text += `OVERVIEW\n`;
    text += `  Spent:     $${totalSpent.toFixed(2)}\n`;
    text += `  Budget:    $${totalBudget.toFixed(2)}\n`;
    text += `  Remaining: $${remaining.toFixed(2)}\n\n`;

    text += `BUDGET BREAKDOWN\n`;
    text += `${'─'.repeat(40)}\n`;
    for (const b of budgetSummary) {
      const pct = b.limit > 0 ? Math.round((b.spent / b.limit) * 100) : 0;
      const rem = b.limit - b.spent;
      const status = pct >= 100 ? 'OVER' : pct >= 75 ? 'CAUTION' : 'OK';
      text += `  ${b.name}: $${b.spent.toFixed(2)} / $${b.limit.toFixed(2)} (${pct}%) [${status}] — $${rem.toFixed(2)} left\n`;
    }

    if (transactionList.length > 0) {
      text += `\nRECENT TRANSACTIONS (${transactionList.length} total)\n`;
      text += `${'─'.repeat(40)}\n`;
      const sorted = [...transactionList].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      );
      const display = sorted.slice(0, 30);
      for (const tx of display) {
        const d = new Date(tx.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        text += `  ${d}  ${tx.vendor}  $${tx.amount.toFixed(2)}  (${tx.category})\n`;
      }
      if (transactionList.length > 30) {
        text += `  ... and ${transactionList.length - 30} more\n`;
      }
    }

    text += `\n${'─'.repeat(40)}\nGenerated by Covault — Budget Tracking Made Simple`;

    return text;
  };

  /** Build a beautiful HTML report page matching Covault's UX. */
  const buildHtmlReport = (
    budgetSummary: BudgetSummary[],
    transactionList: TransactionSummary[],
    income: number,
    mailtoUrl: string,
  ): string => {
    const now = new Date();
    const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const title = userName ? `${escapeHtml(userName)}'s Budget Report` : 'Your Budget Report';

    const totalSpent = budgetSummary.reduce((sum, b) => sum + b.spent, 0);
    const totalBudget = budgetSummary.reduce((sum, b) => sum + b.limit, 0);
    const overallPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
    const remaining = income > 0 ? income - totalSpent : totalBudget - totalSpent;

    const fmtCurrency = (n: number) =>
      '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtShort = (n: number) =>
      '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

    // ── Budget category cards ──
    const budgetCardsHtml = budgetSummary
      .map((b, i) => {
        const pct = b.limit > 0 ? Math.round((b.spent / b.limit) * 100) : 0;
        const rem = b.limit - b.spent;
        const color = getCategoryColor(b.name, i);
        const progressW = Math.min(pct, 100);
        const statusColor = pct >= 100 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#10b981';
        const statusLabel = pct >= 100 ? 'OVER' : pct >= 75 ? 'CAUTION' : 'ON TRACK';
        const barColor = pct >= 100 ? '#ef4444' : color;
        const icon = getBudgetIconSvg(b.name);

        return `
          <div style="background:#f8fafc;border-radius:20px;padding:18px 20px;margin-bottom:10px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
              <div style="display:flex;align-items:center;gap:10px">
                <div style="width:36px;height:36px;border-radius:12px;background:${color}15;display:flex;align-items:center;justify-content:center;color:${color}">
                  ${icon}
                </div>
                <span style="font-size:14px;font-weight:800;color:#1e293b;text-transform:uppercase;letter-spacing:0.02em">${escapeHtml(b.name)}</span>
              </div>
              <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:9px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${statusColor};background:${statusColor}15">${statusLabel}</span>
            </div>
            <div style="background:#e2e8f0;border-radius:8px;height:8px;overflow:hidden;margin-bottom:10px">
              <div style="width:${progressW}%;height:100%;border-radius:8px;background:${barColor};transition:width 0.6s"></div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:13px;color:#64748b"><strong style="color:#1e293b;font-weight:800">${fmtCurrency(b.spent)}</strong> of ${fmtCurrency(b.limit)}</span>
              <span style="font-size:13px;font-weight:800;color:${rem < 0 ? '#ef4444' : '#10b981'}">${rem < 0 ? '-' : ''}${fmtCurrency(rem)} left</span>
            </div>
          </div>`;
      })
      .join('');

    // ── Transaction rows styled like Covault TransactionItem ──
    const sortedTxs = [...transactionList].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const displayTxs = sortedTxs.slice(0, 30);

    const txRowsHtml = displayTxs
      .map((tx) => {
        const txDate = new Date(tx.date);
        const dateLabel = txDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const catColor = getCategoryColor(tx.category, 0);
        const icon = getBudgetIconSvg(tx.category);

        return `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;background:#ffffff;border:1px solid #f1f5f9;border-radius:20px;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:12px;min-width:0;flex:1">
              <div style="width:34px;height:34px;min-width:34px;border-radius:10px;background:${catColor}10;display:flex;align-items:center;justify-content:center;color:${catColor}">
                ${icon}
              </div>
              <div style="min-width:0">
                <div style="font-size:13px;font-weight:800;color:#1e293b;text-transform:uppercase;letter-spacing:0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(tx.vendor)}</div>
                <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
                  <span style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.02em">${dateLabel}</span>
                  <span style="font-size:9px;font-weight:700;color:${catColor};background:${catColor}12;padding:2px 7px;border-radius:6px;text-transform:uppercase;letter-spacing:0.06em">${escapeHtml(tx.category)}</span>
                </div>
              </div>
            </div>
            <div style="font-size:16px;font-weight:800;color:#1e293b;letter-spacing:-0.02em;white-space:nowrap;padding-left:12px">${fmtCurrency(tx.amount)}</div>
          </div>`;
      })
      .join('');

    const txCountNote =
      transactionList.length > 30
        ? `<div style="text-align:center;padding:10px 0 0"><span style="font-size:11px;color:#94a3b8;font-weight:600">Showing 30 of ${transactionList.length} transactions</span></div>`
        : '';

    // ── Overall progress bar color ──
    const overallBarColor =
      overallPct >= 100 ? '#ef4444' : overallPct >= 75 ? '#f59e0b' : '#10b981';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Covault — ${title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f1f5f9;
      color: #334155;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    @media print {
      .action-bar { display: none !important; }
      body { background: #fff; }
      .report-container { padding: 0 !important; max-width: 100% !important; }
    }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes barGrow {
      from { width: 0%; }
    }
    .card {
      background: #ffffff;
      border-radius: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03);
      margin-bottom: 14px;
      animation: fadeInUp 0.5s ease both;
    }
    .card:nth-child(2) { animation-delay: 0.05s; }
    .card:nth-child(3) { animation-delay: 0.1s; }
    .card:nth-child(4) { animation-delay: 0.15s; }
    .card:nth-child(5) { animation-delay: 0.2s; }
  </style>
</head>
<body>

  <!-- Floating action bar -->
  <div class="action-bar" style="position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(255,255,255,0.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid #e2e8f0;padding:12px 20px;display:flex;align-items:center;justify-content:space-between">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="background:linear-gradient(135deg,#059669,#10b981);border-radius:10px;padding:5px 11px">
        <span style="font-size:10px;font-weight:900;letter-spacing:0.18em;color:#fff">COVAULT</span>
      </div>
      <span style="font-size:12px;font-weight:600;color:#94a3b8">${monthYear} Report</span>
    </div>
    <div style="display:flex;gap:8px">
      <a href="${escapeHtml(mailtoUrl)}" style="display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border-radius:14px;font-size:11px;font-weight:800;text-decoration:none;text-transform:uppercase;letter-spacing:0.08em;box-shadow:0 2px 8px rgba(16,185,129,0.3);transition:transform 0.15s" onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        Email Report
      </a>
      <button onclick="window.print()" style="display:inline-flex;align-items:center;gap:6px;padding:8px 18px;background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;border-radius:14px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;cursor:pointer;font-family:inherit;transition:transform 0.15s" onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        Print
      </button>
    </div>
  </div>

  <div class="report-container" style="max-width:540px;margin:0 auto;padding:72px 16px 40px">

    <!-- ═══ Header ═══ -->
    <div class="card" style="background:linear-gradient(135deg,#059669 0%,#10b981 50%,#34d399 100%);overflow:hidden;padding:36px 28px;text-align:center;position:relative">
      <div style="position:absolute;top:-40px;right:-40px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,0.08)"></div>
      <div style="position:absolute;bottom:-30px;left:-30px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,0.06)"></div>
      <div style="display:inline-block;background:rgba(255,255,255,0.2);border-radius:12px;padding:5px 14px;margin-bottom:14px;backdrop-filter:blur(8px)">
        <span style="font-size:10px;font-weight:900;letter-spacing:0.22em;text-transform:uppercase;color:#fff">COVAULT</span>
      </div>
      <h1 style="color:#fff;font-size:24px;font-weight:900;letter-spacing:-0.02em;margin:8px 0 6px">${title}</h1>
      <p style="color:#d1fae5;font-size:13px;font-weight:500">${monthYear} &middot; ${dateStr}</p>
    </div>

    <!-- ═══ Overview Summary ═══ -->
    <div class="card" style="padding:24px 20px">
      <div style="display:flex;justify-content:space-around;text-align:center;margin-bottom:18px">
        <div>
          <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8;margin-bottom:6px">Spent</div>
          <div style="font-size:26px;font-weight:900;color:#1e293b;letter-spacing:-0.03em">${fmtShort(totalSpent)}</div>
        </div>
        <div style="width:1px;background:#f1f5f9"></div>
        <div>
          <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8;margin-bottom:6px">Budget</div>
          <div style="font-size:26px;font-weight:900;color:#1e293b;letter-spacing:-0.03em">${fmtShort(totalBudget)}</div>
        </div>
        <div style="width:1px;background:#f1f5f9"></div>
        <div>
          <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8;margin-bottom:6px">Remaining</div>
          <div style="font-size:26px;font-weight:900;color:${remaining < 0 ? '#ef4444' : '#10b981'};letter-spacing:-0.03em">${remaining < 0 ? '-' : ''}${fmtShort(remaining)}</div>
        </div>
      </div>
      <div style="background:#e2e8f0;border-radius:10px;height:10px;overflow:hidden">
        <div style="width:${Math.min(overallPct, 100)}%;height:100%;border-radius:10px;background:${overallBarColor};animation:barGrow 0.8s cubic-bezier(0.4,0,0.2,1) both"></div>
      </div>
      <div style="text-align:center;margin-top:8px;font-size:11px;color:#94a3b8;font-weight:700">${overallPct}% of total budget used</div>
    </div>

    <!-- ═══ Budget Breakdown ═══ -->
    <div class="card" style="padding:22px 18px 14px">
      <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.2em;color:#94a3b8;margin-bottom:14px;padding:0 4px">Budget Breakdown</div>
      ${budgetCardsHtml}
    </div>

    <!-- ═══ Recent Transactions ═══ -->
    ${transactionList.length > 0 ? `
    <div class="card" style="padding:22px 14px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;padding:0 6px">
        <span style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.2em;color:#94a3b8">Recent Transactions</span>
        <span style="font-size:11px;font-weight:700;color:#cbd5e1">${transactionList.length} total</span>
      </div>
      ${txRowsHtml}
      ${txCountNote}
    </div>` : ''}

    <!-- ═══ Footer ═══ -->
    <div style="text-align:center;padding:20px 0 12px;animation:fadeInUp 0.5s ease 0.25s both">
      <div style="display:inline-block;background:rgba(16,185,129,0.1);border-radius:14px;padding:5px 14px;margin-bottom:8px">
        <span style="font-size:10px;font-weight:900;letter-spacing:0.18em;text-transform:uppercase;color:#10b981">COVAULT</span>
      </div>
      <p style="font-size:11px;color:#94a3b8;font-weight:500;line-height:1.5">Budget Tracking Made Simple</p>
    </div>

  </div>
</body>
</html>`;
  };

  const handleGenerateReport = () => {
    const budgetSummary = buildBudgetSummary();
    const transactionList = buildTransactionList();
    const income = totalIncome ?? 0;

    const now = new Date();
    const subject = `Covault Budget Report – ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    const body = buildPlainTextReport(budgetSummary, transactionList, income);

    // Build mailto URL for the action-bar email button inside the report
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    // Build the full visual HTML report
    const html = buildHtmlReport(budgetSummary, transactionList, income, mailtoUrl);

    // Open the report in a new tab/window
    const reportWindow = window.open('', '_blank');
    if (reportWindow) {
      reportWindow.document.write(html);
      reportWindow.document.close();
    } else {
      // Fallback: if popup was blocked, open mailto directly
      window.open(mailtoUrl, '_blank');
    }

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
          Generate a visual report you can email, print, or save as PDF.
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
          ✓ Report opened
        </div>
      )}
    </div>
  );
};

export default ReportSection;
