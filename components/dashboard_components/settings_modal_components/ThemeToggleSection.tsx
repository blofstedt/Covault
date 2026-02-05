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
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          Dark Interface
        </span>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium mt-0.5 leading-relaxed">
          Calm appearance for low light.
        </span>
      </div>
      <button
        onClick={() =>
          onUpdateSettings('theme', theme === 'light' ? 'dark' : 'light')
        }
        className={`relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0 ${
          theme === 'dark' ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
            theme === 'dark' ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
};

export default ThemeToggleSection;
