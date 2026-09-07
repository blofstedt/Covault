/**
 * Who may call the database's functions, and what they resolve names against.
 *
 * Two rules, both of which are invisible from the app and neither of which any
 * other test would notice breaking.
 *
 * A SECURITY DEFINER function runs with its owner's privileges. Without a
 * pinned search_path it resolves unqualified names against the CALLER's
 * search_path, which is the standard way one of these becomes a privilege
 * escalation. The partner functions were written with it set; `handle_new_user`
 * was not.
 *
 * And PostgREST publishes every function in `public` as an endpoint, so a
 * trigger function written for `auth.users` was also a URL anybody could POST
 * to. It could not do anything — Postgres refuses to invoke a trigger function
 * directly — but the fix is a revoke, and a revoke is exactly the kind of line
 * a later migration reinstates by accident, because this schema grants EXECUTE
 * to `anon` and `authenticated` by default on every new function.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(__dirname, '../../supabase/migrations/2026_09_harden_definer_functions.sql'),
  'utf8',
);

describe('search_path is pinned', () => {
  it('on the one function that is SECURITY DEFINER without it', () => {
    expect(migration).toContain(
      'ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp',
    );
  });

  it('on the rest too, so the rule has no exceptions to remember', () => {
    for (const fn of [
      'public.generate_transaction_hash(numeric, text, date)',
      'public.update_updated_at_column()',
      'public.match_vendor(uuid, text)',
    ]) {
      expect(migration).toContain(`ALTER FUNCTION ${fn} SET search_path = public, pg_temp`);
    }
  });
});

describe('a trigger function is not an endpoint', () => {
  it('is revoked from everyone', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC');
    expect(migration).toContain(
      'REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated',
    );
  });

  it('is never granted back', () => {
    // Signup runs the trigger as its definer and does not need this grant. A
    // GRANT here would mean somebody had mistaken a failing signup for a
    // permissions problem.
    expect(/GRANT EXECUTE ON FUNCTION public\.handle_new_user/.test(migration)).toBe(false);
  });
});

describe('the partner RPCs', () => {
  it('are closed to anonymous callers', () => {
    for (const fn of [
      'public.link_partner_by_code(text)',
      'public.link_partner_by_email(text)',
      'public.unlink_partner()',
    ]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC`);
      expect(migration).toContain(`REVOKE EXECUTE ON FUNCTION ${fn} FROM anon`);
    }
  });

  it('stay open to signed-in ones, which is what the app is', () => {
    // The revoke above hits PUBLIC, which is where `authenticated` inherited
    // its grant. Without these three lines, linking a partner would start
    // failing with a permission error for every user.
    for (const fn of [
      'public.link_partner_by_code(text)',
      'public.link_partner_by_email(text)',
      'public.unlink_partner()',
    ]) {
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO authenticated`);
    }
  });

  it('revokes from PUBLIC and not only from the named roles', () => {
    // This schema grants EXECUTE to anon and authenticated by default on every
    // new function, so revoking from those two alone leaves the PUBLIC grant
    // standing — and looks like it worked. The community-rules migration
    // records the same trap.
    const revokes = migration.match(/REVOKE ALL ON FUNCTION [^;]+FROM PUBLIC/g) || [];
    expect(revokes.length).toBeGreaterThanOrEqual(4);
  });
});
