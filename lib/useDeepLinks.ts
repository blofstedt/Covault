// lib/useDeepLinks.ts
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { supabase } from './supabase';

export const useDeepLinks = () => {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handleAppUrlOpen = CapApp.addListener(
      'appUrlOpen',
      async ({ url }) => {
        console.log('Deep link received:', url);

        if (
          url.includes('auth/callback') ||
          url.includes('access_token') ||
          url.includes('#')
        ) {
          const hashIndex = url.indexOf('#');
          if (hashIndex !== -1) {
            const fragment = url.substring(hashIndex + 1);
            const params = new URLSearchParams(fragment);
            const accessToken = params.get('access_token');
            const refreshToken = params.get('refresh_token');

            if (accessToken && refreshToken) {
              console.log('Setting session from deep link tokens...');
              const { error } = await supabase.auth.setSession({
                access_token: accessToken,
                refresh_token: refreshToken,
              });
              if (error) {
                console.error('Error setting session from deep link:', error);
              } else {
                console.log('Session set successfully from deep link');
              }
            }
          }
        }
      },
    );

    return () => {
      handleAppUrlOpen.then(h => h.remove());
    };
  }, []);
};
