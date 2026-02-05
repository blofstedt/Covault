// components/settings_modal_components/AppNotificationsSection.tsx
import React from 'react';

interface AppNotificationsSectionProps {
  enabled: boolean;
  onToggle: (v: boolean) => void;
}

const AppNotificationsSection: React.FC<AppNotificationsSectionProps> = ({
  enabled,
  onToggle,
}) => {
  return (
    <div className="flex items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
      {/* LEFT TEXT */}
      <div className="flex flex-col">
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          App Notifications
        </span>

        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-0.5 leading-relaxed">
          Notifications for budget upper limits.
        </span>
      </div>

      {/* RIGHT TOGGLE */}
      <button
        onClick={() => onToggle(!enabled)}
        className={`w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-pointer ${
          enabled ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
        }`}
      >
        <div
          className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${
            enabled ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
};

export default AppNotificationsSection;
