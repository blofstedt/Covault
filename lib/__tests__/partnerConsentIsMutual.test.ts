/**
 * What a security review of the partner features found, pinned so it cannot
 * come back quietly. Every one of these failed in silence: nothing crashed,
 * nothing logged, and the app looked exactly the same either way.
 *
 * The leak: `settings.partner_id` is a column on your OWN row and the settings
 * UPDATE policy is `auth.uid() = user_id`, so any signed-in account could PATCH
 * that column to a stranger's user id. The partner SELECT policies on `budgets`
 * and `overrides` asked only "does this row belong to the person I say is my
 * partner", so that one PATCH handed over their budget limits and every vendor
 * rule they had taught — a list of the merchants they shop at. The link code
 * exists precisely because handing it over IS the permission; this went round
 * it. A partner is now only a partner when BOTH rows point at each other.
 *
 * The breakage found at the same time: the policy that consulted the owner's
 * `share_level` did it with a sub-select against `settings`, which is itself
 * RLS'd to your own row — and a policy's sub-selects obey the referenced
 * table's policies. So that clause was false for every partner, always, and
 * partner transaction sharing could never return a row even when the link was
 * genuine. Both are fixed the same way, by a SECURITY DEFINER helper.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeDashboardSetting } from '../settings/dashboardSettingWrite';

const migration = readFileSync(
  resolve(__dirname, '../../supabase/migrations/2026_09_security_review.sql'),
  'utf8',
);

/**
 * Strip `//` comments. Several of these assertions are "this code is gone",
 * and the comment explaining why it is gone names the very thing being looked
 * for — so without this the file's own history trips its own test.
 */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** The body of a policy, so assertions cannot match a neighbouring one. */
function policy(name: string): string {
  const at = migration.indexOf(`CREATE POLICY "${name}"`);
  expect(at, `policy ${name} is missing`).toBeGreaterThan(-1);
  const end = migration.indexOf(';', at);
  return migration.slice(at, end);
}

describe('a partner is someone whose row points back at you', () => {
  it('the helper requires both rows to agree', () => {
    const at = migration.indexOf('CREATE OR REPLACE FUNCTION public.linked_partner_id()');
    expect(at).toBeGreaterThan(-1);
    const body = migration.slice(at, migration.indexOf('$$;', at));

    // Mine points at theirs...
    expect(body).toContain('mine.user_id = auth.uid()');
    // ...AND theirs points back at mine. Without this line the whole thing is
    // the one-sided check it replaced.
    expect(body).toContain('theirs.partner_id = mine.user_id');
  });

  it('is SECURITY DEFINER with a pinned search_path', () => {
    // DEFINER because confirming their row points back means reading a row
    // `settings` RLS forbids. Pinned search_path because a DEFINER function
    // resolving names against the caller's path is the standard escalation.
    const at = migration.indexOf('CREATE OR REPLACE FUNCTION public.linked_partner_id()');
    const head = migration.slice(at, at + 260);
    expect(head).toContain('SECURITY DEFINER');
    expect(head).toContain('SET search_path = public, pg_temp');
  });

  it.each([
    ['Users can view partner transactions', 'user_id'],
    ['Users can view partner overrides', 'user_id'],
    ['Users can view partner budgets', 'user_uuid'],
  ])('%s goes through it', (name, column) => {
    expect(policy(name)).toContain(`${column} = public.linked_partner_id()`);
  });

  it('no partner policy re-derives the link from settings itself', () => {
    // This is the shape that both leaked and broke: reading `settings` inside
    // a policy. Either it reads your own row (and trusts a column you control)
    // or it reads theirs (and is silently always false).
    for (const name of [
      'Users can view partner transactions',
      'Users can view partner overrides',
      'Users can view partner budgets',
    ]) {
      expect(policy(name)).not.toContain('FROM public.settings');
    }
  });
});

describe('share_level is enforced by the database, not by a screen', () => {
  it.each([
    'Users can view partner transactions',
    // Vendor rules name merchants, which is exactly what a share level below
    // 'transactions' exists to hide.
    'Users can view partner overrides',
  ])('%s also requires the owner to be sharing at row level', (name) => {
    expect(policy(name)).toContain("public.partner_share_level() = 'transactions'");
  });

  it('budget limits are not gated on it', () => {
    // A limit is not spending, and 'combined' budget mode needs both sides'
    // limits at every share level.
    expect(policy('Users can view partner budgets')).not.toContain('partner_share_level');
  });

  it('asks the OWNER of the rows, never the reader', () => {
    const at = migration.indexOf('CREATE OR REPLACE FUNCTION public.partner_share_level()');
    expect(at).toBeGreaterThan(-1);
    const body = migration.slice(at, migration.indexOf('$$;', at));
    expect(body).toContain('s.user_id = public.linked_partner_id()');
    expect(body).not.toContain('auth.uid()');
  });
});

