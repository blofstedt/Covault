// lib/apiHelpers.ts
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

export const REST_BASE = `${supabaseUrl}/rest/v1`;

export const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token || '';
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
