import React from 'react';

interface RolloverSectionProps {
  rolloverEnabled: boolean;
  onUpdateSettings: (key: string, value: any) => void;
}

const RolloverSection: React.FC<RolloverSectionProps> = ({
  rolloverEnabled,
  onUpdateSettings,
}) => {
  return (
    <div
      id="settings-rollover-container"
      className="flex items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60"
    >
      <div className="flex flex-col">
        <span className="font-black text-base text-slate-500 dark:text-slate-200">
          Budget Rollover
        </span>
        <span className="text-xs text-slate-500 font-medium">
          Carry surplus to next month.
        </span>
      </div>
      <button
        onClick={() => onUpdateSettings('rolloverEnabled', !rolloverEnabled)}
        className={`w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-pointer ${
          rolloverEnabled ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
        }`}
      >
        <div
          className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${
            rolloverEnabled ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
};

export default RolloverSection;
