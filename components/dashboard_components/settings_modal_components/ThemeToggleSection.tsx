import React from 'react';

interface ThemeToggleSectionProps {
  theme: string;
  onUpdateSettings: (key: string, value: any) => void;
}

const ThemeToggleSection: React.FC<ThemeToggleSectionProps> = ({
  theme,
  onUpdateSettings,
}) => {
  return (
    <div
      id="settings-theme-container"
      className="flex items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60"
    >
      <div className="flex flex-col">
        <span className="font-black text-base text-slate-500 dark:text-slate-200">
          Dark Interface
        </span>
        <span className="text-xs text-slate-500 font-medium">
          Calm appearance for low light.
        </span>
      </div>
      <button
        onClick={() =>
          onUpdateSettings('theme', theme === 'light' ? 'dark' : 'light')
        }
        className={`w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-pointer ${
          theme === 'dark' ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
        }`}
      >
        <div
          className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${
            theme === 'dark' ? 'translate-x-6' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
};

export default ThemeToggleSection;
