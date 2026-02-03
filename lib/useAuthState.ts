// lib/useAuthState.ts
import { useCallback, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import type { AppState, User } from '../types';

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
    (userId: string) => {
      if (lastLoadedUserIdRef.current === userId) {
        return loadUserDataPromiseRef.current ?? Promise.resolve();
      }

      if (loadUserDataPromiseRef.current) {
        if (loadingUserIdRef.current === userId) {
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

    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        // Check 14-day window
        if (!isSessionValid()) {
          supabase.auth.signOut();
          clearSessionTimestamp();
          lastLoadedUserIdRef.current = null;
          loadUserDataPromiseRef.current = null;
          loadingUserIdRef.current = null;
          pendingUserIdRef.current = null;
          setAuthState('unauthenticated');
          return;
        }

        const mappedUser = mapUser(session.user);
        setAppState(prev => ({ ...prev, user: mappedUser }));
        setAuthState('authenticated');
        maybeLoadUserData(session.user.id);
      } else {
        setAuthState('unauthenticated');
      }
    });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        if (event === 'SIGNED_IN') {
          markSessionStart();
        }

        const mappedUser = mapUser(session.user);
        setAppState(prev => ({ ...prev, user: mappedUser }));
        setAuthState(prev =>
          prev === 'unauthenticated' ? 'onboarding' : 'authenticated',
        );
        maybeLoadUserData(session.user.id);
      } else {
        clearSessionTimestamp();
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
