import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Two accounts are linked by a code, and by nothing else.
 *
 * There used to be a second route: type your partner's email address, and both
 * settings rows were written on the spot. The other person was never asked and
 * never told — so anyone who knew a Covault user's email could attach
 * themselves to that account and read its transactions and budgets through the
 * partner policies. The button even said "Send Request", which is not what it
 * did.
 *
 * The code is the whole consent. It exists only on the other person's screen,
 * so there is no way to obtain one without asking them for it.
 */

const read = (rel: string) => readFileSync(resolve(__dirname, '../../', rel), 'utf8');

const LINKING = read('lib/hooks/useHouseholdLinking.ts');
const SHARING = read('components/dashboard_components/settings_modal_components/VaultSharingSection.tsx');
const ONBOARDING = read('components/Onboarding.tsx');
const DROP = read('supabase/migrations/2026_09_drop_email_linking.sql');

describe('linking a partner', () => {
  it('has no email route left in the app', () => {
    for (const [name, source] of [
      ['the linking hook', LINKING],
      ['vault sharing', SHARING],
      ['the intro', ONBOARDING],
    ] as const) {
      expect(source, `${name} still calls link_partner_by_email`)
        .not.toContain('link_partner_by_email');
      expect(source, `${name} still has an email linker`)
        .not.toMatch(/handleLinkPartner|onLinkPartner/);
    }
  });

  it('drops the function so it cannot be called round the app', () => {
    // The app not calling it is not enough on its own: the RPC was granted to
    // every signed-in user, so it was reachable by anyone with an access token
    // whether or not a Covault screen offered it.
    expect(DROP).toContain('DROP FUNCTION IF EXISTS public.link_partner_by_email(text)');
  });

  it('still joins with a code, and reports why one was refused', () => {
    expect(LINKING).toContain("callRpc<LinkedPartner[]>('link_partner_by_code'");
    // The outcome is returned, not only raised as a banner: the intro is a
    // full-screen step and a toast behind it is a message nobody reads.
    expect(LINKING).toMatch(/handleJoinWithCode = useCallback\(\s*\n?\s*async \(code: string\): Promise<LinkOutcome>/);
  });

  it('offers both halves of the exchange on both screens', () => {
    // Whoever has the app open first shows a code; the other types it. A screen
    // that only does one half means one of them is stuck.
    for (const [name, source] of [
      ['vault sharing', SHARING],
      ['the intro', ONBOARDING],
    ] as const) {
      expect(source, `${name} cannot show a code`).toContain('onGenerateLinkCode');
      expect(source, `${name} cannot enter one`).toContain('onJoinWithCode');
    }
  });
});
