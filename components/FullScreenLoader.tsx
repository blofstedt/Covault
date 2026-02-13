// components/FullScreenLoader.tsx
import React from 'react';
import { Spinner } from './shared';

const FullScreenLoader: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
    <div className="flex flex-col items-center space-y-4">
      <Spinner size="lg" />
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
        Securing Vault...
      </span>
    </div>
  </div>
);

export default FullScreenLoader;
