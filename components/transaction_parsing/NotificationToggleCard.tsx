import React from 'react';
import NotificationSettings from '../NotificationSettings';
import { CardWrapper } from '../shared';

interface NotificationToggleCardProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

const NotificationToggleCard: React.FC<NotificationToggleCardProps> = ({ enabled, onToggle }) => (
  <CardWrapper id="parsing-notification-toggle" color="slate">
    <NotificationSettings
      enabled={enabled}
      onToggle={onToggle}
    />
  </CardWrapper>
);

export default NotificationToggleCard;
