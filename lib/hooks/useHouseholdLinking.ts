// lib/hooks/useHouseholdLinking.ts
import { log } from '../log';
import { useCallback } from 'react';
import { restFetch } from '../apiHelpers';
import type { UseUserDataParams } from './types';

/**
 * Partner linking goes through SECURITY DEFINER functions, not plain REST.
 *
 * It has to. `settings` is RLS-gated to `auth.uid() = user_id`, but linking
 * touches the OTHER person's row — read it by link code or email, then write
 * partner_id onto it. Both are invisible to the client: the lookup returns zero
 * rows and the write reports `UPDATE 0` with no error, which is why linking
 * used to fail with "invalid or expired link code" no matter what you typed.
 *
 * Loosening the policies can't fix it — RLS decides row by row and can't see
 * the client's WHERE clause, so any policy permissive enough for a code lookup
 * would let any signed-in user read every account's name and email. The
 * handshake therefore lives in the database:
 * supabase/migrations/2026_08_01_sync_schema_to_app.sql.
 */
// A plain shape rather than a discriminated union: this project's tsconfig
// doesn't enable `strict`, so narrowing on a `ok: true | false` discriminant
// doesn't happen and every `result.message` read fails to compile.
interface RpcResult<T> {
  ok: boolean;
  data?: T;
  /** Present only when ok is false. */
  message?: string;
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  try {
    const res = await restFetch(`/rpc/${fn}`, {
      method: 'POST',
      body: JSON.stringify(args),
    });
    const body = await res.text();

    if (!res.ok) {
      // The functions RAISE EXCEPTION with messages written for the user
      // ("Invalid or expired link code"), and PostgREST passes them through in
      // `message`. Prefer that over anything invented here.
      let message = '';
      try {
        message = (JSON.parse(body) as { message?: string })?.message || '';
      } catch {
        /* non-JSON error body */
      }
      return { ok: false, message: message || `Request failed (${res.status})` };
    }

    return { ok: true, data: (body ? JSON.parse(body) : null) as T };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Network error' };
  }
}

/**
 * What the caller is told about a link attempt.
 *
 * The settings screen reports failures through the app-wide error toast and
 * ignores this; the intro cannot — it is a full-screen step with its own place
 * to put "no Covault account for that address", and a toast behind a modal is
 * a message nobody reads.
 */
export interface LinkOutcome {
  ok: boolean;
  /** Present only when ok is false; already written for the user. */
  message?: string;
}

/** Shape returned by link_partner_by_code / link_partner_by_email. */
interface LinkedPartner {
  partner_id: string;
  partner_name: string | null;
  partner_email: string | null;
}

