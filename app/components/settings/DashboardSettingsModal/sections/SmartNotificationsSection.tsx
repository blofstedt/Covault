import React from 'react';
import SettingsCard from '../../../common/SettingsCard';
import SectionHeader from '../../../common/SectionHeader';
import ToggleSwitch from '../../../common/ToggleSwitch';

interface SmartNotificationsSectionProps {
  smartNotificationsEnabled: boolean;
  onToggleSmartNotifications: () => void;
}

const SmartNotificationsSection: React.FC<SmartNotificationsSectionProps> = ({
  smartNotificationsEnabled,
  onToggleSmartNotifications,
}) => (
  <SettingsCard>
    <SectionHeader title="Smart Notifications" subtitle="Push alerts for overspending & upcoming bills" />

    <div className="mt-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-300 tracking-wide">
            Enable Smart Notifications
          </p>
          <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-0.5">
            Get a push when a budget hits its limit or a bill is due in 3 days
          </p>
        </div>
        <ToggleSwitch enabled={smartNotificationsEnabled} onToggle={onToggleSmartNotifications} />
      </div>
    </div>
  </SettingsCard>
);

export default SmartNotificationsSection;
