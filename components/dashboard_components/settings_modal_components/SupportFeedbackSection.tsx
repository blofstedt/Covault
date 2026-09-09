import React, { useState } from 'react';
import PremiumGate from '../../PremiumGate';
import { covaultNotification, getCaptureDiagnostics } from '../../../lib/covaultNotification';
import { getSelectedSources, captureSourceName } from '../../../lib/captureSources';
import { getInstalledVersionCode } from '../../../lib/appUpdate';
import { buildMissedAlertReportUrl } from '../../../lib/missedAlertReport';

interface SupportFeedbackSectionProps {
  hasPremium: boolean;
  onSubscribe: () => void;
  /** Covault's own capture switch, included in the missed-purchase report. */
  captureEnabled: boolean;
}

const SupportFeedbackSection: React.FC<SupportFeedbackSectionProps> = ({
  hasPremium,
  onSubscribe,
  captureEnabled,
}) => {
  // Guards against a second tap opening a second mail composer while the
  // first is still gathering diagnostics — the one thing here slow enough
  // (a plugin round trip) to make that likely.
  const [preparingReport, setPreparingReport] = useState(false);

  const handleReportMissedAlert = async () => {
    if (preparingReport) return;
    setPreparingReport(true);
    try {
      const [outcomes, versionCode] = await Promise.all([
        getCaptureDiagnostics(covaultNotification),
        getInstalledVersionCode(),
      ]);
      const monitoredBankNames = getSelectedSources()
        .map((pkg) => captureSourceName(pkg) || pkg)
        .sort((a, b) => a.localeCompare(b));
      window.location.href = buildMissedAlertReportUrl({
        captureEnabled,
        monitoredBankNames,
        recentOutcomes: outcomes,
        versionCode,
      });
    } finally {
      setPreparingReport(false);
    }
  };

  return (
    <div className="pt-8 space-y-6">
      <div className="flex items-center justify-between px-2">
        <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
        <span className="text-[11px] font-semibold text-slate-300 dark:text-slate-600 tracking-wide px-4">
          Support &amp; Feedback
        </span>
        <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
      </div>
      <div className="space-y-3">
        {/* Report a Problem — always available (free) */}
        <a
          id="report-problem-button"
          href="mailto:itsjustmyemail@gmail.com?subject=Covault: Problem Report"
          className="flex items-center p-5 bg-slate-50 dark:bg-slate-800/30 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm active:scale-[0.98] transition-all group"
        >
          <div className="w-10 h-10 bg-rose-50 dark:bg-rose-900/20 rounded-xl flex items-center justify-center mr-4 group-hover:scale-110 transition-transform">
            <svg
              className="w-5 h-5 text-rose-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tracking-wide whitespace-nowrap">
            Report a Problem
          </span>
          <svg
            className="w-4 h-4 ml-auto text-slate-300 dark:text-slate-700 group-hover:translate-x-1 transition-transform"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </a>

        {/* Report a missed purchase — always available (free), the same as
            Report a Problem above. A purchase the parser never recognised
            leaves no row and no notification anywhere in the app, so this is
            the only route from "nothing happened" to something fixable —
            seeded with what Covault's own settings and recent capture
            activity were, never with any transaction, vendor, or bank alert
            text. See lib/missedAlertReport.ts. */}
        <button
          type="button"
          id="report-missed-alert-button"
          onClick={handleReportMissedAlert}
          disabled={preparingReport}
          className={`w-full flex items-center p-5 bg-slate-50 dark:bg-slate-800/30 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm active:scale-[0.98] transition-all group ${
            preparingReport ? 'opacity-60' : ''
          }`}
        >
          <div className="w-10 h-10 bg-amber-50 dark:bg-amber-900/20 rounded-xl flex items-center justify-center mr-4 group-hover:scale-110 transition-transform">
            <svg
              className="w-5 h-5 text-amber-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M22 12h-6l-2 3h-4l-2-3H2"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
              />
            </svg>
          </div>
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tracking-wide whitespace-nowrap text-left">
            {preparingReport ? 'Preparing report…' : 'Report a Missed Purchase'}
          </span>
          <svg
            className="w-4 h-4 ml-auto text-slate-300 dark:text-slate-700 group-hover:translate-x-1 transition-transform"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </button>

        {/* Request a Feature — premium only */}
        <PremiumGate hasPremium={hasPremium} onSubscribe={onSubscribe}>
          <a
            id="request-feature-button"
            href="mailto:mostlydecentdev@gmail.com?subject=Covault: Feature Request"
            className="flex items-center p-5 bg-slate-50 dark:bg-slate-800/30 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm active:scale-[0.98] transition-all group"
          >
            <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center mr-4 group-hover:scale-110 transition-transform">
              <svg
                className="w-5 h-5 text-emerald-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-7.714 2.143L11 21l-2.286-6.857L1 12l7.714-2.143L11 3z"
                />
              </svg>
            </div>
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tracking-wide whitespace-nowrap">
              Request a Feature
            </span>
            <svg
              className="w-4 h-4 ml-auto text-slate-300 dark:text-slate-700 group-hover:translate-x-1 transition-transform"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </a>
        </PremiumGate>
      </div>
    </div>
  );
};

export default SupportFeedbackSection;
