import React from 'react';
import SettingsCard from '../../ui/SettingsCard';
import SectionHeader from '../../ui/SectionHeader';
import ToggleSwitch from '../../ui/ToggleSwitch';

interface SmartCardSettingsSectionProps {
  smartCardsEnabled: boolean;
  smartNotificationsEnabled: boolean;
  onToggleSmartCards: () => void;
  onToggleSmartNotifications: () => void;
}

const SmartCardSettingsSection: React.FC<SmartCardSettingsSectionProps> = ({
  smartCardsEnabled,
  smartNotificationsEnabled,
  onToggleSmartCards,
  onToggleSmartNotifications,
}) => (
  <SettingsCard>
    <SectionHeader title="Smart Insights" subtitle="Cards & notifications about your spending" />

    <div className="mt-4 space-y-4">
      {/* Toggle: Smart card modal */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase tracking-wider">
            Insight Cards
          </p>
          <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-0.5">
            Show smart cards when you open the app
          </p>
        </div>
        <ToggleSwitch enabled={smartCardsEnabled} onToggle={onToggleSmartCards} />
      </div>

      {/* Toggle: Smart push notifications */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-black text-slate-500 dark:text-slate-300 uppercase tracking-wider">
            Smart Notifications
          </p>
          <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-0.5">
            Push alerts for overspending & upcoming bills
          </p>
        </div>
        <ToggleSwitch enabled={smartNotificationsEnabled} onToggle={onToggleSmartNotifications} />
      </div>
    </div>
  </SettingsCard>
);

export default SmartCardSettingsSection;
