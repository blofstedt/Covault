import React from 'react';

type Screen = 'auth' | 'onboarding' | 'dashboard' | 'parsing';

interface DeveloperModeOverlayProps {
  currentScreen: Screen;
  isSolo: boolean;
  notificationsEnabled: boolean;
  onNavigate: (screen: Screen) => void;
  onToggleSolo: () => void;
  onToggleNotifications: () => void;
  onExit: () => void;
}

const SCREENS: { key: Screen; label: string }[] = [
  { key: 'auth', label: 'Auth' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'parsing', label: 'Parsing' },
];

const DeveloperModeOverlay: React.FC<DeveloperModeOverlayProps> = ({
  currentScreen,
  isSolo,
  notificationsEnabled,
  onNavigate,
  onToggleSolo,
  onToggleNotifications,
  onExit,
}) => {
  return (
    <div className="fixed top-2 right-2 z-[9999] w-56 bg-yellow-50 dark:bg-yellow-950 border-2 border-yellow-400 dark:border-yellow-600 rounded-xl shadow-2xl text-xs select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-yellow-300 dark:border-yellow-700">
        <span className="font-black text-yellow-700 dark:text-yellow-300 uppercase tracking-widest text-[10px]">
          🛠 Dev Mode
        </span>
        <button
          onClick={onExit}
          className="text-yellow-600 dark:text-yellow-400 hover:text-red-500 font-black text-[10px] uppercase"
        >
          Exit
        </button>
      </div>

      {/* Screen navigation */}
      <div className="p-2 space-y-1">
        <p className="font-bold text-yellow-700 dark:text-yellow-300 uppercase tracking-widest text-[9px] px-1">
          Screens
        </p>
        <div className="grid grid-cols-2 gap-1">
          {SCREENS.map((s) => (
            <button
              key={s.key}
              onClick={() => onNavigate(s.key)}
              className={`px-2 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wide transition-all ${
                currentScreen === s.key
                  ? 'bg-yellow-400 dark:bg-yellow-600 text-yellow-900 dark:text-yellow-100'
                  : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* State toggles */}
      <div className="p-2 pt-0 space-y-1.5">
        <p className="font-bold text-yellow-700 dark:text-yellow-300 uppercase tracking-widest text-[9px] px-1">
          State
        </p>

        <button
          onClick={onToggleSolo}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg bg-yellow-100 dark:bg-yellow-900 hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-all"
        >
          <span className="font-bold text-yellow-700 dark:text-yellow-300 text-[10px] uppercase">
            User Mode
          </span>
          <span
            className={`font-black text-[10px] uppercase ${
              isSolo
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {isSolo ? 'Solo' : 'Couples'}
          </span>
        </button>

        <button
          onClick={onToggleNotifications}
          className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg bg-yellow-100 dark:bg-yellow-900 hover:bg-yellow-200 dark:hover:bg-yellow-800 transition-all"
        >
          <span className="font-bold text-yellow-700 dark:text-yellow-300 text-[10px] uppercase">
            Parsing
          </span>
          <span
            className={`font-black text-[10px] uppercase ${
              notificationsEnabled
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-red-500 dark:text-red-400'
            }`}
          >
            {notificationsEnabled ? 'On' : 'Off'}
          </span>
        </button>
      </div>

      <div className="px-3 py-1.5 text-center border-t border-yellow-300 dark:border-yellow-700">
        <span className="text-[8px] font-bold text-yellow-500 dark:text-yellow-600 uppercase tracking-widest">
          Type "developer" to exit
        </span>
      </div>
    </div>
  );
};

export default DeveloperModeOverlay;
