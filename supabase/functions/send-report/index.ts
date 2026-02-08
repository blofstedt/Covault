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

interface ReportPayload {
  emails: string[];
  budgets: BudgetSummary[];
  userName?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function buildHtmlReport(budgets: BudgetSummary[], userName?: string): string {
  const title = userName ? `${userName}'s Covault Budget Report` : 'Covault Budget Report';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const rows = budgets
    .map((b) => {
      const remaining = b.limit - b.spent;
      const pct = b.limit > 0 ? Math.round((b.spent / b.limit) * 100) : 0;
      const color = pct >= 100 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#10b981';
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${b.name}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">$${b.spent.toFixed(2)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">$${b.limit.toFixed(2)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:${color}">${pct}%</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:${remaining < 0 ? '#ef4444' : '#10b981'}">$${remaining.toFixed(2)}</td>
        </tr>`;
    })
    .join('');

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#334155;margin:0;padding:20px;background:#f8fafc">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
    <div style="background:#10b981;padding:24px;text-align:center">
      <h1 style="margin:0;color:#fff;font-size:20px;letter-spacing:0.05em">${title}</h1>
      <p style="margin:4px 0 0;color:#d1fae5;font-size:13px">${dateStr}</p>
    </div>
    <div style="padding:24px">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.05em">Category</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.05em">Spent</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.05em">Budget</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.05em">Used</th>
            <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.05em">Remaining</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="padding:16px 24px;background:#f8fafc;text-align:center">
      <p style="margin:0;font-size:11px;color:#94a3b8">Sent by Covault • Budget Tracking Made Simple</p>
    </div>
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

    const { emails, budgets, userName } = (await req.json()) as ReportPayload;

    if (!emails || emails.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No recipient emails provided.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const html = buildHtmlReport(budgets ?? [], userName);

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
