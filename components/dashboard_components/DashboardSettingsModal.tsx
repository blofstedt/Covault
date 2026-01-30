import React, { useRef } from 'react';
import IncomeSection from './settings_modal_components/IncomeSection';
import ThemeToggleSection from './settings_modal_components/ThemeToggleSection';
import RolloverSection from './settings_modal_components/RolloverSection';
import DiscretionaryShieldSection from './settings_modal_components/DiscretionaryShieldSection';
import VaultSharingSection from './settings_modal_components/VaultSharingSection';
import SupportFeedbackSection from './settings_modal_components/SupportFeedbackSection';
import SignOutSection from './settings_modal_components/SignOutSection';
import NotificationSettingsSection from './dashboard_components/settings_modal_components/NotificationSettingsSection;
  
export interface DashboardSettings {
  theme: string;
  rolloverEnabled: boolean;
  useLeisureAsBuffer: boolean;
  [key: string]: any;
}

export interface DashboardUser {
  id?: string;
  name?: string;
  monthlyIncome?: number;
  partnerEmail?: string;
  [key: string]: any;
}

export interface DashboardSettingsModalProps {
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
  onSignOut,
}) => {
  const settingsScrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="fixed inset-0 z-[110] bg-slate-900/40 backdrop-blur-lg flex items-center justify-center p-6 animate-in fade-in duration-300">
      <div
        ref={settingsScrollRef}
        className="w-full max-sm bg-white dark:bg-slate-900 rounded-[3rem] p-10 space-y-8 shadow-2xl animate-in zoom-in-95 duration-500 max-h-[85vh] overflow-y-auto no-scrollbar border border-slate-100 dark:border-slate-800/60"
      >
        {/* Header */}
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
          <IncomeSection
            isSharedAccount={isSharedAccount}
            user={user}
            onUpdateUserIncome={onUpdateUserIncome}
          />

          {/* Theme toggle */}
          <ThemeToggleSection
            theme={settings.theme}
            onUpdateSettings={onUpdateSettings}
          />

          {/* Budget rollover */}
          <RolloverSection
            rolloverEnabled={settings.rolloverEnabled}
            onUpdateSettings={onUpdateSettings}
          />

          {/* Discretionary Shield */}
          <DiscretionaryShieldSection
            useLeisureAsBuffer={settings.useLeisureAsBuffer}
            onUpdateSettings={onUpdateSettings}
          />

          {/* Vault sharing */}
          <VaultSharingSection
            user={user}
            isLinkingPartner={isLinkingPartner}
            partnerLinkEmail={partnerLinkEmail}
            onChangePartnerLinkEmail={onChangePartnerLinkEmail}
            onConnectPartner={onConnectPartner}
            onDisconnectPartner={onDisconnectPartner}
            onToggleLinkingPartner={onToggleLinkingPartner}
          />

          {/* Support & Feedback */}
          <SupportFeedbackSection />

          {/* Sign out */}
          <SignOutSection onSignOut={onSignOut} />

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
