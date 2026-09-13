import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The privacy control has to live in the database, not on the screen.
 *
 * "My partner sees category totals, not merchants" is a promise about what
 * another signed-in person can READ. Honouring it only in the app would mean
 * the rows were still there for the asking — by an older build, by a screen
 * written later that forgot to check, or by anyone holding an access token.
 *
 * So the partner read consults the OWNER's chosen level, and the levels that
 * withhold rows are served by functions that return sums instead.
 */

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/2026_09_household_sharing.sql'), 'utf8');
const SHARING = readFileSync(resolve(__dirname, '../householdSharing.ts'), 'utf8');
const SETTINGS = readFileSync(
  resolve(__dirname, '../../components/dashboard_components/settings_modal_components/VaultSharingSection.tsx'),
  'utf8');

describe('the partner read', () => {
  it('asks the owner what they chose, not the viewer', () => {
    // The direction matters entirely: reading the VIEWER's level would let
    // anyone see everything by setting their own to "every purchase".
    const policy = SQL.slice(SQL.indexOf('CREATE POLICY "Users can view partner transactions"'));
    const body = policy.slice(0, policy.indexOf(';'));
    expect(body).toContain('owner.user_id = public.transactions.user_id');
    expect(body).toContain("owner.share_level = 'transactions'");
  });

  it('still requires the two accounts to be linked at all', () => {
    // The level is an additional condition, never a replacement: sharing
    // "every purchase" must not open the rows to somebody who is not a partner.
    const policy = SQL.slice(SQL.indexOf('CREATE POLICY "Users can view partner transactions"'));
    const body = policy.slice(0, policy.indexOf(';'));
    expect(body).toContain('s.partner_id');
    expect(body).toContain('s.user_id = auth.uid()');
  });
});

describe('the summaries that stand in for refused rows', () => {
  it('refuse to answer for anyone who is not your partner', () => {
    for (const fn of ['partner_monthly_income', 'partner_month_summary']) {
      const body = SQL.slice(SQL.indexOf(`FUNCTION public.${fn}`));
      expect(body.slice(0, body.indexOf('$$;'))).toContain('auth.uid()');
    }
  });

  it('say nothing when the partner shares their rows outright', () => {
    // Otherwise the same spending would be counted twice — once from the rows
    // and once from the summary.
    const body = SQL.slice(SQL.indexOf('FUNCTION public.partner_month_summary'));
    expect(body.slice(0, body.indexOf('$$;'))).toContain("v_level = 'transactions' THEN RETURN");
  });

  it('withhold the breakdown at the lowest level', () => {
    const body = SQL.slice(SQL.indexOf('FUNCTION public.partner_month_summary'));
    const fn = body.slice(0, body.indexOf('$$;'));
    // One row, a null budget, one figure.
    expect(fn).toContain('NULL::text, COALESCE(SUM(t.amount), 0)');
  });

  it('are closed to anonymous callers and open to signed-in ones', () => {
    for (const fn of [
      'public.partner_monthly_income()',
      'public.partner_month_summary(text)',
      'public.set_household_budget_mode(text)',
    ]) {
      const name = fn.replace(/[.()]/g, (c) => `\\${c}`);
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${name}\\s+FROM PUBLIC`));
      expect(SQL).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION ${name}\\s+TO authenticated`));
    }
  });
});

describe('the budget mode', () => {
  it('is written to both rows, so one household has one shape', () => {
    const body = SQL.slice(SQL.indexOf('FUNCTION public.set_household_budget_mode'));
    const fn = body.slice(0, body.indexOf('$$;'));
    expect(fn).toContain('WHERE s.user_id = v_me');
    expect(fn).toContain('WHERE s.user_id = v_partner');
  });

  it('cannot be used to write a stranger row', () => {
    // The partner's row is only touched where it still points back at you —
    // the same guard unlink_partner uses.
    const body = SQL.slice(SQL.indexOf('FUNCTION public.set_household_budget_mode'));
    expect(body.slice(0, body.indexOf('$$;'))).toContain('s.partner_id = v_me');
  });
});

describe('what the screens say', () => {
  it('offers all three levels, weakest first', () => {
    // The order is the information: these are degrees of one thing, not three
    // unrelated options.
    expect(SHARING).toMatch(/SHARE_LEVELS[^=]*=\s*\[\s*'totals',\s*'categories',\s*'transactions'\s*\]/);
    expect(SETTINGS).toContain('SHARE_LEVELS.map');
  });

  it('says the balance is the household in either budget mode', () => {
    expect(SETTINGS).toMatch(/both incomes/);
  });

  it('says the level is one person own choice', () => {
    expect(SETTINGS).toMatch(/Yours to set on your own/);
  });
});
