import React from 'react';

interface SettingsSectionProps {
  id?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  padding?: 'sm' | 'md';
}

const SettingsSection: React.FC<SettingsSectionProps> = ({
  id,
  title,
  description,
  children,
  padding = 'md',
}) => (
  <div
    id={id}
    className={`${padding === 'sm' ? 'p-5' : 'p-6'} bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60`}
  >
    <div className="flex flex-col mb-4">
      <span className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        {title}
      </span>
      {description && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium mt-1 leading-relaxed">
          {description}
        </p>
      )}
    </div>
    {children}
  </div>
);

export default SettingsSection;
