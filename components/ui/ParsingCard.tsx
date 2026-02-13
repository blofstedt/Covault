import React from 'react';

type ColorScheme = 'emerald' | 'amber' | 'blue' | 'violet' | 'slate' | 'red';

const borderColors: Record<ColorScheme, string> = {
  emerald: 'border-emerald-200 dark:border-emerald-800/40',
  amber: 'border-amber-200 dark:border-amber-800/40',
  blue: 'border-blue-200 dark:border-blue-800/40',
  violet: 'border-violet-200 dark:border-violet-800/40',
  slate: 'border-slate-100 dark:border-slate-800/60',
  red: 'border-red-200 dark:border-red-800/40',
};

const iconBgColors: Record<ColorScheme, string> = {
  emerald: 'bg-emerald-50 dark:bg-emerald-900/20',
  amber: 'bg-amber-50 dark:bg-amber-900/20',
  blue: 'bg-blue-50 dark:bg-blue-900/20',
  violet: 'bg-violet-50 dark:bg-violet-900/20',
  slate: 'bg-slate-100 dark:bg-slate-800/50',
  red: 'bg-red-50 dark:bg-red-900/20',
};

const iconTextColors: Record<ColorScheme, string> = {
  emerald: 'text-emerald-600 dark:text-emerald-400',
  amber: 'text-amber-600 dark:text-amber-400',
  blue: 'text-blue-600 dark:text-blue-400',
  violet: 'text-violet-600 dark:text-violet-400',
  slate: 'text-slate-400 dark:text-slate-500',
  red: 'text-red-600 dark:text-red-400',
};

const badgeColors: Record<ColorScheme, string> = {
  emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  violet: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
  slate: 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
  red: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
};

interface ParsingCardProps {
  id?: string;
  colorScheme: ColorScheme;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count?: number;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Shared wrapper for transaction parsing cards.
 * Provides the consistent card header with icon, title, subtitle and optional count badge.
 */
const ParsingCard: React.FC<ParsingCardProps> = ({
  id,
  colorScheme,
  icon,
  title,
  subtitle,
  count,
  headerAction,
  children,
  className = '',
}) => (
  <div
    id={id}
    className={`bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border ${borderColors[colorScheme]} ${className}`}
  >
    <div className="flex items-center space-x-3 mb-4">
      <div className={`p-2 ${iconBgColors[colorScheme]} rounded-xl`}>
        <svg
          className={`w-5 h-5 ${iconTextColors[colorScheme]}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icon}
        </svg>
      </div>
      <div className="flex-1">
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          {title}
        </h3>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
          {subtitle}
        </p>
      </div>
      {count !== undefined && count > 0 && (
        <span className={`text-xs font-black ${badgeColors[colorScheme]} px-2.5 py-1 rounded-full`}>
          {count}
        </span>
      )}
      {headerAction}
    </div>
    {children}
  </div>
);

export default ParsingCard;
export type { ColorScheme };
