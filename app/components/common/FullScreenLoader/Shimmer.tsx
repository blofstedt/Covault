import type React from 'react';

const Shimmer: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-2xl bg-slate-200/60 dark:bg-slate-800/60 ${className}`} />
);

export default Shimmer;
