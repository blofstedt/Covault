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
        <div className="w-80 h-80 rounded-full blur-[90px] animate-blob translate-x-20 -translate-y-16 transition-colors duration-1000 bg-emerald-400/20 dark:bg-emerald-500/30"></div>
        <div className="w-72 h-72 rounded-full blur-[80px] animate-blob animation-delay-4000 -translate-x-24 translate-y-8 transition-colors duration-1000 bg-green-300/15 dark:bg-green-400/25"></div>
      </div>
    )}
    {/* Subtle noise texture overlay */}
    <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.025] dark:opacity-[0.04]" style={{
      backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
      backgroundRepeat: 'repeat',
      backgroundSize: '256px 256px',
    }} />
    {children}
  </div>
);

export default PageShell;
