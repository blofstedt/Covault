import React from 'react';
import SettingsCard from '../../ui/SettingsCard';

interface DiscretionaryShieldSectionProps {
  useLeisureAsBuffer: boolean;
  onUpdateSettings: (key: string, value: any) => void;
}

const DiscretionaryShieldSection: React.FC<DiscretionaryShieldSectionProps> = ({
  useLeisureAsBuffer,
  onUpdateSettings,
}) => {
  return (
    <SettingsCard id="settings-shield-container">
      <div className="flex flex-col mb-4">
        <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Discretionary Shield
        </span>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium mt-1 leading-relaxed">
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
    </SettingsCard>
  );
};

export default DiscretionaryShieldSection;
