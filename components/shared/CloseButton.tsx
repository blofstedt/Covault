import React from 'react';

interface CloseButtonProps {
  onClick: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md';
}

const CloseButton: React.FC<CloseButtonProps> = ({ onClick, disabled = false, size = 'md' }) => {
  const sizeClasses = size === 'sm' ? 'p-2' : 'p-2.5';
  const iconSize = size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${sizeClasses} bg-slate-100 dark:bg-slate-800 rounded-full transition-transform active:scale-90 ${
        disabled ? 'opacity-20 cursor-not-allowed' : ''
      }`}
    >
      <svg className={`${iconSize} text-slate-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={size === 'sm' ? 2.5 : 3} d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  );
};

export default CloseButton;
