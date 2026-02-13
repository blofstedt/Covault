import React from 'react';
import { SettingsToggleRow } from '../../shared';

interface RolloverSectionProps {
  rolloverEnabled: boolean;
  onUpdateSettings: (key: string, value: any) => void;
}

const RolloverSection: React.FC<RolloverSectionProps> = ({
  rolloverEnabled,
  onUpdateSettings,
}) => (
  <SettingsToggleRow
    id="settings-rollover-container"
    title="Budget Rollover"
    description="Carry surplus to next month."
    enabled={rolloverEnabled}
    onToggle={() => onUpdateSettings('rolloverEnabled', !rolloverEnabled)}
  />
);

export default RolloverSection;
