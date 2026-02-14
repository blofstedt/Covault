import React, { useRef, useState } from 'react';
import IncomeSection from './settings_modal_components/IncomeSection';
import FAQModal from './FAQModal';
import ThemeToggleSection from './settings_modal_components/ThemeToggleSection';
import RolloverSection from './settings_modal_components/RolloverSection';
import DiscretionaryShieldSection from './settings_modal_components/DiscretionaryShieldSection';
import VaultSharingSection from './settings_modal_components/VaultSharingSection';
import SupportFeedbackSection from './settings_modal_components/SupportFeedbackSection';
import SignOutSection from './settings_modal_components/SignOutSection';
import NotificationSettingsSection from './settings_modal_components/NotificationSettingsSection';
import NotificationRulesSection from './settings_modal_components/NotificationRulesSection';
import BudgetLimitsSection from './settings_modal_components/BudgetLimitsSection';
import ExportTransactionsSection from './settings_modal_components/ExportTransactionsSection';
import ReportSection from './settings_modal_components/ReportSection';
import { BudgetCategory, Transaction, NotificationRule } from '../../types';
import PremiumGate from '../PremiumGate';
import { CloseButton } from '../shared';

export interface DashboardSettings {
  theme: string;
  rolloverEnabled: boolean;
  useLeisureAsBuffer: boolean;
  notificationsEnabled?: boolean;
  app_notifications_enabled?: boolean;
  notification_rules?: NotificationRule[];

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
  transactions: Transaction[];
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
  saveBudgetVisibility: (categoryId: string, visible: boolean) => void;
  hasPremium: boolean;
  onSubscribe: () => void;
}

const DashboardSettingsModal: React.FC<DashboardSettingsModalProps> = ({
  isSharedAccount,
  settings,
  user,
  showTutorial,
  isLinkingPartner,
  partnerLinkEmail,
  budgets,
  transactions,
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
  saveBudgetVisibility,
  hasPremium,
  onSubscribe,
}) => {
  const settingsScrollRef = useRef<HTMLDivElement>(null);
  const [showFAQ, setShowFAQ] = useState(false);

  return (
    <div className="fixed inset-0 z-[110] bg-slate-900/40 backdrop-blur-lg flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div
        ref={settingsScrollRef}
        className="w-full max-w-lg bg-slate-50 dark:bg-slate-950 rounded-[2.5rem] p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-500 max-h-[85vh] overflow-y-auto no-scrollbar border border-slate-200/30 dark:border-white/10"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-2">
          <h2 className="text-xl font-black text-slate-500 dark:text-slate-100 tracking-tight uppercase">
            Vault Settings
          </h2>
          <div className="flex items-center space-x-2">
            <CloseButton onClick={onClose} disabled={showTutorial} />
          </div>
        </div>

        <div className="space-y-4">
          {/* Run Tutorial */}
          <button
            id="run-tutorial-button"
            onClick={onRunTutorial}
            className="w-full py-5 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/40 text-emerald-600 dark:text-emerald-400 text-xs font-black rounded-[2.5rem] hover:bg-emerald-50 transition-colors uppercase tracking-[0.2em] shadow-xl active:scale-95"
          >
            Run Tutorial
          </button>

          {/* Frequently Asked */}
          <button
            id="faq-button"
            onClick={() => setShowFAQ(true)}
            className="w-full py-5 bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800/60 text-slate-500 dark:text-slate-400 text-xs font-black rounded-[2.5rem] hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors uppercase tracking-[0.2em] shadow-xl active:scale-95"
          >
            Frequently Asked
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
            hiddenCategories={settings.hiddenCategories || []}
            monthlyIncome={user?.monthlyIncome}
            onToggleHideCategory={(categoryId: string) => {
              const current: string[] = settings.hiddenCategories || [];
              const isCurrentlyHidden = current.includes(categoryId);
              // Persist visibility to Supabase
              saveBudgetVisibility(categoryId, isCurrentlyHidden);
            }}
          />

          {/* Theme toggle */}
          <ThemeToggleSection
            theme={settings.theme}
            onUpdateSettings={onUpdateSettings}
          />

          {/* Bank Notification Listener — Premium */}
          <PremiumGate hasPremium={hasPremium} onSubscribe={onSubscribe}>
            <NotificationSettingsSection
              enabled={!!settings.notificationsEnabled}
              onToggle={(v) => onUpdateSettings('notificationsEnabled', v)}
            />
          </PremiumGate>

          {/* Notification Rules — Premium */}
          <PremiumGate hasPremium={hasPremium} onSubscribe={onSubscribe}>
            <NotificationRulesSection
              enabled={!!settings.app_notifications_enabled}
              onToggle={(v) => onUpdateSettings('app_notifications_enabled', v)}
              rules={settings.notification_rules || []}
              onUpdateRules={(rules) => onUpdateSettings('notification_rules', rules)}
              budgets={budgets}
              transactions={transactions}
            />
          </PremiumGate>

          {/* Budget rollover */}
          <RolloverSection
            rolloverEnabled={settings.rolloverEnabled}
            onUpdateSettings={onUpdateSettings}
          />

          {/* Discretionary Shield — Premium */}
          <PremiumGate hasPremium={hasPremium} onSubscribe={onSubscribe}>
            <DiscretionaryShieldSection
              useLeisureAsBuffer={settings.useLeisureAsBuffer}
              onUpdateSettings={onUpdateSettings}
            />
          </PremiumGate>

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

          {/* Export Transactions */}
          <ExportTransactionsSection transactions={transactions} budgets={budgets} />

          {/* Budget Report */}
          <ReportSection />

          {/* Support & Feedback — only feature requests are premium */}
          <SupportFeedbackSection hasPremium={hasPremium} onSubscribe={onSubscribe} />

          {/* Sign out */}
          <SignOutSection onSignOut={onSignOut} />

          {/* Version */}
          <div className="text-center pt-4">
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-700 uppercase tracking-[0.1em]">
              Version 3.0 • Covault simplified
            </p>
          </div>
        </div>
      </div>

      {showFAQ && <FAQModal onClose={() => setShowFAQ(false)} />}
    </div>
  );
};

export default DashboardSettingsModal;