describe('the columns that decide access are not the client to write', () => {
  it('takes the table grant away before handing columns back', () => {
    // Order matters and is easy to get wrong: a column-level REVOKE does
    // nothing while the role still holds UPDATE on the whole table.
    const revoke = migration.indexOf('REVOKE UPDATE ON public.settings FROM authenticated');
    const grant = migration.indexOf('GRANT UPDATE (');
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(revoke);
  });

  it.each([
    'partner_id',
    'link_code',
    // A PATCH of {"is_tester": true} unlocked the app permanently.
    'is_tester',
    'subscription_status',
    'trial_ends_at',
    // Household-wide; set_household_budget_mode writes both rows.
    'budget_mode',
  ])('%s is not in the writable list', (column) => {
    const grant = migration.slice(
      migration.indexOf('GRANT UPDATE ('),
      migration.indexOf(') ON public.settings TO authenticated'),
    );
    expect(grant).not.toContain(column);
  });

  it('still lets you set your own share_level', () => {
    // Yours alone, and deliberately not symmetric — it is your data. If this
    // ever stops being writable the selector silently stops saving again.
    const grant = migration.slice(
      migration.indexOf('GRANT UPDATE ('),
      migration.indexOf(') ON public.settings TO authenticated'),
    );
    expect(grant).toContain('share_level');
  });
});

describe('deleting the account deletes the account', () => {
  it('names every table, because nothing cascades', () => {
    const at = migration.indexOf('CREATE OR REPLACE FUNCTION public.delete_own_account()');
    const body = migration.slice(at, migration.indexOf('$$;', at));

    // There is not one foreign key in this schema, so `DELETE FROM auth.users`
    // on its own left everything behind, keyed to a user id nobody can ever
    // authenticate as again. Google Play requires deletion to actually delete.
    for (const table of [
      'public.transactions',
      'public.overrides',
      'public.rule_contributions',
      'public.notification_rules',
      'public.budgets',
      'public.settings',
    ]) {
      expect(body).toContain(`DELETE FROM ${table}`);
    }
    expect(body).toContain('DELETE FROM auth.users');
  });

  it('detaches the partner before deleting', () => {
    const at = migration.indexOf('CREATE OR REPLACE FUNCTION public.delete_own_account()');
    const body = migration.slice(at, migration.indexOf('$$;', at));
    expect(body.indexOf('partner_id = NULL')).toBeLessThan(body.indexOf('DELETE FROM auth.users'));
  });
});

describe('link codes are minted in the database and go stale', () => {
  it('uses a cryptographic source, not Math.random', () => {
    const at = migration.indexOf('CREATE OR REPLACE FUNCTION public.generate_link_code()');
    const body = migration.slice(at, migration.indexOf('$$;', at));
    // Schema-qualified: pgcrypto lives in `extensions` on Supabase, and the
    // pinned search_path that makes this function safe keeps it out of reach.
    expect(body).toContain('extensions.gen_random_bytes(8)');
  });

  it('has no character that can be misread for another', () => {
    const at = migration.indexOf('CREATE OR REPLACE FUNCTION public.generate_link_code()');
    const body = migration.slice(at, migration.indexOf('$$;', at));
    const alphabet = /v_alphabet CONSTANT text := '([^']+)'/.exec(body)?.[1] ?? '';
    expect(alphabet.length).toBeGreaterThan(20);
    // The code is read off one screen and typed into another.
    for (const confusable of ['0', 'O', '1', 'I', 'L']) {
      expect(alphabet).not.toContain(confusable);
    }
  });

  it('expires, and an expired code cannot be claimed', () => {
    expect(migration).toContain("link_code_expires_at = now() + interval '30 minutes'");
    const at = migration.indexOf('CREATE OR REPLACE FUNCTION public.link_partner_by_code(p_code text)');
    const body = migration.slice(at, migration.indexOf('$$;', at));
    expect(body).toContain('s.link_code_expires_at > now()');
  });

  it('is unique among live codes', () => {
    // Two accounts holding one code makes "claim the row with this code"
    // ambiguous, and the old client-side generator checked nothing.
    const at = migration.indexOf('CREATE OR REPLACE FUNCTION public.generate_link_code()');
    const body = migration.slice(at, migration.indexOf('$$;', at));
    expect(body).toContain('EXIT WHEN NOT EXISTS');
  });

  it('the app asks for one rather than making its own', () => {
    const hook = readFileSync(resolve(__dirname, '../hooks/useHouseholdLinking.ts'), 'utf8');
    expect(hook).toContain("callRpc<string>('generate_link_code'");
    expect(codeOnly(hook)).not.toContain('Math.random()');
  });
});

describe('the new functions are not anonymous endpoints', () => {
  it.each([
    'public.linked_partner_id()',
    'public.partner_share_level()',
    'public.generate_link_code()',
  ])('%s is revoked from anon by name', (fn) => {
    // A REVOKE from PUBLIC does not undo the EXECUTE this schema grants
    // directly to `anon` on every new function, so `anon` has to be named.
    expect(migration).toContain(`REVOKE EXECUTE ON FUNCTION ${fn}`.replace('()', '()'));
    const line = migration
      .split('\n')
      .find((l) => l.includes(`REVOKE EXECUTE ON FUNCTION ${fn}`) && l.includes('FROM anon'));
    expect(line, `${fn} is still reachable without signing in`).toBeTruthy();
  });
});

describe('the privacy selector actually saves', () => {
  it('writes the sharing choice but leaves household mode to its own RPC', async () => {
    const writes: Array<[string, boolean | string | number]> = [];
    const save = async (column: string, value: boolean | string | number) => {
      writes.push([column, value]);
    };

    await writeDashboardSetting('shareLevel', 'totals', save);
    await writeDashboardSetting('notificationsEnabled', true, save);
    await expect(writeDashboardSetting('budgetMode', 'combined', save)).rejects.toThrow(
      'No persistence path for dashboard setting: budgetMode',
    );

    expect(writes).toEqual([['share_level', 'totals']]);
  });
});
