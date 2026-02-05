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
    <div className="p-5 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60">
      <div className="flex items-center justify-between">
        {/* LEFT TEXT */}
        <div className="flex flex-col">
          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            App Notifications
          </span>

          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
            Notifications for budget upper limits.
          </p>
        </div>

        {/* RIGHT TOGGLE */}
        <button
          onClick={() => onToggle(!enabled)}
          className={`relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0 ${
            enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
};

export default AppNotificationsSection;
