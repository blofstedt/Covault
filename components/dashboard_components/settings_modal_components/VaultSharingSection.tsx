import React, { useState } from 'react';
import type { DashboardUser } from '../DashboardSettingsModal';
import SettingsCard from '../../ui/SettingsCard';
import SectionHeader from '../../ui/SectionHeader';
import ConfirmModal from '../../ui/ConfirmModal';
import {
  SHARE_LEVELS,
  SHARE_LEVEL_COPY,
  BUDGET_MODE_COPY,
  type ShareLevel,
  type BudgetMode,
} from '../../../lib/householdSharing';

interface VaultSharingSectionProps {
  user: DashboardUser | null | undefined;
  /** Mints a fresh code on this account and returns it to show. */
  onGenerateLinkCode: () => Promise<string | null>;
  /** Claims the code the partner read out. */
  onJoinWithCode: (code: string) => Promise<{ ok: boolean; message?: string }>;
  onDisconnectPartner: () => void;
  /** How much of your spending they see. Yours alone; see householdSharing. */
  shareLevel: ShareLevel;
  onChangeShareLevel: (level: ShareLevel) => void;
  /** Whose budget lines the vials draw. Written to both rows. */
  budgetMode: BudgetMode;
  onChangeBudgetMode: (mode: BudgetMode) => void;
}

/**
 * Linking two households, by a code one of them reads out to the other.
 *
 * There used to be a second route here: type your partner's email address and
 * both accounts were linked on the spot. Nobody was asked and nobody was told,
 * so anyone who knew a Covault user's email could attach themselves to that
 * account and read its transactions and budgets. It is gone.
 *
 * The code is the whole mechanism and the whole consent: it exists only on the
 * other person's screen, so there is no way to get one without asking them for
 * it, and asking IS the permission.
 */
