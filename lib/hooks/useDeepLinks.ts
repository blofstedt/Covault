// lib/useDeepLinks.ts
import { log } from '../log';
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from '../supabase';

/**
 * The PKCE authorization code in a sign-in callback, or null.
 *
 * ONLY a code. This used to accept an access token and refresh token straight
 * out of the link too — an "implicit flow" fallback — and hand them to
 * `setSession`. But the app signs in with PKCE (lib/supabase.ts), so a real
 * callback never carries tokens, and any page or app on the phone can open a
 * `com.covault.app://` link. One carrying someone else's tokens would have
 * signed this phone into THEIR account without a word — after which every
 * purchase this phone captured from the user's bank alerts would have been
 * filed into a stranger's account, where they could read it.
 *
 * A code cannot be used that way: exchanging it needs the verifier this app
 * stored when it started the sign-in, so a code minted for anyone else's
 * sign-in simply fails.
 */
export const parseOAuthCode = (url: string): string | null => {
  try {
    const hashIndex = url.indexOf('#');
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return null;
    const queryEnd = hashIndex !== -1 && hashIndex > queryIndex ? hashIndex : url.length;
    const params = new URLSearchParams(url.substring(queryIndex + 1, queryEnd));
    return params.get('code') || null;
  } catch (error) {
    log.error('[useDeepLinks] Error parsing OAuth URL:', error);
    return null;
  }
};

export const useDeepLinks = () => {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      log.debug('[useDeepLinks] Not on native platform, skipping deep link setup');
      return;
    }

    log.debug('[useDeepLinks] Setting up deep link listener for Android OAuth');

    const handleAppUrlOpen = CapApp.addListener(
      'appUrlOpen',
      async ({ url }) => {
        log.debug('[useDeepLinks] Deep link received:', url);

        // Check if this is an OAuth callback
        if (
          url.includes('auth/callback') ||
          url.includes('access_token') ||
          url.includes('refresh_token') ||
          url.includes('code=')
        ) {
          const code = parseOAuthCode(url);

          if (code) {
            // PKCE flow: exchange authorization code for session
            log.debug('[useDeepLinks] Exchanging PKCE code for session...');
            try {
              const { data, error } = await supabase.auth.exchangeCodeForSession(code);
              if (error) {
                log.error('[useDeepLinks] Error exchanging PKCE code:', error);
              } else {
                log.debug('[useDeepLinks] ✅ Session set from PKCE code exchange');
                log.debug('[useDeepLinks] User:', data?.session?.user?.email);
              }
            } catch (error) {
              log.error('[useDeepLinks] Exception exchanging PKCE code:', error);
            }
          } else {
            // Including a link carrying raw tokens, which is refused on
            // purpose — see parseOAuthCode.
            log.warn('[useDeepLinks] Sign-in link had no authorization code; ignoring it');
          }

          // Close the in-app browser that was opened for OAuth
          try {
            await Browser.close();
          } catch {
            // Browser may already be closed
          }
        } else {
          log.debug('[useDeepLinks] Deep link is not an OAuth callback, ignoring');
        }
      },
    );

    return () => {
      log.debug('[useDeepLinks] Cleaning up deep link listener');
      handleAppUrlOpen.then(h => h.remove()).catch(() => {});
    };
  }, []);
};
