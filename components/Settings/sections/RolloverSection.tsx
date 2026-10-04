import React from 'react';
import SettingsCard from '../../ui/SettingsCard';
import ToggleSwitch from '../../ui/ToggleSwitch';

interface RolloverSectionProps {
  rolloverEnabled: boolean;
  onUpdateSettings: (key: string, value: any) => void;
}

const RolloverSection: React.FC<RolloverSectionProps> = ({
  rolloverEnabled,
  onUpdateSettings,
}) => {
  return (
    <SettingsCard id="settings-rollover-container" className="flex items-center justify-between">
      <div className="flex flex-col">
        <span className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">
          Budget Rollover
        </span>
        <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium mt-0.5 leading-relaxed">
          Carry surplus to next month.
        </span>
      </div>
      <ToggleSwitch
        enabled={rolloverEnabled}
        onToggle={() => onUpdateSettings('rolloverEnabled', !rolloverEnabled)}
      />
    </SettingsCard>
  );
};

export default RolloverSection;
