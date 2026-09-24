// lib/useUserData.ts
// Facade hook that composes sub-hooks for data loading, transactions,
// household linking, and user settings.
import type React from 'react';
import type { AppState } from '../../types';
import { useDataLoading } from './useDataLoading';
import { useTransactionOps } from './useTransactionOps';
import { useHouseholdLinking } from './useHouseholdLinking';
import { useUserSettings } from './useUserSettings';
import { writeDashboardSetting } from '../settings/dashboardSettingWrite';

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
  const { categoriesLoaded, loadUserData, loadTransactions } = useDataLoading({ setAppState, setDbError });

  const {
    handleAddTransaction,
    handleUpdateTransaction,
    handleDeleteTransaction,
    handleClearApprovedTransactions,
  } = useTransactionOps({ appState, setAppState, setDbError, categoriesLoaded });

  const {
    handleGenerateLinkCode,
    handleJoinWithCode,
    handleUnlinkPartner,
  } = useHouseholdLinking({ appState, setAppState, setDbError });

  const {
    saveBudgetLimit,
    saveUserIncome,
    saveTheme,
    saveBudgetVisibility,
    saveSettingToDb,
  } = useUserSettings({ appState, setAppState, setDbError });

  const saveDashboardSetting = async (key: string, value: boolean | string | number) => {
    try {
      await writeDashboardSetting(key, value, saveSettingToDb);
    } catch (error) {
      setDbError('Could not save this setting. Please try again.');
      throw error;
    }
  };

  return {
    categoriesLoaded,
    loadUserData,
    loadTransactions,
    handleAddTransaction,
    handleUpdateTransaction,
    handleDeleteTransaction,
    handleUnlinkPartner,
    handleGenerateLinkCode,
    handleJoinWithCode,
    handleClearApprovedTransactions,
    saveBudgetLimit,
    saveUserIncome,
    saveTheme,
    saveBudgetVisibility,
    saveSettingToDb,
    saveDashboardSetting,
  };
};
