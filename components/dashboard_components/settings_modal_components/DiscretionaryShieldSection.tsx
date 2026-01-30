import React from 'react';

interface DiscretionaryShieldSectionProps {
  useLeisureAsBuffer: boolean;
  onUpdateSettings: (key: string, value: any) => void;
}

const DiscretionaryShieldSection: React.FC<DiscretionaryShieldSectionProps> = ({
  useLeisureAsBuffer,
  onUpdateSettings,
}) => {
  return (
    <div
      id="settings-shield-container"
      className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60"
    >
      <div className="flex flex-col mb-4">
        <span className="font-black text-base text-slate-500 dark:text-slate-200 uppercase tracking-tight">
          Discretionary Shield
        </span>
        <p className="text-[11px] text-slate-500 font-medium mt-1">
          If a budget overspends, money from your Leisure vault will be
          automatically reallocated to cover it.
        </p>
      </div>
      <button
        onClick={() =>
          onUpdateSettings('useLeisureAsBuffer', !useLeisureAsBuffer)
        }
        className={`w-full py-4 text-xs font-black rounded-2xl transition-all border-2 ${
          useLeisureAsBuffer
            ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg'
            : 'border-slate-200 dark:border-slate-700 text-slate-400'
        }`}
      >
        {useLeisureAsBuffer ? 'SHIELD ACTIVE' : 'SHIELD OFF'}
      </button>
    </div>
  );
};

export default DiscretionaryShieldSection;
