import React from 'react';
import NotificationSettings from '../NotificationSettings';

interface NotificationToggleCardProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

const NotificationToggleCard: React.FC<NotificationToggleCardProps> = ({ enabled, onToggle }) => (
  <div id="parsing-notification-toggle" className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-6 shadow-xl border border-slate-100 dark:border-slate-800/60 space-y-4">
    <NotificationSettings
      enabled={enabled}
      onToggle={onToggle}
    />
  </div>
);

export default NotificationToggleCard;
