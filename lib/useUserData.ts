// lib/useUserData.ts
// Facade hook that composes sub-hooks for data loading, transactions,
// household linking, and user settings.
import type { AppState } from '../types';
import { useDataLoading } from './hooks/useDataLoading';
import { useTransactionOps } from './hooks/useTransactionOps';
import { useHouseholdLinking } from './hooks/useHouseholdLinking';
import { useUserSettings } from './hooks/useUserSettings';

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
  const { categoriesLoaded, loadUserData, loadPendingTransactions } = useDataLoading({ setAppState, setDbError });

  const {
    handleAddTransaction,
    handleUpdateTransaction,
    handleDeleteTransaction,
    handleApprovePendingTransaction,
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
  } = useUserSettings({ appState, setAppState, setDbError });

  return {
    categoriesLoaded,
    loadUserData,
    loadPendingTransactions,
    handleAddTransaction,
    handleUpdateTransaction,
    handleDeleteTransaction,
    handleLinkPartner,
    handleUnlinkPartner,
    handleGenerateLinkCode,
    handleJoinWithCode,
    handleApprovePendingTransaction,
    handleClearApprovedTransactions,
    saveBudgetLimit,
    saveUserIncome,
    saveTheme,
    saveBudgetVisibility,
  };
};
