import React from 'react';

interface CloseButtonProps {
  onClick: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
  /** Accessible name. The button renders only an X icon, so screen readers
   *  have nothing else to announce. */
  label?: string;
}

const CloseButton: React.FC<CloseButtonProps> = ({ onClick, disabled = false, size = 'md', label = 'Close' }) => {
  const sizeClasses = size === 'sm' ? 'p-2' : 'p-2.5';
  const iconSize = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`${sizeClasses} bg-slate-100 dark:bg-slate-800 rounded-full transition-transform duration-200 active:scale-[0.97] ${
        disabled ? 'opacity-20 cursor-not-allowed' : ''
      }`}
    >
      <svg aria-hidden="true" className={`${iconSize} text-slate-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={size === 'sm' ? 2.5 : 3} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
};

export default CloseButton;
