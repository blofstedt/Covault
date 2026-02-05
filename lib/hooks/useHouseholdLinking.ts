// lib/hooks/useHouseholdLinking.ts
import { useCallback } from 'react';
import { REST_BASE, getAuthHeaders } from '../apiHelpers';
import type { UseUserDataParams } from './types';

export const useHouseholdLinking = ({
  appState,
  setAppState,
  setDbError,
}: UseUserDataParams) => {

  // Generate a link code for household linking
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
      
      // Set expiration to 24 hours from now
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      
      (headers as any)['Prefer'] = 'return=representation';
      const res = await fetch(`${REST_BASE}/link_codes`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          code,
          user_id: userId,
          expires_at: expiresAt,
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

  // Join household using a link code
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
        
        // Look up the link code
        const codeRes = await fetch(
          `${REST_BASE}/link_codes?select=*&code=eq.${code.toUpperCase()}&expires_at=gt.${new Date().toISOString()}&limit=1`,
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

        const linkCode = codeData[0];
        const otherUserId = linkCode.user_id;

        if (otherUserId === userId) {
          setDbError("You can't link with yourself");
          return;
        }

        // Get the other user's name
        const settingsRes = await fetch(
          `${REST_BASE}/settings?select=name&user_id=eq.${otherUserId}&limit=1`,
          { headers },
        );

        let otherUserName = 'Partner';
        if (settingsRes.ok) {
          const settingsData = JSON.parse(await settingsRes.text());
          if (settingsData && settingsData.length > 0) {
            otherUserName = settingsData[0].name;
          }
        }

        // Create household link
        (headers as any)['Prefer'] = 'return=representation';
        const linkRes = await fetch(`${REST_BASE}/household_links`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            user1_id: otherUserId,
            user2_id: userId,
            user1_name: otherUserName,
            user2_name: userName,
          }),
        });

        if (!linkRes.ok) {
          const body = await linkRes.text();
          setDbError(`Failed to create household link: ${body.slice(0, 200)}`);
          return;
        }

        // Delete the used link code
        await fetch(`${REST_BASE}/link_codes?code=eq.${code.toUpperCase()}`, {
          method: 'DELETE',
          headers,
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

  // Send a partner link request by email (legacy method, kept for compatibility)
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
        const insertRes = await fetch(`${REST_BASE}/household_links`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            user1_id: userId,
            user2_id: partnerId,
            user1_name: userName,
            user2_name: partnerName,
          }),
        });

        if (!insertRes.ok) {
          const body = await insertRes.text();
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

  // Disconnect household
  const handleUnlinkPartner = useCallback(async () => {
    try {
      const userId = appState.user?.id;
      if (!userId) return;

      const headers = await getAuthHeaders();
      await fetch(
        `${REST_BASE}/household_links?or=(user1_id.eq.${userId},user2_id.eq.${userId})`,
        { method: 'DELETE', headers },
      );

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
