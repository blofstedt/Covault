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

const noopPromiseWithData = () => Promise.resolve({ data: null, error: null });

type QueryStub = {
  select: () => QueryStub;
  eq: () => QueryStub;
  or: () => QueryStub;
  gte: () => QueryStub;
  ilike: () => QueryStub;
  order: () => QueryStub;
  limit: () => QueryStub;
  insert: () => QueryStub;
  update: () => QueryStub;
  delete: () => QueryStub;
  maybeSingle: () => Promise<{ data: null; error: null }>;
  single: () => Promise<{ data: null; error: null }>;
  then: PromiseLike<{ data: null; error: null }>['then'];
  catch: PromiseLike<{ data: null; error: null }>['catch'];
};

const createQueryStub = (): QueryStub => {
  const chain = {} as QueryStub;
  const returnChain = () => chain;
  const resolved = Promise.resolve({
    data: null,
    error: { message: 'Supabase is not configured.' },
  });

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
  chain.then = (...args) => resolved.then(...args);
  chain.catch = (...args) => resolved.catch(...args);

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
