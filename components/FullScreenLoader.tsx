// components/FullScreenLoader.tsx
import React from 'react';

const FullScreenLoader: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
      <div className="flex flex-col items-center space-y-4">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          Securing Vault...
        </span>
      </div>
    </div>
  );
};

export default FullScreenLoader;
