// lib/hooks/types.ts
import type { AppState } from '../../types';

export interface UseUserDataParams {
  appState: AppState;
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  setDbError: (msg: string | null) => void;
}
