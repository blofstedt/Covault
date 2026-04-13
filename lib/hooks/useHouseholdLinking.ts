// lib/hooks/useHouseholdLinking.ts
import { useCallback } from 'react';
import { REST_BASE, getAuthHeaders } from '../apiHelpers';
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

      const headers = await getAuthHeaders();
      
      // Generate a 6-character code
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      const res = await fetch(`${REST_BASE}/settings?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          link_code: code,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        setDbError(`Failed to generate link code: ${body.slice(0, 200)}`);
        return null;
      }

      console.log('[generateLinkCode] Generated code:', code);
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

        const headers = await getAuthHeaders();
        
        // Look up the settings row with this link code
        const codeRes = await fetch(
          `${REST_BASE}/settings?select=user_id,name,email&link_code=eq.${encodeURIComponent(code.toUpperCase())}&limit=1`,
          { headers },
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

        // Atomically consume the link code (only succeeds if code still matches)
        (headers as any)['Prefer'] = 'return=representation';

        // Update other user's settings — include link_code filter to prevent race conditions
        const otherRes = await fetch(`${REST_BASE}/settings?user_id=eq.${otherUserId}&link_code=eq.${encodeURIComponent(code.toUpperCase())}`, {
          method: 'PATCH',
          headers,
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
        await fetch(`${REST_BASE}/settings?user_id=eq.${userId}`, {
          method: 'PATCH',
          headers,
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

        console.log('[joinWithCode] Successfully linked household');
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
        const headers = await getAuthHeaders();
        const lookupRes = await fetch(
          `${REST_BASE}/settings?select=user_id,name,email&email=eq.${encodeURIComponent(
            partnerEmail,
          )}&limit=1`,
          { headers },
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

        (headers as any)['Prefer'] = 'return=representation';

        // Update other user's settings
        await fetch(`${REST_BASE}/settings?user_id=eq.${partnerId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            partner_id: userId,
            partner_name: userName,
            partner_email: appState.user?.email,
            budgeting_solo: false,
          }),
        });

        // Update current user's settings
        const updateRes = await fetch(`${REST_BASE}/settings?user_id=eq.${userId}`, {
          method: 'PATCH',
          headers,
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
        console.log('[linkPartner] OK, linked with', partnerEmail);
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

      const headers = await getAuthHeaders();

      // Clear current user's partner fields
      await fetch(`${REST_BASE}/settings?user_id=eq.${userId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          partner_id: null,
          partner_name: null,
          partner_email: null,
          budgeting_solo: true,
        }),
      });

      // Clear partner's fields too
      if (partnerId) {
        await fetch(`${REST_BASE}/settings?user_id=eq.${partnerId}`, {
          method: 'PATCH',
          headers,
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
      console.log('[unlinkPartner] OK');
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
