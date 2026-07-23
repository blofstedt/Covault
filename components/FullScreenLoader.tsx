// components/FullScreenLoader.tsx
import React from 'react';

const Shimmer: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-2xl bg-slate-200/60 dark:bg-slate-800/60 ${className}`} />
);

const FullScreenLoader: React.FC = () => (
  <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 px-6 pt-16 pb-8">
    {/* Balance skeleton */}
    <div className="flex flex-col items-center mb-6">
      <Shimmer className="w-32 h-3 mb-3" />
      <Shimmer className="w-48 h-10 rounded-xl" />
    </div>

    {/* Chart skeleton */}
    <Shimmer className="w-full h-[120px] rounded-2xl mb-4" />

    {/* Budget cards skeleton */}
    <div className="flex-1 space-y-3">
      <Shimmer className="w-full h-16 rounded-[2rem]" />
      <Shimmer className="w-full h-16 rounded-[2rem]" />
      <Shimmer className="w-full h-16 rounded-[2rem]" />
      <Shimmer className="w-full h-16 rounded-[2rem]" />
    </div>

    {/* Bottom bar skeleton */}
    <div className="flex justify-center mt-4">
      <Shimmer className="w-48 h-12 rounded-full" />
    </div>
  </div>
);

export default FullScreenLoader;
