// lib/reportEmailSender.ts
// Client-side report email sender.
//
// Provides two mechanisms to send budget report emails:
//   1. Via Supabase Edge Function (preferred – keeps API key server-side)
//   2. Direct call to the Resend API (fallback – uses VITE_RESEND_API_KEY)
//
// The `sendReportEmail` function tries (1) first, then falls back to (2).

import { supabase } from './supabase';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BudgetSummary {
  name: string;
  limit: number;
  spent: number;
}

export interface TransactionSummary {
  vendor: string;
  amount: number;
  date: string;
  category: string;
}

export interface ReportPayload {
  emails: string[];
  budgets: BudgetSummary[];
  transactions: TransactionSummary[];
  totalIncome: number;
  userName?: string;
}

// ── Colours (match app palette) ────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  Housing: '#0d9488',
  Groceries: '#059669',
  Transport: '#10b981',
  Utilities: '#34d399',
  Leisure: '#1EA078',
  Services: '#047857',
  Other: '#6ee7b7',
};

const FALLBACK_COLORS = [
  '#0d9488', '#059669', '#10b981', '#34d399', '#1EA078', '#047857', '#6ee7b7',
];

function getCategoryColor(name: string, index: number): string {
  return CATEGORY_COLORS[name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── HTML report builder (mirrors edge function) ────────────────────────────────

export function buildHtmlReport(
  budgets: BudgetSummary[],
  transactions: TransactionSummary[],
  totalIncome: number,
  userName?: string,
): string {
  const title = userName
    ? `${escapeHtml(userName)}'s Budget Report`
    : 'Your Budget Report';
  const now = new Date();
  const monthYear = now.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const dateStr = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
  const totalBudget = budgets.reduce((sum, b) => sum + b.limit, 0);
  const overallPct =
    totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  const remaining =
    totalIncome > 0 ? totalIncome - totalSpent : totalBudget - totalSpent;

  // ── SVG budget chart ──
  const barHeight = 32;
  const barGap = 10;
  const chartLeftPad = 90;
  const chartWidth = 440;
  const barAreaWidth = chartWidth - chartLeftPad;
  const chartHeight = budgets.length * (barHeight + barGap) + 10;
  const maxVal = Math.max(
    ...budgets.map((b) => Math.max(b.limit, b.spent)),
    1,
  );

  const svgBars = budgets
    .map((b, i) => {
      const y = i * (barHeight + barGap) + 5;
      const limitW = Math.max(1, (b.limit / maxVal) * barAreaWidth);
      const spentW = Math.max(0, (b.spent / maxVal) * barAreaWidth);
      const pct = b.limit > 0 ? Math.round((b.spent / b.limit) * 100) : 0;
      const color = getCategoryColor(b.name, i);
      const overBudget = b.spent > b.limit;
      return `
        <text x="${chartLeftPad - 8}" y="${y + barHeight / 2 + 4}" text-anchor="end" fill="#64748b" font-size="11" font-weight="600" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">${escapeHtml(b.name)}</text>
        <rect x="${chartLeftPad}" y="${y}" width="${limitW}" height="${barHeight}" rx="8" fill="#e2e8f0"/>
        <rect x="${chartLeftPad}" y="${y}" width="${Math.min(spentW, limitW)}" height="${barHeight}" rx="8" fill="${color}"/>
        ${overBudget ? `<rect x="${chartLeftPad + limitW}" y="${y}" width="${Math.min(spentW - limitW, barAreaWidth - limitW)}" height="${barHeight}" rx="0" fill="#ef4444" opacity="0.7"/>` : ''}
        <text x="${chartLeftPad + Math.max(spentW, limitW) + 8}" y="${y + barHeight / 2 + 4}" fill="${overBudget ? '#ef4444' : '#64748b'}" font-size="11" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">${pct}%</text>`;
    })
    .join('');

  const budgetChart = `<svg width="100%" viewBox="0 0 ${chartWidth} ${chartHeight}" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:0 auto">${svgBars}</svg>`;

  // ── Budget summary cards ──
  const budgetCards = budgets
    .map((b, i) => {
      const pct = b.limit > 0 ? Math.round((b.spent / b.limit) * 100) : 0;
      const rem = b.limit - b.spent;
      const color = getCategoryColor(b.name, i);
      const statusColor =
        pct >= 100 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#10b981';
      const statusLabel =
        pct >= 100 ? 'Over Budget' : pct >= 75 ? 'Caution' : 'On Track';
      const progressW = Math.min(pct, 100);
      return `
        <tr><td style="padding:6px 0">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;border-radius:12px;overflow:hidden">
            <tr><td style="padding:14px 16px">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="vertical-align:middle">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:8px;vertical-align:middle"></span>
                    <span style="font-size:13px;font-weight:700;color:#1e293b;vertical-align:middle">${escapeHtml(b.name)}</span>
                  </td>
                  <td style="text-align:right;vertical-align:middle">
                    <span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:9px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;color:${statusColor};background:${statusColor}15">${statusLabel}</span>
                  </td>
                </tr>
              </table>
              <div style="margin:10px 0 6px;background:#e2e8f0;border-radius:6px;height:6px;overflow:hidden">
                <div style="width:${progressW}%;height:100%;border-radius:6px;background:${pct >= 100 ? '#ef4444' : color}"></div>
              </div>
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-size:12px;color:#64748b"><strong style="color:#1e293b">$${b.spent.toFixed(2)}</strong> of $${b.limit.toFixed(2)}</td>
                  <td style="text-align:right;font-size:12px;font-weight:700;color:${rem < 0 ? '#ef4444' : '#10b981'}">$${rem.toFixed(2)} left</td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>`;
    })
    .join('');

  // ── Transaction list ──
  const sortedTxs = [...transactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  const displayTxs = sortedTxs.slice(0, 30);

  const txRows = displayTxs
    .map((tx) => {
      const txDate = new Date(tx.date);
      const dateLabel = txDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle">
            <div style="font-size:13px;font-weight:600;color:#1e293b;line-height:1.3">${escapeHtml(tx.vendor)}</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:2px">${escapeHtml(tx.category)}</div>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:right;vertical-align:middle;white-space:nowrap">
            <div style="font-size:13px;font-weight:700;color:#1e293b">$${tx.amount.toFixed(2)}</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:2px">${dateLabel}</div>
          </td>
        </tr>`;
    })
    .join('');

  const txSectionHtml =
    transactions.length > 0
      ? `
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="padding:28px 24px 12px">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td><h2 style="margin:0;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8">Recent Transactions</h2></td>
              <td style="text-align:right"><span style="font-size:11px;color:#94a3b8;font-weight:600">${transactions.length} total</span></td>
            </tr>
          </table>
        </td></tr>
      </table>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 8px">
        <tbody>${txRows}</tbody>
      </table>
      ${transactions.length > 30 ? `<div style="text-align:center;padding:8px 24px 16px"><span style="font-size:11px;color:#94a3b8">Showing 30 of ${transactions.length} transactions. Open Covault for full details.</span></div>` : ''}`
      : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#334155;margin:0;padding:0;background:#f1f5f9;-webkit-font-smoothing:antialiased">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">

    <!-- Header Card -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:linear-gradient(135deg,#059669 0%,#10b981 50%,#34d399 100%);border-radius:24px;overflow:hidden;margin-bottom:16px">
      <tr><td style="padding:32px 24px;text-align:center">
        <div style="display:inline-block;background:rgba(255,255,255,0.2);border-radius:12px;padding:6px 14px;margin-bottom:12px">
          <span style="font-size:10px;font-weight:800;letter-spacing:0.2em;text-transform:uppercase;color:#fff">COVAULT</span>
        </div>
        <h1 style="margin:8px 0 4px;color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.01em">${title}</h1>
        <p style="margin:0;color:#d1fae5;font-size:13px;font-weight:500">${monthYear} &middot; ${dateStr}</p>
      </td></tr>
    </table>

    <!-- Overview Summary -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-bottom:16px">
      <tr><td style="padding:20px 24px">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="text-align:center;padding:8px;width:33%">
              <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8;margin-bottom:6px">Spent</div>
              <div style="font-size:22px;font-weight:800;color:#1e293b;letter-spacing:-0.02em">$${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
            </td>
            <td style="text-align:center;padding:8px;width:34%;border-left:1px solid #f1f5f9;border-right:1px solid #f1f5f9">
              <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8;margin-bottom:6px">Budget</div>
              <div style="font-size:22px;font-weight:800;color:#1e293b;letter-spacing:-0.02em">$${totalBudget.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
            </td>
            <td style="text-align:center;padding:8px;width:33%">
              <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8;margin-bottom:6px">Remaining</div>
              <div style="font-size:22px;font-weight:800;color:${remaining < 0 ? '#ef4444' : '#10b981'};letter-spacing:-0.02em">$${remaining.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
            </td>
          </tr>
        </table>
        <!-- Overall progress bar -->
        <div style="margin:16px 0 4px;background:#e2e8f0;border-radius:8px;height:8px;overflow:hidden">
          <div style="width:${Math.min(overallPct, 100)}%;height:100%;border-radius:8px;background:${overallPct >= 100 ? '#ef4444' : overallPct >= 75 ? '#f59e0b' : '#10b981'}"></div>
        </div>
        <div style="text-align:center;font-size:11px;color:#94a3b8;font-weight:600">${overallPct}% of total budget used</div>
      </td></tr>
    </table>

    <!-- Budget Chart -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-bottom:16px">
      <tr><td style="padding:20px 24px 12px">
        <h2 style="margin:0 0 16px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8">Spending Flow</h2>
        ${budgetChart}
      </td></tr>
    </table>

    <!-- Budget Breakdown Cards -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-bottom:16px">
      <tr><td style="padding:20px 24px 14px">
        <h2 style="margin:0 0 8px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8">Budget Breakdown</h2>
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          ${budgetCards}
        </table>
      </td></tr>
    </table>

    <!-- Transactions -->
    ${txSectionHtml ? `
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-bottom:16px">
      ${txSectionHtml}
    </table>` : ''}

    <!-- Footer -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px">
      <tr><td style="text-align:center;padding:16px 24px">
        <div style="display:inline-block;background:rgba(16,185,129,0.1);border-radius:12px;padding:4px 12px;margin-bottom:8px">
          <span style="font-size:10px;font-weight:800;letter-spacing:0.15em;text-transform:uppercase;color:#10b981">COVAULT</span>
        </div>
        <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6">Budget Tracking Made Simple</p>
      </td></tr>
    </table>

  </div>
</body>
</html>`;
}

// ── Direct Resend API call (client-side fallback) ──────────────────────────────

async function sendViaResendDirect(payload: ReportPayload): Promise<void> {
  const apiKey = (import.meta as any).env?.VITE_RESEND_API_KEY as
    | string
    | undefined;

  if (!apiKey) {
    throw new Error(
      'VITE_RESEND_API_KEY is not configured. Add it to your .env file to enable email sending.',
    );
  }

  const senderEmail =
    ((import.meta as any).env?.VITE_SENDER_EMAIL as string | undefined) ||
    'Covault Reports <reports@covault.app>';

  const html = buildHtmlReport(
    payload.budgets,
    payload.transactions,
    payload.totalIncome,
    payload.userName,
  );

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: senderEmail,
      to: payload.emails,
      subject: `Your Covault Budget Report – ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
      html,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as any)?.message || `Resend API error (${res.status})`,
    );
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Send a budget report email.
 *
 * Tries the Supabase Edge Function first (keeps API key server-side).
 * If that fails, falls back to calling the Resend API directly from the
 * client using the VITE_RESEND_API_KEY env var.
 */
export async function sendReportEmail(
  payload: ReportPayload,
): Promise<{ success: boolean; error?: string }> {
  // ── Attempt 1: Supabase Edge Function ──
  try {
    const { error } = await supabase.functions.invoke('send-report', {
      body: payload,
    });
    if (!error) {
      return { success: true };
    }
    console.warn(
      '[reportEmailSender] Edge function failed, trying direct Resend:',
      error,
    );
  } catch (edgeErr) {
    console.warn(
      '[reportEmailSender] Edge function unavailable, trying direct Resend:',
      edgeErr,
    );
  }

  // ── Attempt 2: Direct Resend API call ──
  try {
    await sendViaResendDirect(payload);
    return { success: true };
  } catch (directErr: any) {
    console.error('[reportEmailSender] Direct Resend also failed:', directErr);
    return {
      success: false,
      error: directErr?.message || 'Failed to send report.',
    };
  }
}
