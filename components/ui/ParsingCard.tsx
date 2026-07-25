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
  /** Rescan Android's notification shade for transactions not yet captured. */
  onScan?: () => void;
  isScanning?: boolean;
  scanLabel?: string;
  collapsible?: boolean;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
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
  onScan,
  isScanning = false,
  scanLabel = 'Scan for transactions',
  collapsible = false,
  isExpanded = true,
  onToggleExpanded,
  children,
  className = '',
}) => (
  <div
    id={id}
    className={`bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] ${borderColors[colorScheme]} ${className}`}
  >
    <div className="flex items-center gap-3 mb-4 shrink-0">
      <button
        type="button"
        onClick={collapsible ? onToggleExpanded : undefined}
        className={`p-2 ${iconBgColors[colorScheme]} rounded-xl ${collapsible ? 'transition-transform active:scale-95' : ''}`}
        aria-label={collapsible ? `${isExpanded ? 'Collapse' : 'Expand'} ${title}` : undefined}
        disabled={!collapsible}
      >
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
      </button>
      <button
        type="button"
        onClick={collapsible ? onToggleExpanded : undefined}
        className={`flex-1 text-left min-w-0 ${collapsible ? 'cursor-pointer' : 'cursor-default'}`}
        disabled={!collapsible}
        aria-expanded={collapsible ? isExpanded : undefined}
      >
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 dark:text-slate-400 truncate">
          {title}
        </h3>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
          {subtitle}
        </p>
      </button>
      <div className="shrink-0 flex items-center gap-0.5">
      {count !== undefined && count > 0 && (
        <span className={`text-xs font-extrabold ${badgeColors[colorScheme]} px-2.5 py-1 rounded-full mr-1`}>
          {count}
        </span>
      )}
      {onScan && (
        <button
          type="button"
          onClick={onScan}
          disabled={isScanning}
          aria-label={scanLabel}
          title={scanLabel}
          className="shrink-0 inline-flex items-center justify-center min-h-[40px] min-w-[40px] rounded-xl text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 active:scale-95 transition-all disabled:opacity-60"
        >
          <svg
            className={`w-[18px] h-[18px] ${isScanning ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
            <path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      )}
      {headerAction}
      {collapsible && (
        <button
          type="button"
          onClick={onToggleExpanded}
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${title}`}
          aria-expanded={isExpanded}
        >
          <svg
            className={`w-4 h-4 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>
      )}
      </div>
    </div>
    {(!collapsible || isExpanded) && children}
  </div>
);

export default ParsingCard;
export type { ColorScheme };
