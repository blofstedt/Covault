// lib/supabase.ts
import { log } from './log';
import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';

// ✅ These MUST match what you have in Vercel / .env / GitHub
// Supports both naming conventions for compatibility:
//   VITE_SUPABASE_URL or VITE_PUBLIC_SUPABASE_URL = https://<your-project-ref>.supabase.co
//   VITE_SUPABASE_ANON_KEY = your anon key
export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || import.meta.env.VITE_PUBLIC_SUPABASE_URL) as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const isSupabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;

if (!isSupabaseConfigured) {
  log.error(
    '❌ Supabase URL or Anon Key is missing. ' +
      'Check your environment variables for VITE_SUPABASE_URL (or VITE_PUBLIC_SUPABASE_URL) and VITE_SUPABASE_ANON_KEY.'
  );
}

// Optional: very simple stub to avoid hard crashes in local dev
const createStubClient = () => {
  const queryBuilder = {
    select() {
      return queryBuilder;
    },
    eq() {
      return queryBuilder;
    },
    or() {
      return queryBuilder;
    },
    gte() {
      return queryBuilder;
    },
    ilike() {
      return queryBuilder;
    },
    order() {
      return queryBuilder;
    },
    limit() {
      return queryBuilder;
    },
    insert() {
      return queryBuilder;
    },
    update() {
      return queryBuilder;
    },
    delete() {
      return queryBuilder;
    },
    async maybeSingle() {
      return {
        data: null,
        error: { message: 'Supabase is not configured.' },
      };
    },
    async single() {
      return {
        data: null,
        error: { message: 'Supabase is not configured.' },
      };
    },
  };

  return {
    auth: {
      async getSession() {
        log.warn('[supabase] Stub client in use: getSession');
        return { data: { session: null }, error: null };
      },
      onAuthStateChange(callback?: (event: string, session: unknown | null) => void) {
        log.warn('[supabase] Stub client in use: onAuthStateChange');
        if (callback) {
          setTimeout(() => callback('SIGNED_OUT', null), 0);
        }
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      async signOut() {
        log.warn('[supabase] Stub client in use: signOut');
        return { error: { message: 'Supabase is not configured.' } };
      },
      async signInWithOAuth() {
        log.warn('[supabase] Stub client in use: signInWithOAuth');
        return { error: { message: 'Supabase is not configured.' } };
      },
    },
    from() {
      log.warn('[supabase] Stub client in use: from');
      return queryBuilder;
    },
    functions: {
      async invoke() {
        log.warn('[supabase] Stub client in use: functions.invoke');
        return { data: null, error: { message: 'Supabase is not configured.' } };
      },
    },
  } as unknown as ReturnType<typeof createClient>;
};

// ✅ Create and export the real Supabase client (or stub if misconfigured)
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Keep the user logged in across page reloads
        persistSession: true,

        // For Android/native apps, we handle deep links manually
        // For web, Supabase auto-detects the session from URL
        detectSessionInUrl: !Capacitor.isNativePlatform(),

        // Recommended for browser-based OAuth flows
        flowType: 'pkce',

        // NOT secure storage, whatever this used to claim. `undefined` means
        // "use supabase-js's default", which is the WebView's own
        // localStorage — so on Android the session, refresh token included,
        // sits in the app's data directory in plain text. That is private to
        // the app on a device that is not rooted, which is why this is left
        // as it is for now; what made it dangerous was the app also allowing
        // backups, so the token was being copied to Google Drive. The
        // manifest now says allowBackup="false". Moving this to the Android
        // keystore is a real improvement and a separate piece of work — do
        // not re-add a comment saying it has already happened.
        storage: Capacitor.isNativePlatform() ? undefined : localStorage,
      },
    })
  : createStubClient();
