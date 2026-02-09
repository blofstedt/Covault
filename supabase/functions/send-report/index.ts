// supabase/functions/send-report/index.ts
// Supabase Edge Function to send budget report emails.
//
// Required environment variable (set via Supabase Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY – API key from https://resend.com
//
// The function is invoked from the frontend via:
//   supabase.functions.invoke('send-report', { body: { ... } })

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SENDER_EMAIL = Deno.env.get('SENDER_EMAIL') || 'Covault Reports <reports@covault.app>';

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

interface ReportPayload {
  emails: string[];
  budgets: BudgetSummary[];
  transactions?: TransactionSummary[];
  totalIncome?: number;
  userName?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Teal/emerald palette matching the app's design
const CATEGORY_COLORS: Record<string, string> = {
  Housing:   '#0d9488',
  Groceries: '#059669',
  Transport: '#10b981',
  Utilities: '#34d399',
  Leisure:   '#1EA078',
  Services:  '#047857',
  Other:     '#6ee7b7',
};

const FALLBACK_COLORS = ['#0d9488', '#059669', '#10b981', '#34d399', '#1EA078', '#047857', '#6ee7b7'];

function getCategoryColor(name: string, index: number): string {
  return CATEGORY_COLORS[name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// SVG icon paths for each budget category (inline-friendly for email)
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

function buildHtmlReport(
  budgets: BudgetSummary[],
  transactions: TransactionSummary[],
  totalIncome: number,
  userName?: string,
): string {
  const title = userName ? `${escapeHtml(userName)}'s Budget Report` : 'Your Budget Report';
  const now = new Date();
  const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const totalSpent = budgets.reduce((sum, b) => sum + b.spent, 0);
  const totalBudget = budgets.reduce((sum, b) => sum + b.limit, 0);
  const overallPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  const remaining = totalIncome > 0 ? totalIncome - totalSpent : totalBudget - totalSpent;

  const fmtCurrency = (n: number) =>
    '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtShort = (n: number) =>
    '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const overallBarColor = overallPct >= 100 ? '#ef4444' : overallPct >= 75 ? '#f59e0b' : '#10b981';

  // ── Budget category cards (table-based for email clients) ──
  const budgetCards = budgets
    .map((b, i) => {
      const pct = b.limit > 0 ? Math.round((b.spent / b.limit) * 100) : 0;
      const rem = b.limit - b.spent;
      const color = getCategoryColor(b.name, i);
      const statusColor = pct >= 100 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#10b981';
      const statusLabel = pct >= 100 ? 'Over Budget' : pct >= 75 ? 'Caution' : 'On Track';
      const progressW = Math.min(pct, 100);
      const barColor = pct >= 100 ? '#ef4444' : color;
      const icon = getBudgetIconSvg(b.name);

      return `
        <tr><td style="padding:5px 0">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;border-radius:16px;overflow:hidden">
            <tr><td style="padding:16px 18px">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="vertical-align:middle">
                    <span style="display:inline-block;width:32px;height:32px;border-radius:10px;background:${color}15;text-align:center;line-height:32px;vertical-align:middle;margin-right:10px;color:${color}">${icon}</span>
                    <span style="font-size:13px;font-weight:800;color:#1e293b;vertical-align:middle;text-transform:uppercase;letter-spacing:0.02em">${escapeHtml(b.name)}</span>
                  </td>
                  <td style="text-align:right;vertical-align:middle">
                    <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:${statusColor};background:${statusColor}15">${statusLabel}</span>
                  </td>
                </tr>
              </table>
              <div style="margin:12px 0 8px;background:#e2e8f0;border-radius:6px;height:7px;overflow:hidden">
                <div style="width:${progressW}%;height:100%;border-radius:6px;background:${barColor}"></div>
              </div>
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-size:12px;color:#64748b"><strong style="color:#1e293b;font-weight:800">${fmtCurrency(b.spent)}</strong> of ${fmtCurrency(b.limit)}</td>
                  <td style="text-align:right;font-size:12px;font-weight:800;color:${rem < 0 ? '#ef4444' : '#10b981'}">${rem < 0 ? '-' : ''}${fmtCurrency(rem)} left</td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>`;
    })
    .join('');

  // ── Transaction rows styled like Covault's TransactionItem ──
  const sortedTxs = [...transactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
  const displayTxs = sortedTxs.slice(0, 30);

  const txRows = displayTxs
    .map((tx) => {
      const txDate = new Date(tx.date);
      const dateLabel = txDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const catColor = getCategoryColor(tx.category, 0);
      const icon = getBudgetIconSvg(tx.category);

      return `
        <tr><td style="padding:3px 0">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #f1f5f9;border-radius:16px;overflow:hidden">
            <tr>
              <td style="padding:12px 16px;vertical-align:middle;width:36px">
                <div style="width:32px;height:32px;border-radius:10px;background:${catColor}10;text-align:center;line-height:32px;color:${catColor}">${icon}</div>
              </td>
              <td style="padding:12px 4px;vertical-align:middle">
                <div style="font-size:13px;font-weight:800;color:#1e293b;text-transform:uppercase;letter-spacing:0.01em;line-height:1.3">${escapeHtml(tx.vendor)}</div>
                <div style="margin-top:3px">
                  <span style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.02em">${dateLabel}</span>
                  <span style="font-size:9px;font-weight:700;color:${catColor};background:${catColor}12;padding:2px 7px;border-radius:6px;text-transform:uppercase;letter-spacing:0.06em;margin-left:6px">${escapeHtml(tx.category)}</span>
                </div>
              </td>
              <td style="padding:12px 16px;text-align:right;vertical-align:middle;white-space:nowrap">
                <div style="font-size:15px;font-weight:800;color:#1e293b;letter-spacing:-0.02em">${fmtCurrency(tx.amount)}</div>
              </td>
            </tr>
          </table>
        </td></tr>`;
    })
    .join('');

  const txSectionHtml = transactions.length > 0
    ? `
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="padding:24px 22px 12px">
          <table cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td><h2 style="margin:0;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.2em;color:#94a3b8">Recent Transactions</h2></td>
              <td style="text-align:right"><span style="font-size:11px;color:#cbd5e1;font-weight:700">${transactions.length} total</span></td>
            </tr>
          </table>
        </td></tr>
      </table>
      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="padding:0 10px 8px">
        <tbody>${txRows}</tbody>
      </table>
      ${transactions.length > 30 ? `<div style="text-align:center;padding:8px 24px 16px"><span style="font-size:11px;color:#94a3b8;font-weight:600">Showing 30 of ${transactions.length} transactions. Open Covault for full details.</span></div>` : ''}`
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
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">

    <!-- Header Card -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:linear-gradient(135deg,#059669 0%,#10b981 50%,#34d399 100%);border-radius:24px;overflow:hidden;margin-bottom:14px">
      <tr><td style="padding:36px 24px;text-align:center">
        <div style="display:inline-block;background:rgba(255,255,255,0.2);border-radius:12px;padding:5px 14px;margin-bottom:14px">
          <span style="font-size:10px;font-weight:900;letter-spacing:0.22em;text-transform:uppercase;color:#fff">COVAULT</span>
        </div>
        <h1 style="margin:8px 0 6px;color:#fff;font-size:22px;font-weight:900;letter-spacing:-0.02em">${title}</h1>
        <p style="margin:0;color:#d1fae5;font-size:13px;font-weight:500">${monthYear} &middot; ${dateStr}</p>
      </td></tr>
    </table>

    <!-- Overview Summary -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.03);margin-bottom:14px">
      <tr><td style="padding:22px 22px">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td style="text-align:center;padding:8px;width:33%">
              <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8;margin-bottom:6px">Spent</div>
              <div style="font-size:24px;font-weight:900;color:#1e293b;letter-spacing:-0.03em">${fmtShort(totalSpent)}</div>
            </td>
            <td style="text-align:center;padding:8px;width:34%;border-left:1px solid #f1f5f9;border-right:1px solid #f1f5f9">
              <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8;margin-bottom:6px">Budget</div>
              <div style="font-size:24px;font-weight:900;color:#1e293b;letter-spacing:-0.03em">${fmtShort(totalBudget)}</div>
            </td>
            <td style="text-align:center;padding:8px;width:33%">
              <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8;margin-bottom:6px">Remaining</div>
              <div style="font-size:24px;font-weight:900;color:${remaining < 0 ? '#ef4444' : '#10b981'};letter-spacing:-0.03em">${remaining < 0 ? '-' : ''}${fmtShort(remaining)}</div>
            </td>
          </tr>
        </table>
        <!-- Overall progress bar -->
        <div style="margin:18px 0 6px;background:#e2e8f0;border-radius:8px;height:8px;overflow:hidden">
          <div style="width:${Math.min(overallPct, 100)}%;height:100%;border-radius:8px;background:${overallBarColor}"></div>
        </div>
        <div style="text-align:center;font-size:11px;color:#94a3b8;font-weight:700">${overallPct}% of total budget used</div>
      </td></tr>
    </table>

    <!-- Budget Breakdown Cards -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.03);margin-bottom:14px">
      <tr><td style="padding:22px 18px 14px">
        <h2 style="margin:0 0 10px 4px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.2em;color:#94a3b8">Budget Breakdown</h2>
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          ${budgetCards}
        </table>
      </td></tr>
    </table>

    <!-- Transactions -->
    ${txSectionHtml ? `
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04),0 4px 12px rgba(0,0,0,0.03);margin-bottom:14px">
      ${txSectionHtml}
    </table>` : ''}

    <!-- Footer -->
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:8px">
      <tr><td style="text-align:center;padding:16px 24px">
        <div style="display:inline-block;background:rgba(16,185,129,0.1);border-radius:14px;padding:5px 14px;margin-bottom:8px">
          <span style="font-size:10px;font-weight:900;letter-spacing:0.18em;text-transform:uppercase;color:#10b981">COVAULT</span>
        </div>
        <p style="margin:0;font-size:11px;color:#94a3b8;font-weight:500;line-height:1.5">Budget Tracking Made Simple</p>
      </td></tr>
    </table>

  </div>
</body>
</html>`;
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY is not configured. Set it in Supabase Edge Function secrets.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { emails, budgets, transactions, totalIncome, userName } = (await req.json()) as ReportPayload;

    if (!emails || emails.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No recipient emails provided.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const html = buildHtmlReport(budgets ?? [], transactions ?? [], totalIncome ?? 0, userName);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: SENDER_EMAIL,
        to: emails,
        subject: `Your Covault Budget Report – ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
        html,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: data }),
        { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, id: data.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Internal error', message: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
