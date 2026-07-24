// lib/useDeepLinks.ts
import { log } from '../log';
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from '../supabase';

/**
 * Parse OAuth callback from deep link URL
 * Handles PKCE flow (code param), implicit flow (hash fragment tokens),
 * and query parameter tokens as fallback
 */
const parseOAuthUrl = (url: string): { accessToken?: string; refreshToken?: string; code?: string } | null => {
  try {
    log.debug('[useDeepLinks] Parsing URL:', url);

    // Check query parameters first for PKCE authorization code
    const hashIndex = url.indexOf('#');
    const queryIndex = url.indexOf('?');
    if (queryIndex !== -1) {
      const queryEnd = hashIndex !== -1 ? hashIndex : url.length;
      const query = url.substring(queryIndex + 1, queryEnd);
      const params = new URLSearchParams(query);

      // PKCE flow: look for authorization code
      const code = params.get('code');
      if (code) {
        log.debug('[useDeepLinks] Found PKCE authorization code in query params');
        return { code };
      }

      // Implicit flow fallback: tokens in query params
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (accessToken && refreshToken) {
        log.debug('[useDeepLinks] Found tokens in query parameters');
        return { accessToken, refreshToken };
      }
    }

    // Try hash fragment (implicit flow)
    if (hashIndex !== -1) {
      const fragment = url.substring(hashIndex + 1);
      const params = new URLSearchParams(fragment);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (accessToken && refreshToken) {
        log.debug('[useDeepLinks] Found tokens in hash fragment');
        return { accessToken, refreshToken };
      }
    }

    log.debug('[useDeepLinks] No OAuth code or tokens found in URL');
    return null;
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
          const parsed = parseOAuthUrl(url);

          if (parsed?.code) {
            // PKCE flow: exchange authorization code for session
            log.debug('[useDeepLinks] Exchanging PKCE code for session...');
            try {
              const { data, error } = await supabase.auth.exchangeCodeForSession(parsed.code);
              if (error) {
                log.error('[useDeepLinks] Error exchanging PKCE code:', error);
              } else {
                log.debug('[useDeepLinks] ✅ Session set from PKCE code exchange');
                log.debug('[useDeepLinks] User:', data?.session?.user?.email);
              }
            } catch (error) {
              log.error('[useDeepLinks] Exception exchanging PKCE code:', error);
            }
          } else if (parsed?.accessToken && parsed?.refreshToken) {
            // Implicit flow: set session directly from tokens
            log.debug('[useDeepLinks] Setting session from tokens...');
            try {
              const { data, error } = await supabase.auth.setSession({
                access_token: parsed.accessToken,
                refresh_token: parsed.refreshToken,
              });
              if (error) {
                log.error('[useDeepLinks] Error setting session from tokens:', error);
              } else {
                log.debug('[useDeepLinks] ✅ Session set from tokens');
                log.debug('[useDeepLinks] User:', data?.session?.user?.email);
              }
            } catch (error) {
              log.error('[useDeepLinks] Exception setting session:', error);
            }
          } else {
            log.warn('[useDeepLinks] OAuth callback received but no code or tokens found');
          }

          // Close the in-app browser that was opened for OAuth
          try {
            await Browser.close();
          } catch (_) {
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
