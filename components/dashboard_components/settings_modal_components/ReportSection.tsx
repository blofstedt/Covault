import React from 'react';
import SettingsCard from '../../ui/SettingsCard';
import SectionHeader from '../../ui/SectionHeader';

const ReportSection: React.FC = () => {
  return (
    <SettingsCard id="settings-reports-container" className="opacity-50">
      <SectionHeader title="Budget Report" subtitle="Send a monthly budget report to your email." className="mb-3" />

      <button
        disabled
        className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 text-xs font-semibold tracking-wide cursor-not-allowed flex items-center justify-center gap-1.5"
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
    </SettingsCard>
  );
};

export default ReportSection;
