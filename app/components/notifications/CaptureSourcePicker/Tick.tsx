import type React from 'react';

const Tick: React.FC<{ on: boolean }> = ({ on }) => (
  <div
    className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 ${
      on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
    }`}
  >
    {on && (
      <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    )}
  </div>
);


export default Tick;
