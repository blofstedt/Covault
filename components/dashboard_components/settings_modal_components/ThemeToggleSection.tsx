import React from 'react';
import { SettingsToggleRow } from '../../shared';

interface ThemeToggleSectionProps {
  theme: string;
  onUpdateSettings: (key: string, value: any) => void;
}

const ThemeToggleSection: React.FC<ThemeToggleSectionProps> = ({
  theme,
  onUpdateSettings,
}) => (
  <SettingsToggleRow
    id="settings-theme-container"
    title="Dark Interface"
    description="Calm appearance for low light."
    enabled={theme === 'dark'}
    onToggle={() => onUpdateSettings('theme', theme === 'light' ? 'dark' : 'light')}
  />
);

export default ThemeToggleSection;
