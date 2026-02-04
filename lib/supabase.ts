// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// ✅ These MUST match what you have in Vercel / .env
// Vercel:
//   VITE_PUBLIC_SUPABASE_URL = https://xqleyxrftyehodksashu.supabase.co
//   VITE_SUPABASE_ANON_KEY   = your anon key
export const supabaseUrl = import.meta.env.VITE_PUBLIC_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const isSupabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;

if (!isSupabaseConfigured) {
  console.error(
    '❌ Supabase URL or Anon Key is missing. ' +
      'Check your environment variables for VITE_PUBLIC_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  );
}

// Optional: very simple stub to avoid hard crashes in local dev
const createStubClient = () =>
  ({
    auth: {
      async getSession() {
        console.warn('[supabase] Stub client in use: getSession');
        return { data: { session: null }, error: null };
      },
      onAuthStateChange(callback?: (event: string, session: unknown | null) => void) {
        console.warn('[supabase] Stub client in use: onAuthStateChange');
        if (callback) {
          setTimeout(() => callback('SIGNED_OUT', null), 0);
        }
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
        maybeSingle: async () => ({
          data: null,
          error: { message: 'Supabase is not configured.' },
        }),
        single: async () => ({
          data: null,
          error: { message: 'Supabase is not configured.' },
        }),
      };
    },
  }) as unknown as ReturnType<typeof createClient>;

// ✅ Create and export the real Supabase client (or stub if misconfigured)
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        // Keep the user logged in across page reloads
        persistSession: true,

        // 🔥 Critical for browser OAuth:
        // This tells Supabase to read ?code= from the URL when you come back from Google
        detectSessionInUrl: true,

        // Recommended for browser-based OAuth flows
        flowType: 'pkce',
      },
    })
  : createStubClient();
