// app/data/types.ts
import type React from 'react';
import type { AppState } from '../types';
import type { AccountDataScopeRef } from '../lib/auth/accountScope';

export interface UseUserDataParams {
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  setDbError: (msg: string | null) => void;
  accountScopeRef?: AccountDataScopeRef;
}
