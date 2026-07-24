// lib/hooks/useHouseholdLinking.ts
import { log } from '../log';
import { useCallback } from 'react';
import { restFetch } from '../apiHelpers';
import type { UseUserDataParams } from './types';

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

        // Look up the settings row with this link code
        const codeRes = await restFetch(
          `/settings?select=user_id,name,email&link_code=eq.${encodeURIComponent(code.toUpperCase())}&limit=1`,
        );

        if (!codeRes.ok) {
          setDbError('Invalid or expired link code');
          return;
        }

        const codeData = JSON.parse(await codeRes.text());
        if (!codeData || codeData.length === 0) {
          setDbError('Invalid or expired link code');
          return;
        }

        const otherUserId = codeData[0].user_id;
        const otherUserName = codeData[0].name;
        const otherUserEmail = codeData[0].email;

        if (otherUserId === userId) {
          setDbError("You can't link with yourself");
          return;
        }

        // Atomically consume the link code (only succeeds if code still matches).
        // Prefer: return=representation so we can tell whether a row was updated.
        // Update other user's settings — include link_code filter to prevent race conditions
        const otherRes = await restFetch(`/settings?user_id=eq.${otherUserId}&link_code=eq.${encodeURIComponent(code.toUpperCase())}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            partner_id: userId,
            partner_name: userName,
            partner_email: appState.user?.email,
            budgeting_solo: false,
            link_code: null,
          }),
        });

        // If no rows were updated, the code was already consumed
        const otherBody = await otherRes.text();
        let otherRows: any[] = [];
        try { otherRows = otherBody ? JSON.parse(otherBody) : []; } catch { otherRows = []; }
        if (!otherRes.ok || !Array.isArray(otherRows) || otherRows.length === 0) {
          setDbError('Link code was already used or expired. Please generate a new one.');
          return;
        }

        // Update current user's settings
        await restFetch(`/settings?user_id=eq.${userId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            partner_id: otherUserId,
            partner_name: otherUserName,
            partner_email: otherUserEmail,
            budgeting_solo: false,
          }),
        });

        setAppState(prev => ({
          ...prev,
          user: prev.user
            ? {
                ...prev.user,
                budgetingSolo: false,
                hasJointAccounts: true,
                partnerId: otherUserId,
                partnerName: otherUserName,
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
    async (partnerEmail: string) => {
      try {
        const lookupRes = await restFetch(
          `/settings?select=user_id,name,email&email=eq.${encodeURIComponent(
            partnerEmail,
          )}&limit=1`,
        );

        if (!lookupRes.ok) {
          setDbError(`Could not find user with email ${partnerEmail}`);
          return;
        }

        const lookupData = JSON.parse(await lookupRes.text());
        if (!lookupData || lookupData.length === 0) {
          setDbError(
            `No Covault account found for ${partnerEmail}. They need to sign up first.`,
          );
          return;
        }

        const partnerId = lookupData[0].user_id;
        const partnerName = lookupData[0].name;
        const userId = appState.user?.id;
        const userName = appState.user?.name;
        if (!userId || partnerId === userId) {
          setDbError("You can't link with yourself.");
          return;
        }

        // Update other user's settings
        await restFetch(`/settings?user_id=eq.${partnerId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            partner_id: userId,
            partner_name: userName,
            partner_email: appState.user?.email,
            budgeting_solo: false,
          }),
        });

        // Update current user's settings
        const updateRes = await restFetch(`/settings?user_id=eq.${userId}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            partner_id: partnerId,
            partner_name: partnerName,
            partner_email: partnerEmail,
            budgeting_solo: false,
          }),
        });

        if (!updateRes.ok) {
          const body = await updateRes.text();
          setDbError(`Link failed: ${body.slice(0, 200)}`);
          return;
        }

        setAppState(prev => ({
          ...prev,
          user: prev.user
            ? {
                ...prev.user,
                budgetingSolo: false,
                hasJointAccounts: true,
                partnerId,
                partnerName,
                partnerEmail,
              }
            : null,
        }));
        log.debug('[linkPartner] OK, linked with', partnerEmail);
      } catch (err: any) {
        setDbError(`Link exception: ${err?.message || err}`);
      }
    },
    [appState.user, setAppState, setDbError],
  );

  // Disconnect household (clear partner fields in both users' settings)
  const handleUnlinkPartner = useCallback(async () => {
    try {
      const userId = appState.user?.id;
      const partnerId = appState.user?.partnerId;
      if (!userId) return;

      // Clear current user's partner fields
      await restFetch(`/settings?user_id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          partner_id: null,
          partner_name: null,
          partner_email: null,
          budgeting_solo: true,
        }),
      });

      // Clear partner's fields too
      if (partnerId) {
        await restFetch(`/settings?user_id=eq.${partnerId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            partner_id: null,
            partner_name: null,
            partner_email: null,
            budgeting_solo: true,
          }),
        });
      }

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
