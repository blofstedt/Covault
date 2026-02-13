// components/settings_modal_components/AppNotificationsSection.tsx
import React from 'react';
import { SettingsToggleRow } from '../../shared';

interface AppNotificationsSectionProps {
  enabled: boolean;
  onToggle: (v: boolean) => void;
}

const AppNotificationsSection: React.FC<AppNotificationsSectionProps> = ({
  enabled,
  onToggle,
}) => (
  <SettingsToggleRow
    id="settings-app-notifications-container"
    title="App Notifications"
    description="Notifications for budget upper limits."
    enabled={enabled}
    onToggle={() => onToggle(!enabled)}
  />
);

export default AppNotificationsSection;
