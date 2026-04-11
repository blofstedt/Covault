// components/settings_modal_components/AppNotificationsSection.tsx
import React from 'react';
import SettingsCard from '../../ui/SettingsCard';
import ToggleSwitch from '../../ui/ToggleSwitch';

interface AppNotificationsSectionProps {
  enabled: boolean;
  onToggle: (v: boolean) => void;
}

const AppNotificationsSection: React.FC<AppNotificationsSectionProps> = ({
  enabled,
  onToggle,
}) => {
  return (
    <SettingsCard id="settings-app-notifications-container">
      <div className="flex items-center justify-between">
        {/* LEFT TEXT */}
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold tracking-wide text-slate-500 dark:text-slate-400">
            App Notifications
          </span>

          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
            Notifications for budget upper limits.
          </p>
        </div>

        {/* RIGHT TOGGLE */}
        <ToggleSwitch enabled={enabled} onToggle={() => onToggle(!enabled)} />
      </div>
    </SettingsCard>
  );
};

export default AppNotificationsSection;
