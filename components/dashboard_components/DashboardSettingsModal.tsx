import React, { useRef, useState } from 'react';
import IncomeSection from './settings_modal_components/IncomeSection';
import ThemeToggleSection from './settings_modal_components/ThemeToggleSection';
import RolloverSection from './settings_modal_components/RolloverSection';
import DiscretionaryShieldSection from './settings_modal_components/DiscretionaryShieldSection';
import VaultSharingSection from './settings_modal_components/VaultSharingSection';
import SupportFeedbackSection from './settings_modal_components/SupportFeedbackSection';
import SignOutSection from './settings_modal_components/SignOutSection';
import NotificationSettingsSection from './settings_modal_components/NotificationSettingsSection';
import AppNotificationsSection from './settings_modal_components/AppNotificationsSection';
import BudgetLimitsSection from './settings_modal_components/BudgetLimitsSection';
import { BudgetCategory } from '../../types';

export interface DashboardSettings {
  theme: string;
  rolloverEnabled: boolean;
  useLeisureAsBuffer: boolean;
  app_notifications_enabled?: boolean; // <-- Correct key
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
  budgets: BudgetCategory[];
  onChangePartnerLinkEmail: (value: string) => void;
  onClose: () => void;
  onRunTutorial: () => void;
  onUpdateSettings: (key: string, value: any) => void;
  onUpdateUserIncome: (income: number) => void;
  onConnectPartner: () => void;
  onDisconnectPartner: () => void;
  onToggleLinkingPartner: (value: boolean) => void;
  onSignOut: () => void;
  onSaveBudgetLimit: (categoryId: string, newLimit: number) => void;
}

const DashboardSettingsModal: React.FC<DashboardSettingsModalProps> = ({
  isSharedAccount,
  settings,
  user,
  showTutorial,
  isLinkingPartner,
  partnerLinkEmail,
  budgets,
  onChangePartnerLinkEmail,
  onClose,
  onRunTutorial,
  onUpdateSettings,
  onUpdateUserIncome,
  onConnectPartner,
  onDisconnectPartner,
  onToggleLinkingPartner,
  onSignOut,
  onSaveBudgetLimit,
}) => {
  const settingsScrollRef = useRef<HTMLDivElement>(null);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);

  const handleOpenAdvancedPermissions = () => {
    setShowOverflowMenu(false);
    // Scroll to the notification settings section and flash it to draw attention
    const notifSection = document.getElementById('settings-notifications-container');
    if (notifSection) {
      notifSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      notifSection.classList.add('ring-2', 'ring-emerald-500', 'ring-offset-2');
      setTimeout(() => {
        notifSection.classList.remove('ring-2', 'ring-emerald-500', 'ring-offset-2');
      }, 2000);
    }
  };

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
          <div className="flex items-center space-x-2">
            {/* Three-dot overflow menu for advanced permissions */}
            <div className="relative">
              <button
                disabled={showTutorial}
                onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                className={`p-2.5 bg-slate-100 dark:bg-slate-800 rounded-full transition-transform active:scale-90 ${
                  showTutorial ? 'opacity-20 cursor-not-allowed' : ''
                }`}
                aria-label="More options"
              >
                <svg
                  className="w-6 h-6 text-slate-500"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <circle cx="12" cy="5" r="2" />
                  <circle cx="12" cy="12" r="2" />
                  <circle cx="12" cy="19" r="2" />
                </svg>
              </button>

              {/* Dropdown menu */}
              {showOverflowMenu && (
                <>
                  <div
                    className="fixed inset-0 z-[10]"
                    onClick={() => setShowOverflowMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-2 z-[20] bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-100 dark:border-slate-700 py-2 min-w-[220px] animate-in fade-in slide-in-from-top-1 duration-200">
                    <button
                      onClick={handleOpenAdvancedPermissions}
                      className="w-full flex items-center space-x-3 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left active:scale-[0.98]"
                    >
                      <svg
                        className="w-5 h-5 text-emerald-500 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      <div className="flex flex-col">
                        <span className="text-[11px] font-black text-slate-600 dark:text-slate-200 uppercase tracking-wider">
                          Advanced Permissions
                        </span>
                        <span className="text-[9px] font-medium text-slate-400 dark:text-slate-500 mt-0.5">
                          Notification read &amp; write access
                        </span>
                      </div>
                    </button>
                  </div>
                </>
              )}
            </div>

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

          {/* Budget Limits */}
          <BudgetLimitsSection
            budgets={budgets}
            onSaveBudgetLimit={onSaveBudgetLimit}
            showTutorial={showTutorial}
          />

          {/* Theme toggle */}
          <ThemeToggleSection
            theme={settings.theme}
            onUpdateSettings={onUpdateSettings}
          />

          {/* Bank Notification Listener */}
          <NotificationSettingsSection />

          {/* App Notifications */}
          <AppNotificationsSection
            enabled={!!settings.app_notifications_enabled}
            onToggle={(v) => onUpdateSettings('app_notifications_enabled', v)}
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
