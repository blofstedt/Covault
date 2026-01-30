import React, { useRef } from 'react';

interface DashboardSettings {
  theme: string;
  rolloverEnabled: boolean;
  useLeisureAsBuffer: boolean;
  [key: string]: any;
}

interface DashboardUser {
  id?: string;
  name?: string;
  monthlyIncome?: number;
  partnerEmail?: string;
  [key: string]: any;
}

interface DashboardSettingsModalProps {
  isSharedAccount: boolean;
  settings: DashboardSettings;
  user: DashboardUser | null | undefined;
  showTutorial: boolean;
  isLinkingPartner: boolean;
  partnerLinkEmail: string;
  onChangePartnerLinkEmail: (value: string) => void;
  onClose: () => void;
  onRunTutorial: () => void;
  onUpdateSettings: (key: string, value: any) => void;
  onUpdateUserIncome: (income: number) => void;
  onConnectPartner: () => void;
  onDisconnectPartner: () => void;
  onToggleLinkingPartner: (value: boolean) => void;
  onSignOut: () => void;
}

const DashboardSettingsModal: React.FC<DashboardSettingsModalProps> = ({
  isSharedAccount,
  settings,
  user,
  showTutorial,
  isLinkingPartner,
  partnerLinkEmail,
  onChangePartnerLinkEmail,
  onClose,
  onRunTutorial,
  onUpdateSettings,
  onUpdateUserIncome,
  onConnectPartner,
  onDisconnectPartner,
  onToggleLinkingPartner,
  onSignOut
}) => {
  const settingsScrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="fixed inset-0 z-[110] bg-slate-900/40 backdrop-blur-lg flex items-center justify-center p-6 animate-in fade-in duration-300">
      <div
        ref={settingsScrollRef}
        className="w-full max-sm bg-white dark:bg-slate-900 rounded-[3rem] p-10 space-y-8 shadow-2xl animate-in zoom-in-95 duration-500 max-h-[85vh] overflow-y-auto no-scrollbar border border-slate-100 dark:border-slate-800/60"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">
            Vault Settings
          </h2>
          <button
            disabled={showTutorial}
            onClick={onClose}
            className={`p-2.5 bg-slate-100 dark:bg-slate-800 rounded-full transition-transform active:scale-90 ${
              showTutorial ? 'opacity-20 cursor-not-allowed' : ''
            }`}
          >
            <svg
              className="w-6 h-6 text-slate-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Run Tutorial */}
          <button
            onClick={onRunTutorial}
            className="w-full py-5 bg-emerald-50 dark:bg-emerald-900/20 border-2 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[11px] font-black rounded-2xl hover:bg-emerald-100 transition-colors uppercase tracking-[0.2em] shadow-sm active:scale-95"
          >
            Run Tutorial
          </button>

          {/* Income */}
          <div
            id="settings-income-container"
            className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60"
          >
            <div className="flex flex-col mb-4">
              <span className="font-black text-base text-slate-500 dark:text-slate-200 uppercase tracking-tight">
                {isSharedAccount ? 'My Monthly Income' : 'Monthly Income'}
              </span>
              <p className="text-[11px] text-slate-500 font-medium mt-1">
                {isSharedAccount
                  ? "Your income contribution. Your partner's income will be added automatically."
                  : 'This defines your total cash flow for the month.'}
              </p>
            </div>
            <div className="flex items-center space-x-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3">
              <span className="text-slate-400 font-black">$</span>
              <input
                type="number"
                value={user?.monthlyIncome || 0}
                onChange={(e) => onUpdateUserIncome(parseFloat(e.target.value) || 0)}
                className="bg-transparent w-full outline-none font-black text-slate-600 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Theme toggle */}
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
                onUpdateSettings(
                  'theme',
                  settings.theme === 'light' ? 'dark' : 'light'
                )
              }
              className={`w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-pointer ${
                settings.theme === 'dark'
                  ? 'bg-emerald-500'
                  : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <div
                className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${
                  settings.theme === 'dark' ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Budget rollover */}
          <div
            id="settings-rollover-container"
            className="flex items-center justify-between p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60"
          >
            <div className="flex flex-col">
              <span className="font-black text-base text-slate-500 dark:text-slate-200">
                Budget Rollover
              </span>
              <span className="text-xs text-slate-500 font-medium">
                Carry surplus to next month.
              </span>
            </div>
            <button
              onClick={() =>
                onUpdateSettings('rolloverEnabled', !settings.rolloverEnabled)
              }
              className={`w-14 h-8 rounded-full transition-colors relative flex items-center p-1 cursor-pointer ${
                settings.rolloverEnabled
                  ? 'bg-emerald-500'
                  : 'bg-slate-200 dark:bg-slate-700'
              }`}
            >
              <div
                className={`w-6 h-6 bg-white rounded-full shadow-lg transform transition-transform duration-300 ${
                  settings.rolloverEnabled ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Discretionary Shield */}
          <div
            id="settings-shield-container"
            className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800/60"
          >
            <div className="flex flex-col mb-4">
              <span className="font-black text-base text-slate-500 dark:text-slate-200 uppercase tracking-tight">
                Discretionary Shield
              </span>
              <p className="text-[11px] text-slate-500 font-medium mt-1">
                If a budget overspends, money from your Leisure vault will be automatically
                reallocated to cover it.
              </p>
            </div>
            <button
              onClick={() =>
                onUpdateSettings(
                  'useLeisureAsBuffer',
                  !settings.useLeisureAsBuffer
                )
              }
              className={`w-full py-4 text-xs font-black rounded-2xl transition-all border-2 ${
                settings.useLeisureAsBuffer
                  ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg'
                  : 'border-slate-200 dark:border-slate-700 text-slate-400'
              }`}
            >
              {settings.useLeisureAsBuffer ? 'SHIELD ACTIVE' : 'SHIELD OFF'}
            </button>
          </div>

          {/* Vault sharing */}
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

          {/* Support & Feedback */}
          <div className="pt-8 space-y-6">
            <div className="flex items-center justify-between px-2">
              <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
              <span className="text-[10px] font-black text-slate-300 dark:text-slate-600 uppercase tracking-[0.2em] px-4">
                Support &amp; Feedback
              </span>
              <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
            </div>
            <div className="space-y-3">
              <a
                id="report-problem-button"
                href="mailto:itsjustmyemail@gmail.com?subject=Covault: Problem Report"
                className="flex items-center p-5 bg-slate-50 dark:bg-slate-800/30 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm active:scale-[0.98] transition-all group"
              >
                <div className="w-10 h-10 bg-rose-50 dark:bg-rose-900/20 rounded-xl flex items-center justify-center mr-4 group-hover:scale-110 transition-transform">
                  <svg
                    className="w-5 h-5 text-rose-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap">
                  Report a Problem
                </span>
                <svg
                  className="w-4 h-4 ml-auto text-slate-300 dark:text-slate-700 group-hover:translate-x-1 transition-transform"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </a>

              <a
                id="request-feature-button"
                href="mailto:itsjustmyemail@gmail.com?subject=Covault: Feature Request"
                className="flex items-center p-5 bg-slate-50 dark:bg-slate-800/30 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm active:scale-[0.98] transition-all group"
              >
                <div className="w-10 h-10 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl flex items-center justify-center mr-4 group-hover:scale-110 transition-transform">
                  <svg
                    className="w-5 h-5 text-emerald-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-7.714 2.143L11 21l-2.286-6.857L1 12l7.714-2.143L11 3z"
                    />
                  </svg>
                </div>
                <span className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest whitespace-nowrap">
                  Request a Feature
                </span>
                <svg
                  className="w-4 h-4 ml-auto text-slate-300 dark:text-slate-700 group-hover:translate-x-1 transition-transform"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </a>
            </div>
          </div>

          {/* Sign out */}
          <button
            id="sign-out-button"
            onClick={onSignOut}
            className="w-full py-6 text-rose-500 font-black bg-rose-50 dark:bg-rose-900/20 rounded-3xl active:scale-95 transition-transform uppercase tracking-widest mt-6"
          >
            Sign Out
          </button>

          {/* Version */}
          <div className="text-center pt-4">
            <p className="text-[9px] font-bold text-slate-400 dark:text-slate-700 uppercase tracking-[0.1em]">
              Version 3.0 • Covault simplified
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardSettingsModal;
