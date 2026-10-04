// lib/useAuthState.ts
import { log } from '../lib/observability/log';
import React, { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/api/supabase';
import { clearCachedAccessToken, setCachedAccessToken } from '../lib/api/apiHelpers';
import { clearFirstPaintCache } from '../lib/cache/firstPaintCache';
import { queryClient } from '../lib/cache/queryClient';
import type { AppState, User } from '../types';
import { DEFAULT_SETTINGS, resetSettingsForAccount } from '../lib/settings/defaultSettings';
import {
  isCurrentAccountDataScope,
  transitionAccountDataScope,
  type AccountDataScope,
  type AccountDataScopeRef,
} from '../lib/auth/accountScope';

import { shouldShowOnboarding } from './onboardingState';

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
  loadUserData: (userId: string, scope: AccountDataScope) => Promise<void>;
  accountScopeRef?: AccountDataScopeRef;
}

export const useAuthState = ({
  setAppState,
  setAuthState,
  loadUserData,
  accountScopeRef: providedAccountScopeRef,
}: UseAuthStateParams) => {
  const internalAccountScopeRef = useRef<AccountDataScope>({ userId: null, generation: 0 });
  const accountScopeRef = providedAccountScopeRef ?? internalAccountScopeRef;
  const lastLoadedScopeRef = useRef<AccountDataScope | null>(null);
  const loadUserDataPromiseRef = useRef<{
    scope: AccountDataScope;
    promise: Promise<void>;
  } | null>(null);

  const maybeLoadUserData = useCallback(
    (scope: AccountDataScope, { forceReload = false }: { forceReload?: boolean } = {}) => {
      const { userId } = scope;
      if (!userId || !isCurrentAccountDataScope(accountScopeRef, scope)) {
        return Promise.resolve();
      }

      const lastLoadedScope = lastLoadedScopeRef.current;
      if (!forceReload && lastLoadedScope?.userId === userId
        && lastLoadedScope.generation === scope.generation) {
        return Promise.resolve();
      }

      const activeLoad = loadUserDataPromiseRef.current;
      if (activeLoad?.scope.userId === userId
        && activeLoad.scope.generation === scope.generation) {
        return activeLoad.promise;
      }

      const loadRecord: { scope: AccountDataScope; promise: Promise<void> } = {
        scope,
        promise: Promise.resolve(),
      };
      const loadPromise = Promise.resolve()
        .then(() => loadUserData(userId, scope))
        .then(() => {
          if (isCurrentAccountDataScope(accountScopeRef, scope)) {
            lastLoadedScopeRef.current = scope;
          }
        })
        .catch(error => {
          log.error(
            `[useAuthState] Error loading data for user ${userId}:`,
            error,
          );
        })
        .finally(() => {
          // An older account load may finish after the new account has started.
          // It must not release or replace the newer account's load record.
          if (loadUserDataPromiseRef.current === loadRecord) {
            loadUserDataPromiseRef.current = null;
          }
        });
      loadRecord.promise = loadPromise;
      loadUserDataPromiseRef.current = loadRecord;
      return loadPromise;
    },
    [accountScopeRef, loadUserData],
  );

  const resetAccountState = useCallback(
    (user: User | null) => {
      setAppState(prev => ({
        ...prev,
        user,
        budgets: [],
        transactions: [],
        partnerIncome: null,
        partnerSummary: null,
        partnerBudgets: null,
        settings: resetSettingsForAccount(prev.settings ?? DEFAULT_SETTINGS),
      }));
    },
    [setAppState],
  );

  useEffect(() => {
    let authEventRevision = 0;
    let disposed = false;

    // Helper: map Supabase user to your internal User type
    const mapUser = (sessionUser: any): User => ({
      id: sessionUser.id,
      name:
        sessionUser.user_metadata?.full_name ||
        sessionUser.email?.split('@', 1)[0] ||
        'User',
      email: sessionUser.email || '',
      hasJointAccounts: false,
      budgetingSolo: true,
      monthlyIncome: 0, // Will be loaded from DB by loadUserData()
    });

    // Merge mapped user into state, preserving DB-loaded fields for the same user
    const mergeUser = (mappedUser: User): AccountDataScope => {
      const oldScope = accountScopeRef.current;
      const changedAccount = oldScope.userId !== mappedUser.id;
      const scope = transitionAccountDataScope(accountScopeRef, mappedUser.id);

      if (changedAccount) {
        // Keep a matching first-paint snapshot on a cold launch (null → first
        // authenticated owner), but remove the old owner's cached screen data
        // when a live session changes identities.
        if (oldScope.userId !== null || oldScope.generation > 0) {
          clearFirstPaintCache();
          queryClient.clear();
        }
        // Clear old-account rows and settings in the same state update that
        // makes the new identity visible. Device preferences stay local.
        resetAccountState(mappedUser);
        lastLoadedScopeRef.current = null;
        loadUserDataPromiseRef.current = null;
        return scope;
      }

      setAppState(prev => ({
        ...prev,
        user: prev.user?.id === mappedUser.id
          ? {
              // Preserve DB-loaded fields for the same account and refresh only
              // values supplied by the auth session.
              ...prev.user,
              id: mappedUser.id,
              name: mappedUser.name,
              email: mappedUser.email,
            }
          : mappedUser,
      }));
      return scope;
    };

    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      // An auth event is newer evidence than the startup session request. A
      // slow getSession response must not sign the app back into an old user.
      if (disposed || authEventRevision > 0) return;
      setCachedAccessToken(session?.access_token);
      if (session?.user) {
        // Check 14-day window
        if (!isSessionValid()) {
          supabase.auth.signOut();
          clearSessionTimestamp();
          clearCachedAccessToken();
          clearFirstPaintCache();
          queryClient.clear();
          transitionAccountDataScope(accountScopeRef, null);
          lastLoadedScopeRef.current = null;
          loadUserDataPromiseRef.current = null;
          resetAccountState(null);
          setAuthState('unauthenticated');
          return;
        }

        const scope = mergeUser(mapUser(session.user));
        // Asked here too, and not only on the signed-out-to-signed-in
        // transition below. Signing in with Google leaves the app for a browser
        // and comes back through a deep link, and a phone under memory pressure
        // will have killed the app in between — so a brand-new user's first
        // session frequently arrives HERE, with no transition to observe, and
        // they reached the dashboard having never seen the intro.
        setAuthState(shouldShowOnboarding(session.user) ? 'onboarding' : 'authenticated');
        maybeLoadUserData(scope, { forceReload: true });
      } else {
        setAuthState('unauthenticated');
      }
    }).catch(() => {
      if (disposed || authEventRevision > 0) return;
      log.error('[Auth] Could not read the initial sign-in session.');
      setAuthState(state => state === 'loading' ? 'unauthenticated' : state);
    });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      authEventRevision += 1;
      if (session?.user) {
        setCachedAccessToken(session.access_token);

        if (event === 'SIGNED_IN') {
          markSessionStart();
        }

        const scope = mergeUser(mapUser(session.user));
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
        maybeLoadUserData(scope, {
          forceReload: event === 'SIGNED_IN',
        });
      } else {
        clearSessionTimestamp();
        clearCachedAccessToken();
        // The next person on this phone should not see the last one's
        // spending flash up behind the sign-in screen.
        clearFirstPaintCache();
        queryClient.clear();
        transitionAccountDataScope(accountScopeRef, null);
        lastLoadedScopeRef.current = null;
        loadUserDataPromiseRef.current = null;
        setAuthState('unauthenticated');
        resetAccountState(null);
      }
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
  }, [accountScopeRef, maybeLoadUserData, resetAccountState, setAppState, setAuthState]);
};
