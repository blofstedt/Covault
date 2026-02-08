import React, { useState } from 'react';
import type { ScheduledReport, ReportFrequency, BudgetCategory, Transaction } from '../../../types';
import { supabase } from '../../../lib/supabase';

interface ScheduledReportsSectionProps {
  reports: ScheduledReport[];
  onUpdateReports: (reports: ScheduledReport[]) => void;
  budgets: BudgetCategory[];
  transactions: Transaction[];
  userName?: string;
}

const FREQUENCY_OPTIONS: { value: ReportFrequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'one_time', label: 'One Time' },
];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function reportToSentence(report: ScheduledReport): string {
  const emailStr = report.emails.length === 1
    ? report.emails[0]
    : `${report.emails.length} recipients`;
  const day = report.dayOfMonth;
  const suffix =
    (day >= 11 && day <= 13) ? 'th' :
    day % 10 === 1 ? 'st' :
    day % 10 === 2 ? 'nd' :
    day % 10 === 3 ? 'rd' : 'th';

  if (report.frequency === 'monthly') {
    return `Send report to ${emailStr} on the ${day}${suffix} of each month.`;
  }
  if (report.frequency === 'yearly') {
    const month = MONTH_NAMES[report.month ?? 0];
    return `Send report to ${emailStr} on ${month} ${day}${suffix} each year.`;
  }
  return `Send a one-time report to ${emailStr}.`;
}

