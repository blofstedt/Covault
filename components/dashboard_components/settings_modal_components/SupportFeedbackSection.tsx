import React from 'react';

const SupportFeedbackSection: React.FC = () => {
  return (
    <div className="pt-8 space-y-6">
      <div className="flex items-center justify-between px-2">
        <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
        <span className="text-[10px] font-black text-slate-300 dark:text-slate-600 uppercase tracking-[0.2em] px-4">
          Support &amp; Feedback
        </span>
        <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
      </div>
      <div className="space-y-3">
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
          <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap">
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

        <a
          id="request-feature-button"
          href="mailto:itsjustmyemail@gmail.com?subject=Covault: Feature Request"
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
          <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap">
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
      </div>
    </div>
  );
};

export default SupportFeedbackSection;
