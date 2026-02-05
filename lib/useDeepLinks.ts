// lib/useDeepLinks.ts
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { supabase } from './supabase';

/**
 * Parse OAuth tokens from deep link URL
 * Handles both hash (#) and query (?) parameter formats
 */
const parseOAuthUrl = (url: string): { accessToken?: string; refreshToken?: string } | null => {
  try {
    console.log('[useDeepLinks] Parsing URL:', url);
    
    // Try hash fragment first (most common for OAuth)
    const hashIndex = url.indexOf('#');
    if (hashIndex !== -1) {
      const fragment = url.substring(hashIndex + 1);
      const params = new URLSearchParams(fragment);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      
      if (accessToken && refreshToken) {
        console.log('[useDeepLinks] Found tokens in hash fragment');
        return { accessToken, refreshToken };
      }
    }
    
    // Try query parameters as fallback
    const queryIndex = url.indexOf('?');
    if (queryIndex !== -1) {
      const hashPart = hashIndex !== -1 ? url.substring(0, hashIndex) : url;
      const query = hashPart.substring(queryIndex + 1);
      const params = new URLSearchParams(query);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      
      if (accessToken && refreshToken) {
        console.log('[useDeepLinks] Found tokens in query parameters');
        return { accessToken, refreshToken };
      }
    }
    
    console.log('[useDeepLinks] No OAuth tokens found in URL');
    return null;
  } catch (error) {
    console.error('[useDeepLinks] Error parsing OAuth URL:', error);
    return null;
  }
};

export const useDeepLinks = () => {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      console.log('[useDeepLinks] Not on native platform, skipping deep link setup');
      return;
    }

    console.log('[useDeepLinks] Setting up deep link listener for Android OAuth');

    const handleAppUrlOpen = CapApp.addListener(
      'appUrlOpen',
      async ({ url }) => {
        console.log('[useDeepLinks] Deep link received:', url);

        // Check if this is an OAuth callback
        if (
          url.includes('auth/callback') ||
          url.includes('access_token') ||
          url.includes('refresh_token')
        ) {
          const tokens = parseOAuthUrl(url);
          
          if (tokens && tokens.accessToken && tokens.refreshToken) {
            console.log('[useDeepLinks] Setting session from deep link tokens...');
            
            try {
              const { data, error } = await supabase.auth.setSession({
                access_token: tokens.accessToken,
                refresh_token: tokens.refreshToken,
              });
              
              if (error) {
                console.error('[useDeepLinks] Error setting session from deep link:', error);
              } else {
                console.log('[useDeepLinks] ✅ Session set successfully from deep link');
                console.log('[useDeepLinks] Session data:', data?.session?.user?.email);
              }
            } catch (error) {
              console.error('[useDeepLinks] Exception setting session:', error);
            }
          } else {
            console.warn('[useDeepLinks] OAuth callback received but tokens not found in URL');
          }
        } else {
          console.log('[useDeepLinks] Deep link is not an OAuth callback, ignoring');
        }
      },
    );

    return () => {
      console.log('[useDeepLinks] Cleaning up deep link listener');
      handleAppUrlOpen.then(h => h.remove());
    };
  }, []);
};
