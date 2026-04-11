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
import BudgetLimitsSection from './settings_modal_components/BudgetLimitsSection';
import ExportTransactionsSection from './settings_modal_components/ExportTransactionsSection';
import ImportTransactionsSection from './settings_modal_components/ImportTransactionsSection';
import SmartCardSettingsSection from './settings_modal_components/SmartCardSettingsSection';
import ReportSection from './settings_modal_components/ReportSection';
import { BudgetCategory, Transaction } from '../../types';
import PremiumGate from '../PremiumGate';
import { CloseButton } from '../shared';

export interface DashboardSettings {
  theme: string;
  rolloverEnabled: boolean;
  useLeisureAsBuffer: boolean;
  notificationsEnabled?: boolean;
  app_notifications_enabled?: boolean;
  smart_cards_enabled?: boolean;
  smart_notifications_enabled?: boolean;

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
  isLinkingPartner: boolean;
  partnerLinkEmail: string;
  budgets: BudgetCategory[];
  transactions: Transaction[];
  onChangePartnerLinkEmail: (value: string) => void;
  onClose: () => void;
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
  onImportComplete?: () => void;
}

const DashboardSettingsModal: React.FC<DashboardSettingsModalProps> = ({
  isSharedAccount,
  settings,
  user,
  isLinkingPartner,
  partnerLinkEmail,
  budgets,
  transactions,
  onChangePartnerLinkEmail,
  onClose,
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
  onImportComplete,
}) => {
  const settingsScrollRef = useRef<HTMLDivElement>(null);
  const [showFAQ, setShowFAQ] = useState(false);

  return (
    <div className="fixed inset-0 z-[110] bg-slate-900/40 backdrop-blur-lg flex items-center justify-center p-6 animate-in fade-in duration-300">
      <div
        ref={settingsScrollRef}
        className="w-full max-w-lg lg:max-w-2xl bg-white dark:bg-slate-900 rounded-[3rem] p-10 space-y-8 shadow-2xl animate-in zoom-in-95 duration-500 max-h-[85vh] overflow-y-auto no-scrollbar border ring-1 ring-inset ring-white/10 dark:ring-white/[0.04] border-slate-100 dark:border-slate-800/60"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-600 dark:text-slate-100 tracking-tight">
            Vault Settings
          </h2>
          <div className="flex items-center space-x-2">
            <CloseButton onClick={onClose} />
          </div>
        </div>

        <div className="space-y-4">
          {/* Frequently Asked */}
          <button
            id="faq-button"
            onClick={() => setShowFAQ(true)}
            className="w-full py-5 bg-slate-50 dark:bg-slate-800/30 border-2 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs font-semibold rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-all duration-200 tracking-wide shadow-sm active:scale-[0.98]"
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

          {/* Budget rollover */}
          <RolloverSection
            rolloverEnabled={settings.rolloverEnabled}
            onUpdateSettings={onUpdateSettings}
          />

          {/* Smart Insights */}
          <SmartCardSettingsSection
            smartCardsEnabled={settings.smart_cards_enabled ?? true}
            smartNotificationsEnabled={settings.smart_notifications_enabled ?? true}
            onToggleSmartCards={() => onUpdateSettings('smart_cards_enabled', !settings.smart_cards_enabled)}
            onToggleSmartNotifications={() => onUpdateSettings('smart_notifications_enabled', !settings.smart_notifications_enabled)}
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

          {/* Import Transactions */}
          <ImportTransactionsSection
            budgets={budgets}
            userId={user?.id}
            onImportComplete={onImportComplete || (() => {})}
          />

          {/* Budget Report */}
          <ReportSection />

          {/* Support & Feedback — only feature requests are premium */}
          <SupportFeedbackSection hasPremium={hasPremium} onSubscribe={onSubscribe} />

          {/* Sign out */}
          <SignOutSection onSignOut={onSignOut} />

          {/* Version */}
          <div className="text-center pt-4">
            <p className="text-[10px] font-medium text-slate-400 dark:text-slate-700 tracking-wide">
              Version 3.0 · Covault
            </p>
          </div>
        </div>
      </div>

      {showFAQ && <FAQModal onClose={() => setShowFAQ(false)} />}
    </div>
  );
};

export default DashboardSettingsModal;
