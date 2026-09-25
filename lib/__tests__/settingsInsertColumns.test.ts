/**
 * A settings row the client creates cannot be created already paid for.
 *
 * The UPDATE side of this was closed in 2026_09_security_review.sql; INSERT
 * was not, so an account whose settings row was missing could POST one with
 * `is_tester: true`. See 2026_09_settings_insert_columns.sql.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');
const migration = read('supabase/migrations/2026_09_settings_insert_columns.sql');
const settingsHook = read('lib/hooks/useUserSettings.ts');

const grantedColumns = (): string[] => {
  const match = migration.match(/GRANT INSERT \(([^)]*)\) ON public\.settings TO authenticated/);
  expect(match, 'the column grant should exist').not.toBeNull();
  return match![1].split(',').map((column) => column.trim());
};

describe('creating a settings row from the app', () => {
  it('takes the table grant away before handing columns back', () => {
    const revoke = migration.indexOf('REVOKE INSERT ON public.settings FROM authenticated');
    const grant = migration.indexOf('GRANT INSERT (');
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  it.each([
    'is_tester',
    'subscription_status',
    'trial_started_at',
    'trial_ends_at',
    'trial_consumed',
    'partner_id',
    'partner_name',
    'partner_email',
    'link_code',
    'link_code_expires_at',
    'budget_mode',
  ])('%s cannot be chosen by the client', (column) => {
    expect(grantedColumns()).not.toContain(column);
  });

  it("still allows every column the app's own create fallback sends", () => {
    const post = settingsHook.slice(settingsHook.indexOf("restFetch('/settings', {"));
    const body = post.slice(post.indexOf('JSON.stringify({') + 'JSON.stringify({'.length, post.indexOf('}),'));
    const sent = (body.match(/^\s*([a-z_]+):/gm) || []).map((line) => line.trim().replace(':', ''));
    expect(sent.length).toBeGreaterThan(0);
    for (const column of sent) expect(grantedColumns()).toContain(column);
  });
});
