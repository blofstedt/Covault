import type { AppState } from '../../types';

/** One contract for account defaults, used by both App startup and auth changes. */
export const DEFAULT_SETTINGS = {
  rolloverEnabled: true,
  rolloverOverspend: false,
  useLeisureAsBuffer: true,
  showSavingsInsight: true,
  // Dark unless the user has said otherwise. A stored device preference still wins.
  theme: 'dark' as const,
  notificationsEnabled: false,
  app_notifications_enabled: false,
  hiddenCategories: [] as string[],
  smart_notifications_enabled: true,
  // Filing captures automatically must remain a deliberate choice.
  auto_accept_known_vendors: false,
  // Light feedback on a deliberate action is on by default.
  haptics_enabled: true,
  community_rules_enabled: true,
  community_rules_contribute: false,
  shareLevel: 'transactions' as const,
  budgetMode: 'separate' as const,
} satisfies AppState['settings'];

/** Keep preferences tied to this device while dropping the previous account's settings. */
export function resetSettingsForAccount(settings: AppState['settings']): AppState['settings'] {
  return {
    ...DEFAULT_SETTINGS,
    theme: settings.theme,
    notificationsEnabled: settings.notificationsEnabled,
    haptics_enabled: settings.haptics_enabled,
  };
}
