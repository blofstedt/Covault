// lib/useAuthState.ts
import { log } from '../log';
import React, { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { clearCachedAccessToken, setCachedAccessToken } from '../apiHelpers';
import { clearFirstPaintCache } from '../firstPaintCache';
import type { AppState, User } from '../../types';

import { shouldShowOnboarding } from '../onboardingState';

export type AuthStatus = 'loading' | 'unauthenticated' | 'onboarding' | 'authenticated';

const SESSION_EXPIRY_KEY = 'covault_session_start';
const SESSION_DURATION_DAYS = 14;

const markSessionStart = () => {
  localStorage.setItem(SESSION_EXPIRY_KEY, Date.now().toString());
};

const clearSessionTimestamp = () => {
  localStorage.removeItem(SESSION_EXPIRY_KEY);
};

const isSessionValid = (): boolean => {
  const sessionStart = localStorage.getItem(SESSION_EXPIRY_KEY);
  if (!sessionStart) {
    // No timestamp yet - this is a valid first-time session, mark it now
    markSessionStart();
    return true;
  }

  const startTime = parseInt(sessionStart, 10);
  const now = Date.now();
  const daysSinceStart = (now - startTime) / (1000 * 60 * 60 * 24);

  return daysSinceStart < SESSION_DURATION_DAYS;
};

interface UseAuthStateParams {
  setAppState: React.Dispatch<React.SetStateAction<AppState>>;
  setAuthState: React.Dispatch<React.SetStateAction<AuthStatus>>;
  loadUserData: (userId: string) => Promise<void>;
}

export const useAuthState = ({
  setAppState,
  setAuthState,
  loadUserData,
}: UseAuthStateParams) => {
  const lastLoadedUserIdRef = useRef<string | null>(null);
  const loadUserDataPromiseRef = useRef<Promise<void> | null>(null);
  const loadingUserIdRef = useRef<string | null>(null);
  const pendingUserIdRef = useRef<string | null>(null);

  const maybeLoadUserData = useCallback(
    (userId: string, { forceReload = false }: { forceReload?: boolean } = {}) => {
      if (!forceReload && lastLoadedUserIdRef.current === userId) {
        return loadUserDataPromiseRef.current ?? Promise.resolve();
      }

      if (loadUserDataPromiseRef.current) {
        if (!forceReload && loadingUserIdRef.current === userId) {
          return loadUserDataPromiseRef.current;
        }
        pendingUserIdRef.current = userId;
        return loadUserDataPromiseRef.current;
      }

      loadingUserIdRef.current = userId;
      const loadPromise = loadUserData(userId)
        .then(() => {
          lastLoadedUserIdRef.current = userId;
        })
        .finally(() => {
          loadUserDataPromiseRef.current = null;
          loadingUserIdRef.current = null;
          const pendingUserId = pendingUserIdRef.current;
          pendingUserIdRef.current = null;
          if (pendingUserId && pendingUserId !== lastLoadedUserIdRef.current) {
            maybeLoadUserData(pendingUserId).catch(error => {
              // A transient failure here (network blip, RLS hiccup, etc.) must not
              // sign the user out — the Supabase session is still valid. Just log
              // and leave the existing app state intact; the next loadUserData
              // triggered by a SIGNED_IN / token refresh will retry.
              log.error(
                `[useAuthState] Error loading pending user data for user ${pendingUserId}. This may indicate a network issue or invalid user ID:`,
                error,
              );
            });
          }
        });
      loadUserDataPromiseRef.current = loadPromise;
      return loadPromise;
    },
    [loadUserData],
  );

  useEffect(() => {
    // Helper: map Supabase user to your internal User type
    const mapUser = (sessionUser: any): User => ({
      id: sessionUser.id,
      name:
        sessionUser.user_metadata?.full_name ||
        sessionUser.email?.split('@')[0] ||
        'User',
      email: sessionUser.email || '',
      hasJointAccounts: false,
      budgetingSolo: true,
      monthlyIncome: 0, // Will be loaded from DB by loadUserData()
    });

    // Merge mapped user into state, preserving DB-loaded fields for the same user
    const mergeUser = (mappedUser: User) => {
      setAppState(prev => ({
        ...prev,
        user: prev.user?.id === mappedUser.id
          ? {
              // Preserve DB-loaded fields (hasJointAccounts, budgetingSolo,
              // partnerId/Name/Email, trial_*, subscription_*, monthlyIncome,
              // etc.) and only refresh the fields that actually come from the
              // auth session. The previous version spread `...mappedUser`,
              // which clobbered hasJointAccounts/budgetingSolo on every
              // TOKEN_REFRESHED / USER_UPDATED event with the mapper's
              // hard-coded defaults.
              ...prev.user,
              id: mappedUser.id,
              name: mappedUser.name,
              email: mappedUser.email,
            }
          : mappedUser,
      }));
    };

    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCachedAccessToken(session?.access_token);
      if (session?.user) {
        // Check 14-day window
        if (!isSessionValid()) {
          supabase.auth.signOut();
          clearSessionTimestamp();
          clearCachedAccessToken();
          clearFirstPaintCache();
          lastLoadedUserIdRef.current = null;
          loadUserDataPromiseRef.current = null;
          loadingUserIdRef.current = null;
          pendingUserIdRef.current = null;
          setAuthState('unauthenticated');
          return;
        }

        mergeUser(mapUser(session.user));
        // Asked here too, and not only on the signed-out-to-signed-in
        // transition below. Signing in with Google leaves the app for a browser
        // and comes back through a deep link, and a phone under memory pressure
        // will have killed the app in between — so a brand-new user's first
        // session frequently arrives HERE, with no transition to observe, and
        // they reached the dashboard having never seen the intro.
        setAuthState(shouldShowOnboarding(session.user) ? 'onboarding' : 'authenticated');
        maybeLoadUserData(session.user.id, { forceReload: true });
      } else {
        setAuthState('unauthenticated');
      }
    });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setCachedAccessToken(session.access_token);

        if (event === 'SIGNED_IN') {
          markSessionStart();
        }

        mergeUser(mapUser(session.user));
        // The intro belongs to a first sign-in, not to every sign-in. This
        // used to read the transition alone — signed out, now signed in — which
        // is also what happens when the same person comes back after signing
        // out, so they were asked to set the app up from scratch again and the
        // starter budgets replaced their own. See lib/onboardingState.ts.
        setAuthState(prev => {
          // Already in the intro: stay in it. Every token refresh and user
          // update lands here too, and the old expression answered
          // 'authenticated' to all of them — so a refresh while someone was
          // half way through setup closed it under them, with nothing recorded
          // and no way back to it.
          if (prev === 'onboarding') return 'onboarding';
          // Whether this person is new is a fact about the account, not about
          // which event delivered the session — see shouldShowOnboarding. The
          // old test was the transition alone, which is also what a returning
          // user's sign-in looks like, so they were sent through setup again.
          return shouldShowOnboarding(session.user) ? 'onboarding' : 'authenticated';
        });
        maybeLoadUserData(session.user.id, {
          forceReload: event === 'SIGNED_IN',
        });
      } else {
        clearSessionTimestamp();
        clearCachedAccessToken();
        // The next person on this phone should not see the last one's
        // spending flash up behind the sign-in screen.
        clearFirstPaintCache();
        lastLoadedUserIdRef.current = null;
        loadUserDataPromiseRef.current = null;
        loadingUserIdRef.current = null;
        pendingUserIdRef.current = null;
        setAuthState('unauthenticated');
        setAppState(prev => ({ ...prev, user: null }));
      }
    });

    return () => subscription.unsubscribe();
  }, [setAppState, setAuthState, maybeLoadUserData]);
};
