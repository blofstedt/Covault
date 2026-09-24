import type { AppState } from '../../types';

type SettingValue = boolean | string | number;
type SaveColumn = (column: string, value: SettingValue) => Promise<void>;

// Only settings owned by a person's settings row belong here. Theme has its
// own save path, and budgetMode writes both household rows through an RPC.
const SETTING_DB_KEYS = {
  rolloverEnabled: 'rollover_enabled',
  useLeisureAsBuffer: 'leisure_buffer_enabled',
  showSavingsInsight: 'show_savings_insight',
  app_notifications_enabled: 'app_notifications_enabled',
  smart_notifications_enabled: 'smart_notifications_enabled',
  auto_accept_known_vendors: 'auto_accept_known_vendors',
  haptics_enabled: 'haptics_enabled',
  community_rules_enabled: 'community_rules_enabled',
  community_rules_contribute: 'community_rules_contribute',
  shareLevel: 'share_level',
} satisfies Partial<Record<keyof AppState['settings'], string>>;

export async function writeDashboardSetting(
  key: string,
  value: SettingValue,
  saveColumn: SaveColumn,
): Promise<void> {
  // This switch is kept on this phone and saved by App's local settings cache.
  if (key === 'notificationsEnabled') return;
  if (!Object.prototype.hasOwnProperty.call(SETTING_DB_KEYS, key)) {
    throw new Error(`No persistence path for dashboard setting: ${key}`);
  }
  const column = SETTING_DB_KEYS[key as keyof typeof SETTING_DB_KEYS];
  await saveColumn(column, value);
}
