import React from 'react';
import type { DashboardUser } from '../DashboardSettingsModal';

interface VaultSharingSectionProps {
  user: DashboardUser | null | undefined;
  isLinkingPartner: boolean;
  partnerLinkEmail: string;
  onChangePartnerLinkEmail: (value: string) => void;
  onConnectPartner: () => void;
  onDisconnectPartner: () => void;
  onToggleLinkingPartner: (value: boolean) => void;
}

const VaultSharingSection: React.FC<VaultSharingSectionProps> = ({
  user,
  isLinkingPartner,
  partnerLinkEmail,
  onChangePartnerLinkEmail,
  onConnectPartner,
  onDisconnectPartner,
  onToggleLinkingPartner,
}) => {
  return (
    <div
      id="settings-sharing-container"
      className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60 space-y-4"
    >
      <div className="flex flex-col">
        <span className="font-black text-base text-slate-500 dark:text-slate-200 uppercase tracking-tight">
          Vault Sharing
        </span>
        <p className="text-[11px] text-slate-500 font-medium mt-1">
          Connect with a partner to view and manage your combined budget.
        </p>
      </div>

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
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Linked With
              </span>
              <span className="text-xs font-bold text-slate-500 dark:text-slate-200 truncate max-w-[160px]">
                {user.partnerEmail}
              </span>
            </div>
          </div>
          <button
            onClick={onDisconnectPartner}
            className="w-full py-4 bg-rose-50 dark:bg-rose-900/20 text-rose-500 text-[11px] font-black rounded-2xl hover:bg-rose-100 transition-colors uppercase tracking-widest"
          >
            Disconnect Partner
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {isLinkingPartner ? (
            <div className="space-y-3 animate-in slide-in-from-top-2 duration-300">
              <input
                autoFocus
                type="email"
                placeholder="Partner's email..."
                value={partnerLinkEmail}
                onChange={(e) => onChangePartnerLinkEmail(e.target.value)}
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl py-4 px-5 text-sm font-bold text-slate-600 dark:text-slate-100 outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
              <div className="flex space-x-2">
                <button
                  disabled={!partnerLinkEmail.includes('@')}
                  onClick={onConnectPartner}
                  className="flex-1 py-4 bg-emerald-600 text-white text-[11px] font-black rounded-2xl shadow-lg shadow-emerald-500/10 active:scale-95 transition-all uppercase tracking-widest disabled:opacity-30"
                >
                  Send Request
                </button>
                <button
                  onClick={() => {
                    onToggleLinkingPartner(false);
                    onChangePartnerLinkEmail('');
                  }}
                  className="px-6 py-4 bg-slate-100 dark:bg-slate-700 text-slate-400 text-[11px] font-black rounded-2xl active:scale-95 transition-all uppercase tracking-widest"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => onToggleLinkingPartner(true)}
              className="w-full py-5 bg-white dark:bg-slate-900 border-2 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[11px] font-black rounded-2xl hover:bg-emerald-50 transition-colors uppercase tracking-[0.15em] shadow-sm active:scale-95"
            >
              + Link a Partner
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default VaultSharingSection;
