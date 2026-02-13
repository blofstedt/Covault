import React from 'react';
import SettingsCard from '../../ui/SettingsCard';
import ToggleSwitch from '../../ui/ToggleSwitch';

interface ThemeToggleSectionProps {
  theme: string;
  onUpdateSettings: (key: string, value: any) => void;
}

const ThemeToggleSection: React.FC<ThemeToggleSectionProps> = ({
  theme,
  onUpdateSettings,
}) => {
  return (
    <SettingsCard id="settings-theme-container" className="flex items-center justify-between">
      <div className="flex flex-col">
        <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Dark Interface
        </span>
        <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium mt-0.5 leading-relaxed">
          Calm appearance for low light.
        </span>
      </div>
      <ToggleSwitch
        enabled={theme === 'dark'}
        onToggle={() => onUpdateSettings('theme', theme === 'light' ? 'dark' : 'light')}
      />
    </SettingsCard>
  );
};

export default ThemeToggleSection;
