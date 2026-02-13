import React from 'react';
import SettingsCard from '../../ui/SettingsCard';
import SectionHeader from '../../ui/SectionHeader';

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
      <SectionHeader
        title="Discretionary Shield"
        subtitle="If a budget overspends, money from your Leisure vault will be automatically reallocated to cover it."
        className="mb-4"
      />
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
