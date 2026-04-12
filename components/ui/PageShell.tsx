import React from 'react';

interface PageShellProps {
  children: React.ReactNode;
  showGlow?: boolean;
}

const PageShell: React.FC<PageShellProps> = ({ children }) => (
  <div className="flex-1 flex flex-col h-screen h-[100dvh] relative overflow-hidden transition-colors duration-700 bg-slate-50 dark:bg-slate-950">
    {/* Ambient glow — radial gradients with multi-stop ultra-smooth falloff */}
    <div className="absolute inset-0 z-0 pointer-events-none" style={{
      backgroundImage: [
        'radial-gradient(ellipse 90% 70% at 30% -10%, var(--glow-1) 0%, var(--glow-1m) 30%, transparent 100%)',
        'radial-gradient(ellipse 80% 65% at 75% -10%, var(--glow-2) 0%, var(--glow-2m) 30%, transparent 100%)',
      ].join(', '),
    }}>
      <style>{`
        :root { --glow-1: rgba(52, 211, 153, 0.12); --glow-1m: rgba(52, 211, 153, 0.04); --glow-2: rgba(134, 239, 172, 0.08); --glow-2m: rgba(134, 239, 172, 0.02); }
        .dark { --glow-1: rgba(16, 185, 129, 0.18); --glow-1m: rgba(16, 185, 129, 0.06); --glow-2: rgba(74, 222, 128, 0.12); --glow-2m: rgba(74, 222, 128, 0.03); }
      `}</style>
    </div>
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
