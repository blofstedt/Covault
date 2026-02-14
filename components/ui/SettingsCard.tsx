import React from 'react';

interface SettingsCardProps {
  id?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Shared wrapper for settings modal sections.
 * Provides the consistent rounded card styling used throughout the Settings modal.
 */
const SettingsCard: React.FC<SettingsCardProps> = ({ id, children, className = '' }) => (
  <div
    id={id}
    className={`p-6 bg-white dark:bg-slate-900 rounded-[2.5rem] shadow-xl border border-slate-100 dark:border-slate-800/60 ${className}`}
  >
    {children}
  </div>
);

export default SettingsCard;
