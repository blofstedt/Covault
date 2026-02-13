import React from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md';
}

const Spinner: React.FC<SpinnerProps> = ({ size = 'sm' }) => {
  const sizeClass = size === 'md' ? 'w-8 h-8' : 'w-6 h-6';
  return (
    <div className={`${sizeClass} border-2 border-emerald-500 border-t-transparent rounded-full animate-spin`} />
  );
};

export default Spinner;
