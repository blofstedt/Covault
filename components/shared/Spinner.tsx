import React from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
}

const sizeMap = {
  sm: 'w-6 h-6 border-2',
  md: 'w-8 h-8 border-2',
  lg: 'w-12 h-12 border-4',
};

const Spinner: React.FC<SpinnerProps> = ({ size = 'sm' }) => (
  <div className={`${sizeMap[size]} border-emerald-500 border-t-transparent rounded-full animate-spin`} />
);

export default Spinner;
