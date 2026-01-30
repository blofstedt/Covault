import React from 'react';
import CovaultIcon from '../CovaultIcon';

interface DashboardHeaderProps {
  onOpenSettings: () => void;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({ onOpenSettings }) => {
  return (
    <div className="relative flex items-center justify-end h-10">
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center space-x-2">
        <CovaultIcon
          size={28} // small icon size for header
          rotate={false} // keep it upright here for a clean nav look
          className="shadow-lg transition-colors duration-700"
        />
        <span className="font-black text-sm tracking-tighter uppercase transition-colors duration-700 text-slate-500 dark:text-slate-50">
          Covault
        </span>
      </div>

      <button
        id="settings-button"
        onClick={onOpenSettings}
        className="p-2.5 transition-colors active:scale-90 bg-white/50 dark:bg-slate-800/50 backdrop-blur-md rounded-xl text-slate-400 hover:text-emerald-600"
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
