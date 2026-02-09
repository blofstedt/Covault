import React from 'react';

const ReportSection: React.FC = () => {
  return (
    <div id="settings-reports-container" className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60 opacity-50">
      <div className="flex flex-col mb-3">
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Budget Report
        </span>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
          Send a monthly budget report to your email.
        </p>
      </div>

      <button
        disabled
        className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 text-[11px] font-black uppercase tracking-[0.15em] cursor-not-allowed flex items-center justify-center gap-1.5"
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
        Coming Soon
      </button>
    </div>
  );
};

export default ReportSection;
