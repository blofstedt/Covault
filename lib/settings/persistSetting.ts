import { restFetch } from '../apiHelpers';
import type { SettingValue } from './settingSaveQueue';

type Request = (path: string, init: RequestInit) => Promise<Response>;

/** A PATCH is saved only when the server returns at least one changed row. */
export async function persistSetting(
  userId: string,
  column: string,
  value: SettingValue,
  request: Request = restFetch,
): Promise<void> {
  const response = await request(`/settings?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ [column]: value }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${column} failed (${response.status}): ${body.slice(0, 200)}`);
  }

  const updatedRows: unknown = await response.json();
  if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
    throw new Error(`${column} updated no settings row`);
  }
}