export const useHouseholdLinking = ({
  appState,
  setAppState,
  setDbError,
}: UseUserDataParams) => {

  // Generate a link code for household linking (stored in settings row)
  const handleGenerateLinkCode = useCallback(async (): Promise<string | null> => {
    try {
      const userId = appState.user?.id;
      if (!userId) {
        setDbError('User not logged in');
        return null;
      }

      // Generate a 6-character code
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();

      const res = await restFetch(`/settings?user_id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          link_code: code,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        setDbError(`Failed to generate link code: ${body.slice(0, 200)}`);
        return null;
      }

      log.debug('[generateLinkCode] Generated code:', code);
      return code;
    } catch (err: any) {
      setDbError(`Generate link code exception: ${err?.message || err}`);
      return null;
    }
  }, [appState.user, setDbError]);

  // Join household using a link code (stored in partner's settings row)
  const handleJoinWithCode = useCallback(
    async (code: string) => {
      try {
        const userId = appState.user?.id;
        const userName = appState.user?.name;
        if (!userId || !userName) {
          setDbError('User not logged in');
          return;
        }

        // One call does both halves: it claims the code and writes each row's
        // partner fields in a single statement, so two people racing on the
        // same code can't both win — the second finds no row with that code
        // still set. The old client-side "you can't link with yourself" check
        // is gone because it needed a lookup we're no longer allowed to do;
        // the function excludes the caller's own row, so your own code simply
        // reads as invalid.
        const result = await callRpc<LinkedPartner[]>('link_partner_by_code', {
          p_code: code,
        });

        if (!result.ok) {
          setDbError(result.message);
          return;
        }

        const linked = result.data?.[0];
        if (!linked) {
          setDbError('Invalid or expired link code');
          return;
        }

        // budgeting_solo isn't part of the handshake — it's a per-user display
        // preference, and each side owns its own row for it. The partner's app
        // derives it from partner_id on next load (useDataLoading), so only
        // ours needs writing here.
        await restFetch(`/settings?user_id=eq.${userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ budgeting_solo: false }),
        });

        setAppState(prev => ({
          ...prev,
          user: prev.user
            ? {
                ...prev.user,
                budgetingSolo: false,
                hasJointAccounts: true,
                partnerId: linked.partner_id,
                partnerName: linked.partner_name || undefined,
                partnerEmail: linked.partner_email || undefined,
              }
            : null,
        }));

        log.debug('[joinWithCode] Successfully linked household');
      } catch (err: any) {
        setDbError(`Join with code exception: ${err?.message || err}`);
      }
    },
    [appState.user, setAppState, setDbError],
  );

  // Send a partner link request by email
  const handleLinkPartner = useCallback(
    async (partnerEmail: string): Promise<LinkOutcome> => {
      try {
        const userId = appState.user?.id;
        if (!userId) {
          setDbError('User not logged in');
          return { ok: false, message: 'User not logged in' };
        }

        // Same reasoning as the code path: the lookup and the write both target
        // a row RLS hides from us, so both happen inside the function. It also
        // refuses to hijack an account already linked to someone else.
        const result = await callRpc<LinkedPartner[]>('link_partner_by_email', {
          p_email: partnerEmail,
        });

        if (!result.ok) {
          setDbError(result.message);
          return { ok: false, message: result.message };
        }

        const linked = result.data?.[0];
        if (!linked) {
          const message =
            `No Covault account found for ${partnerEmail}. They need to sign up first.`;
          setDbError(message);
          return { ok: false, message };
        }

        await restFetch(`/settings?user_id=eq.${userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ budgeting_solo: false }),
        });

        setAppState(prev => ({
          ...prev,
          user: prev.user
            ? {
                ...prev.user,
                budgetingSolo: false,
                hasJointAccounts: true,
                partnerId: linked.partner_id,
                partnerName: linked.partner_name || undefined,
                partnerEmail: linked.partner_email || partnerEmail,
              }
            : null,
        }));
        log.debug('[linkPartner] OK, linked with', partnerEmail);
        return { ok: true };
      } catch (err: any) {
        const message = `Link exception: ${err?.message || err}`;
        setDbError(message);
        return { ok: false, message };
      }
    },
    [appState.user, setAppState, setDbError],
  );

  // Disconnect household (clear partner fields in both users' settings)
  const handleUnlinkPartner = useCallback(async () => {
    try {
      const userId = appState.user?.id;
      if (!userId) return;

      // Clears BOTH rows. Previously this cleared its own and then PATCHed the
      // partner's, which RLS silently dropped — so the partner stayed linked to
      // you and kept seeing your transactions and budgets through the partner
      // SELECT policies. The function only clears the other row if it actually
      // points back at you.
      const result = await callRpc<null>('unlink_partner', {});
      if (!result.ok) {
        setDbError(result.message);
        return;
      }

      // Our own display preference; see the note in handleJoinWithCode.
      await restFetch(`/settings?user_id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ budgeting_solo: true }),
      });

      setAppState(prev => ({
        ...prev,
        user: prev.user
          ? {
              ...prev.user,
              budgetingSolo: true,
              hasJointAccounts: false,
              partnerId: undefined,
              partnerEmail: undefined,
              partnerName: undefined,
            }
          : null,
      }));
      log.debug('[unlinkPartner] OK');
    } catch (err: any) {
      setDbError(`Unlink exception: ${err?.message || err}`);
    }
  }, [appState.user, setAppState, setDbError]);

  return {
    handleGenerateLinkCode,
    handleJoinWithCode,
    handleLinkPartner,
    handleUnlinkPartner,
  };
};
