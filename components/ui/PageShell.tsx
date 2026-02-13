import React from 'react';

interface PageShellProps {
  children: React.ReactNode;
  showGlow?: boolean;
}

/**
 * Shared page shell providing the consistent full-screen layout
 * with background glow used by Dashboard and Transaction Parsing pages.
 */
const PageShell: React.FC<PageShellProps> = ({ children, showGlow = true }) => (
  <div className="flex-1 flex flex-col h-screen relative overflow-hidden transition-colors duration-700 bg-slate-50 dark:bg-slate-950">
    {showGlow && (
      <div className="absolute top-0 left-0 right-0 h-[320px] z-0 flex items-center justify-center pointer-events-none overflow-visible transition-opacity duration-700 animate-nest">
        <div className="w-80 h-80 rounded-full blur-[90px] animate-blob translate-x-20 -translate-y-16 transition-colors duration-1000 bg-emerald-400/25 dark:bg-emerald-500/35"></div>
        <div className="w-72 h-72 rounded-full blur-[80px] animate-blob animation-delay-4000 -translate-x-24 translate-y-8 transition-colors duration-1000 bg-green-300/20 dark:bg-green-400/30"></div>
      </div>
    )}
    {children}
  </div>
);

export default PageShell;
