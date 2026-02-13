import React from 'react';

interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: 'amber' | 'emerald' | 'blue' | 'red' | 'violet' | 'slate';
  badge?: number;
}

const colorMap = {
  amber: {
    iconBg: 'bg-amber-50 dark:bg-amber-900/20',
    badgeBg: 'bg-amber-100 dark:bg-amber-900/30',
    badgeText: 'text-amber-700 dark:text-amber-300',
  },
  emerald: {
    iconBg: 'bg-emerald-50 dark:bg-emerald-900/20',
    badgeBg: 'bg-emerald-100 dark:bg-emerald-900/30',
    badgeText: 'text-emerald-700 dark:text-emerald-300',
  },
  blue: {
    iconBg: 'bg-blue-50 dark:bg-blue-900/20',
    badgeBg: 'bg-blue-100 dark:bg-blue-900/30',
    badgeText: 'text-blue-700 dark:text-blue-300',
  },
  red: {
    iconBg: 'bg-red-50 dark:bg-red-900/20',
    badgeBg: 'bg-red-100 dark:bg-red-900/30',
    badgeText: 'text-red-700 dark:text-red-300',
  },
  violet: {
    iconBg: 'bg-violet-50 dark:bg-violet-900/20',
    badgeBg: 'bg-violet-100 dark:bg-violet-900/30',
    badgeText: 'text-violet-700 dark:text-violet-300',
  },
  slate: {
    iconBg: 'bg-slate-100 dark:bg-slate-800/50',
    badgeBg: 'bg-slate-200 dark:bg-slate-700',
    badgeText: 'text-slate-500 dark:text-slate-400',
  },
};

const SectionHeader: React.FC<SectionHeaderProps> = ({ icon, title, subtitle, color, badge }) => {
  const colors = colorMap[color];
  return (
    <div className="flex items-center space-x-3">
      <div className={`p-2 ${colors.iconBg} rounded-xl`}>{icon}</div>
      <div className="flex-1">
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          {title}
        </h3>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      {badge !== undefined && badge > 0 && (
        <span className={`text-xs font-black ${colors.badgeBg} ${colors.badgeText} px-2.5 py-1 rounded-full`}>
          {badge}
        </span>
      )}
    </div>
  );
};

export default SectionHeader;
