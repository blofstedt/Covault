import React from 'react';

interface ToggleSwitchProps {
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  enabled,
  onToggle,
  disabled = false,
  size = 'md',
}) => {
  const trackClass = size === 'sm'
    ? 'w-8 h-5'
    : 'w-12 h-7';
  const thumbClass = size === 'sm'
    ? 'w-4 h-4 top-0.5 left-0.5'
    : 'w-6 h-6 top-0.5 left-0.5';
  const translateClass = size === 'sm'
    ? (enabled ? 'translate-x-3' : 'translate-x-0')
    : (enabled ? 'translate-x-5' : 'translate-x-0');

  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`relative ${trackClass} rounded-full transition-colors duration-200 flex-shrink-0 ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${
        enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span
        className={`absolute ${thumbClass} bg-white rounded-full shadow transition-transform duration-200 ${translateClass}`}
      />
    </button>
  );
};

export default ToggleSwitch;
