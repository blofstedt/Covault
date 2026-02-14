import React from 'react';
import ToggleSwitch from './ToggleSwitch';

interface SettingsToggleRowProps {
  id?: string;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

const SettingsToggleRow: React.FC<SettingsToggleRowProps> = ({
  id,
  title,
  description,
  enabled,
  onToggle,
  disabled = false,
}) => (
  <div
    id={id}
    className="flex items-center justify-between p-6 bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800/60"
  >
    <div className="flex flex-col">
      <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        {title}
      </span>
      <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium mt-0.5 leading-relaxed">
        {description}
      </span>
    </div>
    <ToggleSwitch enabled={enabled} onToggle={onToggle} disabled={disabled} />
  </div>
);

export default SettingsToggleRow;
