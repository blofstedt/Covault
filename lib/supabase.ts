// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// These come from your Vite env (.env) and MUST start with VITE_
// Example in your .env:
//   VITE_SUPABASE_URL=https://your-project-id.supabase.co
//   VITE_SUPABASE_ANON_KEY=your-anon-key-here

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const isSupabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;

if (!isSupabaseConfigured) {
  console.error(
    '❌ Supabase URL or Anon Key is missing. Check your .env file for VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'
  );
}

const noopPromise = () => Promise.resolve({ data: {}, error: null });
const noopPromiseWithData = () => Promise.resolve({ data: null, error: null });

const createQueryStub = () => {
  const chain: any = {};
  const returnChain = () => chain;

  chain.select = returnChain;
  chain.eq = returnChain;
  chain.or = returnChain;
  chain.gte = returnChain;
  chain.ilike = returnChain;
  chain.order = returnChain;
  chain.limit = returnChain;
  chain.insert = returnChain;
  chain.update = returnChain;
  chain.delete = returnChain;
  chain.maybeSingle = noopPromiseWithData;
  chain.single = noopPromiseWithData;
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(resolve);
  chain.catch = (reject: (reason: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).catch(reject);

  return chain;
};

const createStubClient = () =>
  ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      signOut: async () => ({ error: null }),
    },
    from: () => createQueryStub(),
  }) as unknown as ReturnType<typeof createClient>;

// Create and export the Supabase client
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : createStubClient();
