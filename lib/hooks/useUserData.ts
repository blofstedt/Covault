// lib/useUserData.ts
// Facade hook that composes sub-hooks for data loading, transactions,
// household linking, and user settings.
import type React from 'react';
import type { AppState } from '../../types';
import { useDataLoading } from './useDataLoading';
import { useTransactionOps } from './useTransactionOps';
import { useHouseholdLinking } from './useHouseholdLinking';
import { useUserSettings } from './useUserSettings';

interface UseUserDataParams {
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  setDbError: (msg: string | null) => void;
}

export const useUserData = ({
  appState,
  setAppState,
  setDbError,
}: UseUserDataParams) => {
  const { categoriesLoaded, loadUserData, loadPendingTransactions, loadTransactions } = useDataLoading({ setAppState, setDbError });

  const {
    handleAddTransaction,
    handleUpdateTransaction,
    handleDeleteTransaction,
    handleApprovePendingTransaction,
    handleRejectPendingTransaction,
    handleClearFilteredNotifications,
    handleClearApprovedTransactions,
  } = useTransactionOps({ appState, setAppState, setDbError, categoriesLoaded });

  const {
    handleGenerateLinkCode,
    handleJoinWithCode,
    handleLinkPartner,
    handleUnlinkPartner,
  } = useHouseholdLinking({ appState, setAppState, setDbError });

  const {
    saveBudgetLimit,
    saveUserIncome,
    saveTheme,
    saveBudgetVisibility,
    saveSettingToDb,
  } = useUserSettings({ appState, setAppState, setDbError });

  return {
    categoriesLoaded,
    loadUserData,
    loadPendingTransactions,
    loadTransactions,
    handleAddTransaction,
    handleUpdateTransaction,
    handleDeleteTransaction,
    handleLinkPartner,
    handleUnlinkPartner,
    handleGenerateLinkCode,
    handleJoinWithCode,
    handleApprovePendingTransaction,
    handleRejectPendingTransaction,
    handleClearFilteredNotifications,
    handleClearApprovedTransactions,
    saveBudgetLimit,
    saveUserIncome,
    saveTheme,
    saveBudgetVisibility,
    saveSettingToDb,
  };
};
