import React from 'react';

interface DashboardHeaderProps {
  onOpenSettings: () => void;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({ onOpenSettings }) => {
  return (
    <div
      className="relative flex items-center justify-end h-12 px-3 z-20 shrink-0"
      style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
    >
      <button
        id="settings-button"
        onClick={onOpenSettings}
        className="p-3 -m-1 transition-colors active:scale-90 bg-white/50 dark:bg-slate-800/50 backdrop-blur-md rounded-xl text-slate-400 hover:text-emerald-600"
      >
        <svg
          className="w-7 h-7"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
    </div>
  );
};

export default DashboardHeader;
