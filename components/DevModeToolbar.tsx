// components/DevModeToolbar.tsx
// Floating toolbar shown only in dev mode. Allows role switching, section
// navigation, and displays DB ping status.
import React, { useState, useEffect, useCallback } from 'react';
import { useDevMode, pingDatabase } from '../lib/devMode';

const MAX_VISIBLE_LOG_ENTRIES = 20;

interface DevModeToolbarProps {
  /** Current role */
  isSolo: boolean;
  /** Switch between single / couple */
  onToggleRole: () => void;
  /** Navigate to specific app sections */
  onGoToDashboard: () => void;
  onGoToOnboarding: () => void;
  onGoToSettings: () => void;
  onGoToTutorial: () => void;
  onGoToAddTransaction: () => void;
  /** Exit dev mode entirely */
  onExitDevMode: () => void;
}

const DevModeToolbar: React.FC<DevModeToolbarProps> = ({
  isSolo,
  onToggleRole,
  onGoToDashboard,
  onGoToOnboarding,
  onGoToSettings,
  onGoToTutorial,
  onGoToAddTransaction,
  onExitDevMode,
}) => {
  const { dbPingLog, clearPingLog } = useDevMode();
  const [expanded, setExpanded] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [pingStatus, setPingStatus] = useState<'idle' | 'pinging' | 'ok' | 'fail'>('idle');
  const [pingLatency, setPingLatency] = useState<number | null>(null);

  const handlePing = useCallback(async () => {
    setPingStatus('pinging');
    const result = await pingDatabase();
    setPingStatus(result.reachable ? 'ok' : 'fail');
    setPingLatency(result.latencyMs);
  }, []);

  // Auto-ping on mount
  useEffect(() => {
    handlePing();
  }, [handlePing]);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="fixed bottom-24 right-3 z-[200] w-11 h-11 rounded-full bg-amber-500 text-white shadow-lg shadow-amber-500/40 flex items-center justify-center text-lg font-black active:scale-90 transition-transform border-2 border-amber-400"
        title="Dev Mode"
      >
        🛠
      </button>
    );
  }

  const Btn: React.FC<{
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
  }> = ({ onClick, children, className = '' }) => (
    <button
      onClick={onClick}
      className={`w-full py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 ${className}`}
    >
      {children}
    </button>
  );

  return (
    <div className="fixed bottom-20 right-3 z-[200] w-64 bg-slate-900/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-amber-500/40 text-white overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-amber-500/20 border-b border-amber-500/20">
        <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">
          🛠 Dev Mode
        </span>
        <button
          onClick={() => setExpanded(false)}
          className="p-1 hover:bg-white/10 rounded-lg active:scale-90 transition-transform"
        >
          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      <div className="p-3 space-y-2">
        {/* Role toggle */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider flex-shrink-0">Role:</span>
          <button
            onClick={onToggleRole}
            className={`flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-center transition-all active:scale-95 ${
              isSolo
                ? 'bg-slate-700 text-slate-200 border border-slate-600'
                : 'bg-emerald-900/50 text-emerald-400 border border-emerald-700'
            }`}
          >
            {isSolo ? '👤 Single' : '👥 Couple'}
          </button>
        </div>

        {/* Section navigation */}
        <div className="grid grid-cols-2 gap-1.5">
          <Btn onClick={onGoToDashboard} className="bg-emerald-900/40 text-emerald-300 border border-emerald-800/50">
            Dashboard
          </Btn>
          <Btn onClick={onGoToOnboarding} className="bg-blue-900/40 text-blue-300 border border-blue-800/50">
            Onboarding
          </Btn>
          <Btn onClick={onGoToSettings} className="bg-purple-900/40 text-purple-300 border border-purple-800/50">
            Settings
          </Btn>
          <Btn onClick={onGoToTutorial} className="bg-indigo-900/40 text-indigo-300 border border-indigo-800/50">
            Tutorial
          </Btn>
          <Btn onClick={onGoToAddTransaction} className="bg-teal-900/40 text-teal-300 border border-teal-800/50 col-span-2">
            + Add Transaction
          </Btn>
        </div>

        {/* DB Ping */}
        <div className="flex items-center gap-2">
          <button
            onClick={handlePing}
            className="flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700 active:scale-95 transition-all"
          >
            {pingStatus === 'pinging' ? '⏳ Pinging...' : '🔌 Ping DB'}
          </button>
          <span className={`text-[9px] font-bold ${
            pingStatus === 'ok' ? 'text-emerald-400' :
            pingStatus === 'fail' ? 'text-rose-400' :
            'text-slate-500'
          }`}>
            {pingStatus === 'ok' ? `✓ ${pingLatency}ms` :
             pingStatus === 'fail' ? '✗ Unreachable' :
             pingStatus === 'pinging' ? '...' : '—'}
          </span>
        </div>

        {/* DB log */}
        {dbPingLog.length > 0 && (
          <div>
            <button
              onClick={() => setShowLog(!showLog)}
              className="text-[9px] font-bold text-amber-400 uppercase tracking-wider hover:underline"
            >
              {showLog ? '▾ Hide' : '▸ Show'} DB Log ({dbPingLog.length})
            </button>
            {showLog && (
              <div className="mt-1 max-h-32 overflow-y-auto bg-slate-950 rounded-lg p-2 space-y-0.5 no-scrollbar">
                {dbPingLog.slice(-MAX_VISIBLE_LOG_ENTRIES).map((line, i) => (
                  <p key={i} className="text-[8px] font-mono text-slate-400 leading-tight">{line}</p>
                ))}
                <button
                  onClick={clearPingLog}
                  className="text-[8px] text-rose-400 font-bold uppercase mt-1 hover:underline"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        )}

        {/* Exit */}
        <Btn onClick={onExitDevMode} className="bg-rose-900/40 text-rose-300 border border-rose-800/50">
          Exit Dev Mode
        </Btn>
      </div>
    </div>
  );
};

export default DevModeToolbar;
