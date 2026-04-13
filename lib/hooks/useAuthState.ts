// lib/useAuthState.ts
import React, { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { clearCachedAccessToken, setCachedAccessToken } from '../apiHelpers';
import type { AppState, User } from '../../types';

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
              console.error(
                `[useAuthState] Error loading pending user data for user ${pendingUserId}. This may indicate a network issue or invalid user ID:`,
                error,
              );
              setAuthState('unauthenticated');
              setAppState(prev => ({ ...prev, user: null }));
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
          ? { ...prev.user, ...mappedUser, monthlyIncome: prev.user.monthlyIncome }
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
          lastLoadedUserIdRef.current = null;
          loadUserDataPromiseRef.current = null;
          loadingUserIdRef.current = null;
          pendingUserIdRef.current = null;
          setAuthState('unauthenticated');
          return;
        }

        mergeUser(mapUser(session.user));
        setAuthState('authenticated');
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
        setAuthState(prev =>
          prev === 'unauthenticated' ? 'onboarding' : 'authenticated',
        );
        maybeLoadUserData(session.user.id, {
          forceReload: event === 'SIGNED_IN',
        });
      } else {
        clearSessionTimestamp();
        clearCachedAccessToken();
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
