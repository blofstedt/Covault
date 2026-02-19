// lib/apiHelpers.ts
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

export const REST_BASE = `${supabaseUrl}/rest/v1`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const getAuthHeaders = async (): Promise<Record<string, string>> => {
  // During initial sign-in, auth state can update before the access token is
  // immediately available to `getSession()`. Retry briefly to avoid firing
  // unauthenticated REST calls that return 401 and leave dashboard data empty.
  let token = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    token = session?.access_token || '';
    if (token) break;

    if (attempt < 3) {
      await sleep(150);
    }
  }

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
