// lib/apiHelpers.ts
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

export const REST_BASE = `${supabaseUrl}/rest/v1`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let cachedAccessToken = '';

export const setCachedAccessToken = (token?: string | null) => {
  cachedAccessToken = token || '';
};

export const clearCachedAccessToken = () => {
  cachedAccessToken = '';
};

/** Returns true if the JWT is expired or within 90 seconds of expiry. */
const isTokenStale = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return Date.now() > (payload.exp * 1000) - 90_000;
  } catch {
    return true;
  }
};

const readAccessToken = async (): Promise<string> => {
  if (cachedAccessToken && !isTokenStale(cachedAccessToken)) return cachedAccessToken;

  // During initial sign-in, auth state can update before the access token is
  // immediately available to `getSession()`. Retry briefly to avoid firing
  // unauthenticated REST calls that return 401 and leave dashboard data empty.
  for (let attempt = 0; attempt < 8; attempt++) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    const token = session?.access_token || '';
    if (token) {
      cachedAccessToken = token;
      return token;
    }

    if (attempt < 7) {
      await sleep(200);
    }
  }

  return '';
};

export const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const token = await readAccessToken();

  return {
    apikey: supabaseAnonKey || '',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

// Default budget limit when user has not set a budget
export const DEFAULT_BUDGET_LIMIT = 500;

// Default monthly income when user has not set income
export const DEFAULT_MONTHLY_INCOME = 5000;
