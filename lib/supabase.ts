// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

// ✅ These MUST match what you have in Vercel / .env / GitHub
export const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_PUBLIC_SUPABASE_URL) as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const isSupabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;

if (!isSupabaseConfigured) {
  console.error(
    '❌ Supabase URL or Anon Key is missing. ' +
      'Check your environment variables for VITE_SUPABASE_URL (or VITE_PUBLIC_SUPABASE_URL) and VITE_SUPABASE_ANON_KEY.'
  );
}

// Stub client for misconfiguration
const createStubClient = () =>
  ({
    auth: {
      async getSession() {
        console.warn('[supabase] Stub client in use: getSession');
        return { data: { session: null }, error: null };
      },
      onAuthStateChange(callback?: (event: string, session: unknown | null) => void) {
        console.warn('[supabase] Stub client in use: onAuthStateChange');
        if (callback) setTimeout(() => callback('SIGNED_OUT', null), 0);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      async signOut() {
        console.warn('[supabase] Stub client in use: signOut');
        return { error: { message: 'Supabase is not configured.' } };
      },
      async signInWithOAuth() {
        console.warn('[supabase] Stub client in use: signInWithOAuth');
        return { error: { message: 'Supabase is not configured.' } };
      },
    },
    from() {
      console.warn('[supabase] Stub client in use: from');
      return {
        select: () => this,
        eq: () => this,
        or: () => this,
        gte: () => this,
        ilike: () => this,
        order: () => this,
        limit: () => this,
        insert: () => this,
        update: () => this,
        delete: () => this,
        maybeSingle: async () => ({ data: null, error: { message: 'Supabase is not configured.' } }),
        single: async () => ({ data: null, error: { message: 'Supabase is not configured.' } }),
      };
    },
    functions: {
      async invoke() {
        console.warn('[supabase] Stub client in use: functions.invoke');
        return { data: null, error: { message: 'Supabase is not configured.' } };
      },
    },
  }) as unknown as ReturnType<typeof createClient>;

// Create Supabase client
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        detectSessionInUrl: !Capacitor.isNativePlatform(),
        skipBrowserRedirect: Capacitor.isNativePlatform(),
        flowType: 'pkce',
        // ✅ Use localStorage for web, dynamically import Capacitor Storage for native
        storage: Capacitor.isNativePlatform()
          ? {
              getItem: async (key: string) => {
                const Storage = (await import('@capacitor/storage')).Storage;
                const { value } = await Storage.get({ key });
                return value;
              },
              setItem: async (key: string, value: string) => {
                const Storage = (await import('@capacitor/storage')).Storage;
                await Storage.set({ key, value });
              },
              removeItem: async (key: string) => {
                const Storage = (await import('@capacitor/storage')).Storage;
                await Storage.remove({ key });
              },
            }
          : localStorage,
      },
    })
  : createStubClient();