const VaultSharingSection: React.FC<VaultSharingSectionProps> = ({
  user,
  onGenerateLinkCode,
  onJoinWithCode,
  onDisconnectPartner,
  shareLevel,
  onChangeShareLevel,
  budgetMode,
  onChangeBudgetMode,
}) => {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [myCode, setMyCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [entered, setEntered] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleShowCode = async () => {
    setGenerating(true);
    setJoinError(null);
    try {
      setMyCode(await onGenerateLinkCode());
    } finally {
      setGenerating(false);
    }
  };

  const handleJoin = async () => {
    const code = entered.trim().toUpperCase();
    if (!code || joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      const result = await onJoinWithCode(code);
      if (!result.ok) {
        setJoinError(result.message || 'That code is not valid.');
        return;
      }
      setEntered('');
    } finally {
      setJoining(false);
    }
  };

  return (
    <SettingsCard id="settings-sharing-container" className="space-y-4">
      <SectionHeader
        title="Vault Sharing"
        subtitle="Share one budget with your partner. One of you shows a code, the other enters it."
      />

      {user?.partnerEmail ? (
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="flex items-center p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800">
            <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center mr-4">
              <svg
                className="w-5 h-5 text-emerald-600 dark:text-emerald-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-semibold text-slate-400 tracking-wide">
                Linked With
              </span>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-200 truncate max-w-[160px]">
                {user.partnerEmail}
              </span>
            </div>
          </div>
          {/* ── Whose budgets ──
              A property of the household, so changing it moves both phones.
              Two people looking at differently-shaped dashboards for the same
              money is the confusion this ends. */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase">
              Budgets
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(['separate', 'combined'] as BudgetMode[]).map((mode) => {
                const active = budgetMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => onChangeBudgetMode(mode)}
                    aria-pressed={active}
                    className={`text-left p-3 rounded-2xl border transition-all duration-200 active:scale-[0.98] ${
                      active
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/50'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700/50'
                    }`}
                  >
                    <span className={`block text-[11px] font-bold ${
                      active ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'
                    }`}>
                      {BUDGET_MODE_COPY[mode].title}
                    </span>
                    <span className="block text-[10px] text-slate-400 dark:text-slate-500 leading-snug mt-1">
                      {BUDGET_MODE_COPY[mode].blurb}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug">
              Either way the balance at the top is the household's — both incomes,
              both people's spending.
            </p>
          </div>

          {/* ── How much they see ──
              Yours alone and deliberately not symmetric: it is your data, and a
              setting that only worked if both agreed would be a negotiation
              rather than a choice. Enforced in the database — below "every
              purchase" your rows are refused to them outright. */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold tracking-wide text-slate-400 dark:text-slate-500 uppercase">
              What {user.partnerName || 'they'} can see of your spending
            </p>
            <div className="space-y-1.5">
              {SHARE_LEVELS.map((level, i) => {
                const active = shareLevel === level;
                return (
                  <button
                    key={level}
                    onClick={() => onChangeShareLevel(level)}
                    aria-pressed={active}
                    className={`w-full text-left flex items-start gap-3 p-3 rounded-2xl border transition-all duration-200 active:scale-[0.99] ${
                      active
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-700/50'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700/50'
                    }`}
                  >
                    {/* A rung on a ladder rather than a checkbox: these are
                        degrees of one thing, and the order is what says so. */}
                    <span className="flex flex-col items-center pt-0.5 shrink-0">
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        active ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
                      }`} />
                      {i < SHARE_LEVELS.length - 1 && (
                        <span className="w-px flex-1 min-h-[16px] bg-slate-200 dark:bg-slate-700 mt-1" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-[11px] font-bold ${
                        active ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-600 dark:text-slate-300'
                      }`}>
                        {SHARE_LEVEL_COPY[level].title}
                      </span>
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500 leading-snug mt-0.5">
                        {SHARE_LEVEL_COPY[level].blurb}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-snug">
              Yours to set on your own — they choose separately what you see of
              theirs. Your budget totals are always part of the household figure
              whichever you pick.
            </p>
          </div>

          <button
            onClick={() => setConfirmDisconnect(true)}
            className="w-full py-4 bg-rose-50 dark:bg-rose-900/20 text-rose-500 text-xs font-semibold rounded-2xl hover:bg-rose-100 transition-all duration-200 tracking-wide"
          >
            Disconnect Partner
          </button>

          {confirmDisconnect && (
            <ConfirmModal
              title="Disconnect your partner?"
              message={`You and ${user.partnerEmail} would stop seeing each other's transactions and budgets straight away. Nothing is deleted — but reconnecting means one of you showing a code and the other entering it again.`}
              confirmLabel="Disconnect"
              cancelLabel="Stay connected"
              variant="danger"
              onConfirm={() => {
                setConfirmDisconnect(false);
                onDisconnectPartner();
              }}
              onCancel={() => setConfirmDisconnect(false)}
            />
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* ── Your code, for the partner to type ── */}
          {myCode ? (
            <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 text-center space-y-1.5 animate-in fade-in duration-300">
              <p className="text-[10px] font-semibold tracking-widest uppercase text-slate-400 dark:text-slate-500">
                Your code
              </p>
              <p className="text-2xl font-bold tracking-[0.2em] text-emerald-600 dark:text-emerald-400">
                {myCode}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-snug">
                Read this out to your partner and have them enter it on their phone.
                It works once.
              </p>
            </div>
          ) : (
            <button
              onClick={handleShowCode}
              disabled={generating}
              className="w-full py-5 bg-white dark:bg-slate-900 border-2 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold rounded-2xl hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-all duration-200 tracking-wide shadow-sm active:scale-[0.97] disabled:opacity-50"
            >
              {generating ? 'Getting your code…' : 'Show my code'}
            </button>
          )}

          {/* ── Their code, for you to type ── */}
          <div className="space-y-2">
            <input
              inputMode="text"
              autoCapitalize="characters"
              placeholder="Enter your partner's code"
              value={entered}
              onChange={(e) => { setEntered(e.target.value.toUpperCase()); setJoinError(null); }}
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl py-4 px-5 text-sm font-bold tracking-[0.15em] text-center text-slate-600 dark:text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/20 placeholder:tracking-normal placeholder:font-semibold"
            />
            {entered.trim().length > 0 && (
              <button
                onClick={handleJoin}
                disabled={joining}
                className="w-full py-4 bg-emerald-600 text-white text-xs font-semibold rounded-2xl shadow-lg shadow-emerald-500/10 active:scale-[0.97] transition-all duration-200 tracking-wide disabled:opacity-40 animate-in fade-in duration-200"
              >
                {joining ? 'Linking…' : 'Link with this code'}
              </button>
            )}
            {joinError && (
              <p className="text-[11px] font-semibold text-rose-500 leading-snug px-1">
                {joinError}
              </p>
            )}
          </div>
        </div>
      )}
    </SettingsCard>
  );
};

export default VaultSharingSection;
