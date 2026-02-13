import React from 'react';

interface ToggleSwitchProps {
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ enabled, onToggle, disabled = false }) => (
  <button
    onClick={onToggle}
    disabled={disabled}
    className={`relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0 ${
      disabled ? 'opacity-50 cursor-not-allowed' : ''
    } ${enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
  >
    <span
      className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
        enabled ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);

export default ToggleSwitch;
