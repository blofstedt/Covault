/**
 * The database side of account deletion.
 *
 * Proved for real before this was written — a disposable test account, one
 * row in every table a real account touches, a linked partner pointing at
 * it, then the deletion, then confirmation every row was gone and the
 * partner's own settings survived with the dangling reference cleared. What
 * these tests pin is the shape that made that true, so it stays true after
 * the next person edits this file: self-only, no argument to get wrong, and
 * the two tables that do NOT cascade from auth.users cleared by hand before
 * the auth row goes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(__dirname, '../../supabase/migrations/2026_09_delete_own_account.sql'),
  'utf8',
);

describe('delete_own_account', () => {
  it('takes no arguments and always acts on the caller, never an id passed in', () => {
    // Same shape as unlink_partner() and the two link_partner_by_* functions:
    // no parameter means no way to delete an account other than your own.
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.delete_own_account()');
    expect(migration).toContain('v_me uuid := auth.uid()');
    expect(migration).toContain("RAISE EXCEPTION 'Not authenticated'");
  });

  it('is pinned and closed to anonymous callers, the same way the rest of this schema now is', () => {
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.delete_own_account() FROM anon');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated');
  });

  it('clears budgets and notification_rules by hand', () => {
    // Both are NO ACTION on auth.users, verified against pg_constraint before
    // this was written — deleting the auth row first would fail outright with
    // a foreign key violation rather than silently orphaning anything.
    expect(migration).toContain('DELETE FROM public.budgets WHERE user_uuid = v_me');
    expect(migration).toContain('DELETE FROM public.notification_rules WHERE user_id = v_me');
  });

  it('clears a partner\'s reference to this account before the account goes', () => {
    // settings.partner_id is also NO ACTION, and unlike the two rows above it
    // names ANOTHER user's row — left alone, a linked partner would be
    // pointing at a user id that no longer exists.
    expect(migration).toMatch(
      /UPDATE public\.settings\s+SET partner_id = NULL, partner_name = NULL, partner_email = NULL\s+WHERE partner_id = v_me/,
    );
  });

  it('deletes the auth user last, after every NO ACTION reference is cleared', () => {
    const clearBudgets = migration.indexOf('DELETE FROM public.budgets');
    const clearPartner = migration.indexOf('UPDATE public.settings');
    const deleteAuth = migration.indexOf('DELETE FROM auth.users WHERE id = v_me');
    expect(deleteAuth).toBeGreaterThan(clearBudgets);
    expect(deleteAuth).toBeGreaterThan(clearPartner);
  });
});