const ScheduledReportsSection: React.FC<ScheduledReportsSectionProps> = ({
  reports,
  onUpdateReports,
  budgets,
  transactions,
  userName,
}) => {
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingReport, setEditingReport] = useState<ScheduledReport | undefined>(undefined);
  const [deletingReportId, setDeletingReportId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Builder state
  const [emails, setEmails] = useState('');
  const [frequency, setFrequency] = useState<ReportFrequency>('monthly');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [month, setMonth] = useState('0');

  const openBuilder = (report?: ScheduledReport) => {
    if (report) {
      setEditingReport(report);
      setEmails(report.emails.join(', '));
      setFrequency(report.frequency);
      setDayOfMonth(report.dayOfMonth.toString());
      setMonth((report.month ?? 0).toString());
    } else {
      setEditingReport(undefined);
      setEmails('');
      setFrequency('monthly');
      setDayOfMonth('1');
      setMonth('0');
    }
    setShowBuilder(true);
  };

  const [oneTimeSent, setOneTimeSent] = useState(false);

  /** Build a budget summary from current budgets + transactions for the report email. */
  const buildBudgetSummary = () => {
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

  const sendReportEmail = async (recipientEmails: string[]) => {
    setIsSending(true);
    setSendError(null);

    try {
      const budgetSummary = buildBudgetSummary();

      const { error } = await supabase.functions.invoke('send-report', {
        body: {
          emails: recipientEmails,
          budgets: budgetSummary,
          userName,
        },
      });

      if (error) {
        setSendError(error.message || 'Failed to send report.');
        setTimeout(() => setSendError(null), 4000);
        return false;
      }

      return true;
    } catch (err) {
      console.error('Failed to send report:', err);
      setSendError('Failed to send report. Please try again.');
      setTimeout(() => setSendError(null), 4000);
      return false;
    } finally {
      setIsSending(false);
    }
  };

  const handleSave = async () => {
    const parsedEmails = emails
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes('@'));

    if (parsedEmails.length === 0) return;

    const report: ScheduledReport = {
      id: editingReport?.id || crypto.randomUUID(),
      emails: parsedEmails,
      frequency,
      dayOfMonth: Math.min(28, Math.max(1, parseInt(dayOfMonth) || 1)),
      month: frequency === 'yearly' ? parseInt(month) || 0 : undefined,
      enabled: editingReport?.enabled ?? true,
    };

    // One-time reports are sent immediately and not persisted in the list
    if (frequency === 'one_time') {
      const sent = await sendReportEmail(parsedEmails);
      if (sent) {
        setOneTimeSent(true);
        setTimeout(() => setOneTimeSent(false), 2500);
        setShowBuilder(false);
        setEditingReport(undefined);
      }
      return;
    }

    if (editingReport) {
      onUpdateReports(reports.map((r) => (r.id === report.id ? report : r)));
    } else {
      onUpdateReports([...reports, report]);
    }
    setShowBuilder(false);
    setEditingReport(undefined);
  };

  const handleDelete = (reportId: string) => {
    onUpdateReports(reports.filter((r) => r.id !== reportId));
    setDeletingReportId(null);
  };

  const handleToggle = (reportId: string) => {
    onUpdateReports(
      reports.map((r) => (r.id === reportId ? { ...r, enabled: !r.enabled } : r)),
    );
  };

  return (
    <>
      <div id="settings-scheduled-reports-container" className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
        <div className="flex flex-col mb-3">
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Scheduled Reports
          </span>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
            Automated visual reports sent to your email.
          </p>
        </div>

        {/* Reports list */}
        {reports.length > 0 && (
          <div className="space-y-2 mb-3">
            {reports.map((report) => (
              <div
                key={report.id}
                className={`p-3 rounded-2xl border transition-all ${
                  report.enabled
                    ? 'bg-white dark:bg-slate-800/60 border-slate-100 dark:border-slate-700/50'
                    : 'bg-slate-100/50 dark:bg-slate-800/30 border-slate-100/50 dark:border-slate-700/30 opacity-60'
                }`}
              >
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => handleToggle(report.id)}
                    className={`mt-0.5 w-8 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${
                      report.enabled
                        ? 'bg-emerald-500'
                        : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  >
                    <span
                      className={`block w-4 h-4 mt-0.5 ml-0.5 bg-white rounded-full shadow transition-transform duration-200 ${
                        report.enabled ? 'translate-x-3' : 'translate-x-0'
                      }`}
                    />
                  </button>

                  <button
                    onClick={() => openBuilder(report)}
                    className="flex-1 text-left"
                  >
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                      {reportToSentence(report)}
                    </p>
                    <span className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 block">
                      📊{' '}
                      {report.frequency === 'monthly'
                        ? 'Monthly'
                        : report.frequency === 'yearly'
                          ? 'Yearly'
                          : 'One-Time'}
                    </span>
                  </button>

                  <button
                    onClick={() => setDeletingReportId(report.id)}
                    className="p-1 text-slate-300 dark:text-slate-600 hover:text-rose-400 transition-colors flex-shrink-0"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {reports.length === 0 && (
          <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center py-3 mb-2">
            No scheduled reports. Tap + to create one.
          </p>
        )}

        <button
          onClick={() => openBuilder()}
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
          Schedule Report
        </button>

        {oneTimeSent && (
          <div className="mt-2 py-2 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-wider text-center animate-in fade-in duration-300">
            ✓ Report sent
          </div>
        )}
        {sendError && (
          <div className="mt-2 py-2 rounded-2xl bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-[10px] font-black uppercase tracking-wider text-center animate-in fade-in duration-300">
            ✗ {sendError}
          </div>
        )}
      </div>

      {/* Builder modal */}
      {showBuilder && (
        <div className="fixed inset-0 z-[120] bg-slate-900/50 backdrop-blur-md flex items-end sm:items-center justify-center animate-in fade-in duration-200">
          <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-[2rem] sm:rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-4 duration-300 max-h-[80vh] overflow-y-auto no-scrollbar border border-slate-100 dark:border-slate-800/60">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[13px] font-black text-slate-700 dark:text-slate-200 uppercase tracking-[0.15em]">
                {editingReport ? 'Edit Report' : 'New Report'}
              </h3>
              <button
                onClick={() => {
                  setShowBuilder(false);
                  setEditingReport(undefined);
                }}
                className="p-1.5 bg-slate-100 dark:bg-slate-800 rounded-full active:scale-90 transition-transform"
              >
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Email input */}
            <div className="mb-4">
              <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-1.5">
                Send To (email addresses)
              </label>
              <input
                type="text"
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                placeholder="email1@example.com, email2@example.com"
                className="w-full px-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50"
              />
              <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-1">
                Separate multiple emails with commas.
              </p>
            </div>

            {/* Frequency */}
            <div className="mb-4">
              <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-2">
                Frequency
              </label>
              <div className="flex gap-2">
                {FREQUENCY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setFrequency(opt.value)}
                    className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                      frequency === opt.value
                        ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 border-2 border-emerald-500/30'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-2 border-transparent'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Day of month (for monthly and yearly) */}
            {frequency !== 'one_time' && (
              <div className="mb-4">
                <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-1.5">
                  Day of Month
                </label>
                <input
                  type="number"
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  min={1}
                  max={28}
                  className="w-full px-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50"
                />
                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-1">
                  Choose 1–28 to avoid end-of-month issues.
                </p>
              </div>
            )}

            {/* Month (for yearly) */}
            {frequency === 'yearly' && (
              <div className="mb-4">
                <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block mb-1.5">
                  Month
                </label>
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full px-4 py-3 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/50"
                >
                  {MONTH_NAMES.map((name, i) => (
                    <option key={i} value={i}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => {
                  setShowBuilder(false);
                  setEditingReport(undefined);
                }}
                className="flex-1 py-3 rounded-2xl text-[11px] font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 active:scale-95 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSending}
                className={`flex-1 py-3 rounded-2xl text-[11px] font-black uppercase tracking-wider active:scale-95 transition-all shadow-lg shadow-emerald-500/20 ${
                  isSending
                    ? 'bg-emerald-400 text-white/70 cursor-wait'
                    : 'bg-emerald-500 text-white'
                }`}
              >
                {isSending
                  ? 'Sending…'
                  : editingReport ? 'Update' : frequency === 'one_time' ? 'Send Now' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deletingReportId && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="w-full max-w-[320px] bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 space-y-8 shadow-2xl animate-in zoom-in-95 duration-300 border border-slate-100 dark:border-slate-800/60 text-center">
            <div className="flex flex-col items-center space-y-4">
              <div className="w-16 h-16 bg-rose-50 dark:bg-rose-900/20 rounded-2xl flex items-center justify-center">
                <svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">Delete Report?</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed">This will permanently remove this scheduled report.</p>
              </div>
            </div>
            <div className="flex flex-col space-y-3">
              <button
                onClick={() => handleDelete(deletingReportId)}
                className="w-full py-4 bg-rose-500 hover:bg-rose-600 text-white rounded-2xl font-black text-sm shadow-lg shadow-rose-500/20 active:scale-95 transition-all uppercase tracking-widest"
              >
                Confirm Delete
              </button>
              <button
                onClick={() => setDeletingReportId(null)}
                className="w-full py-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl font-black text-sm active:scale-95 transition-all uppercase tracking-widest"
              >
                Go Back
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ScheduledReportsSection;
