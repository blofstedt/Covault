import React from 'react';

interface PageShellProps {
  children: React.ReactNode;
  showGlow?: boolean;
}

const PageShell: React.FC<PageShellProps> = ({ children }) => (
  <div className="flex-1 flex flex-col h-screen h-[100dvh] relative overflow-hidden transition-colors duration-700 bg-slate-50 dark:bg-slate-950">
    {/* Ambient glow blobs — no bounding box, fade naturally via blur */}
    <div className="absolute w-80 h-80 rounded-full blur-[120px] pointer-events-none z-0 animate-blob translate-x-20 -translate-y-16 bg-emerald-400/20 dark:bg-emerald-500/30" style={{ top: '-2rem', left: '10%' }} />
    <div className="absolute w-72 h-72 rounded-full blur-[110px] pointer-events-none z-0 animate-blob animation-delay-4000 -translate-x-24 translate-y-8 bg-green-300/15 dark:bg-green-400/25" style={{ top: '-1rem', right: '5%' }} />
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
