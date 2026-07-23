import React from 'react';

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  className?: string;
}

/**
 * Consistent section header with title and optional subtitle.
 * Used across settings sections and parsing cards for uniform typography.
 */
const SectionHeader: React.FC<SectionHeaderProps> = ({ title, subtitle, className = '' }) => (
  <div className={`flex flex-col ${className}`}>
    <span className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400">
      {title}
    </span>
    {subtitle && (
      <p className="text-[11px] text-slate-400 dark:text-slate-500 font-medium mt-0.5 leading-relaxed">
        {subtitle}
      </p>
    )}
  </div>
);

export default SectionHeader;
