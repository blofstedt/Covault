import React from 'react';
import NotificationSettings from '../NotificationSettings';

interface SetupInfoCardProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

const SetupInfoCard: React.FC<SetupInfoCardProps> = ({ enabled, onToggle }) => (
  <>
    {/* Setup state: info card + toggle + how it works */}
    <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-slate-100 dark:border-slate-800/60 space-y-4">
      <div className="flex items-start space-x-4">
        <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl">
          <svg
            className="w-8 h-8 text-emerald-600 dark:text-emerald-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </div>

        <div className="flex-1">
          <h2 className="text-lg font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase mb-2">
            Transaction Detection
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Teach Covault to detect transactions from your banking app notifications. You set it up once per bank — just highlight the vendor and amount in a sample notification.
          </p>
        </div>
      </div>

      <NotificationSettings
        enabled={enabled}
        onToggle={onToggle}
      />

      <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
        <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight text-center">
          No AI — your data stays on your device. You control exactly how transactions are detected.
        </p>
      </div>
    </div>

    {/* How it works */}
    <div className="bg-slate-100 dark:bg-slate-800/50 rounded-2xl p-4 space-y-3">
      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
        How it works
      </h3>

      <div className="flex flex-col gap-4">
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0 w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
            1
          </div>
          <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Enable parsing and grant notification access
          </span>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0 w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
            2
          </div>
          <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Tap a captured notification and highlight the vendor name and dollar amount
          </span>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0 w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
            3
          </div>
          <span className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Future notifications are automatically parsed — assign categories and approve
          </span>
        </div>
      </div>
    </div>
  </>
);

export default SetupInfoCard;
