import { z } from 'zod';

// This module is included only by the explicitly selected Android test build.
// It models the network boundary, not any of Covault's parsing or saving code.
export const TEST_SUPABASE_URL = 'https://covault-android.invalid';
export const TEST_USER_ID = '00000000-0000-4000-8000-000000000001';
export const TEST_BANK_PACKAGE = 'com.covault.fakebank';
const STATE_KEY = 'covault_android_test_database_v1';

const transactionSchema = z.object({
  id: z.string(), user_id: z.string(), vendor: z.string(), amount: z.number(),
  date: z.string(), budget: z.string(), type: z.string(), recur: z.string(),
  is_projected: z.boolean().default(false),
}).passthrough();
const budgetSchema = z.object({
  user_uuid: z.string(), budget: z.string(), amount: z.number(), Visible: z.boolean(),
}).passthrough();
const settingsSchema = z.object({ user_id: z.string() }).passthrough();
const stateSchema = z.object({
  transactions: z.array(transactionSchema),
  budgets: z.array(budgetSchema),
  settings: z.array(settingsSchema),
});
type State = z.infer<typeof stateSchema>;

function initialState(): State {
  return {
    transactions: [{
      id: '00000000-0000-4000-8000-000000000002', user_id: TEST_USER_ID,
      vendor: 'Android Seed Store', amount: 20, date: new Date().toISOString().slice(0, 10),
      budget: 'Groceries', type: 'Manual', recur: 'One-time', is_projected: false,
      created_at: new Date().toISOString(), source: 'manual',
    }],
    budgets: ['Housing', 'Groceries', 'Transport', 'Utilities', 'Leisure', 'Services', 'Other']
      .map(budget => ({ user_uuid: TEST_USER_ID, budget, amount: 500, Visible: true })),
    settings: [{
      user_id: TEST_USER_ID, monthly_income: 5000, theme_selected: 'dark',
      subscription_status: 'active', is_tester: true, budgeting_solo: true,
      partner_id: null, app_notifications_enabled: false, haptics_enabled: true,
      auto_accept_known_vendors: false, smart_notifications_enabled: false,
    }],
  };
}

function response(data: unknown, status = 200): Response {
  return Response.json(data, {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function matches(row: Record<string, unknown>, params: URLSearchParams): boolean {
  for (const [key, value] of params) {
    if (value.startsWith('eq.') && String(row[key]) !== value.slice(3)) return false;
    if (value.startsWith('in.(') && !value.slice(4, -1).split(',').includes(String(row[key]))) return false;
    if (value.startsWith('gte.') && String(row[key]) < value.slice(4)) return false;
    if (value.startsWith('ilike.') && String(row[key]).toLowerCase() !== value.slice(6).toLowerCase()) return false;
  }
  return true;
}

/** Data survives an Activity/process restart, but is erased by Android's clear-data action. */
export function createTestBackend(storage: Pick<Storage, 'getItem' | 'setItem'>, token: string) {
  const stored = storage.getItem(STATE_KEY);
  const state = stored ? stateSchema.parse(JSON.parse(stored)) : initialState();
  const save = () => storage.setItem(STATE_KEY, JSON.stringify(state));
  save();

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.origin !== TEST_SUPABASE_URL) throw new Error('The Android test backend only accepts its reserved test origin.');
    if (request.headers.get('Authorization') !== `Bearer ${token}`) {
      return response({ message: 'Unknown synthetic test session.' }, 401);
    }
    const requestedUser = url.searchParams.get('user_id') ?? url.searchParams.get('user_uuid');
    if (requestedUser && requestedUser !== `eq.${TEST_USER_ID}`) {
      return response({ message: 'Another household is not accessible.' }, 403);
    }
    if (url.pathname === '/auth/v1/user' && request.method === 'GET') {
      return response({ id: TEST_USER_ID, email: 'android@example.test', user_metadata: { full_name: 'Android Test' } });
    }
    if (url.pathname === '/auth/v1/logout' && request.method === 'POST') return response({});
    if (url.pathname === '/rest/v1/rpc/server_now' && request.method === 'POST') return response(new Date().toISOString());
    if (['/rest/v1/overrides', '/rest/v1/notification_rules', '/rest/v1/banking_apps'].includes(url.pathname) && request.method === 'GET') {
      return response([]);
    }

    const table = url.pathname.slice('/rest/v1/'.length);
    if (!url.pathname.startsWith('/rest/v1/') || !['transactions', 'budgets', 'settings'].includes(table)) {
      throw new Error(`Unimplemented Android test endpoint: ${request.method} ${url.pathname}`);
    }
    const tableName = z.enum(['transactions', 'budgets', 'settings']).parse(table);
    if (request.method === 'GET') {
      const rows = state[tableName].filter(row => matches(row, url.searchParams));
      if (request.headers.get('Accept')?.includes('vnd.pgrst.object')) return response(rows[0] ?? null);
      return response(rows);
    }
    if (request.method === 'POST') {
      const body: unknown = await request.json();
      const rows = Array.isArray(body) ? body : [body];
      try {
        const inserted = rows.map(row => {
          if (tableName === 'transactions') return transactionSchema.parse(row);
          if (tableName === 'budgets') return budgetSchema.parse(row);
          return settingsSchema.parse(row);
        });
        if (inserted.some(row => (row.user_id ?? row.user_uuid) !== TEST_USER_ID)) {
          return response({ message: 'Another household is not writable.' }, 403);
        }
        // Only budgets/settings support upsert in this fixture. A duplicate
        // transaction must be rejected so capture deduplication cannot pass by accident.
        if (tableName === 'transactions') {
          const txs = z.array(transactionSchema).parse(inserted);
          if (txs.some(row => state.transactions.some(existing => existing.id === row.id))) {
            return response({ code: '23505', message: 'Duplicate transaction ID.' }, 409);
          }
          state.transactions.push(...txs);
        } else if (tableName === 'budgets') {
          for (const row of z.array(budgetSchema).parse(inserted)) {
            if (!state.budgets.some(existing => existing.budget === row.budget)) state.budgets.push(row);
          }
        } else {
          state.settings = z.array(settingsSchema).parse(inserted);
        }
        save();
        return response(inserted, 201);
      } catch {
        return response({ message: 'Invalid test database row.' }, 400);
      }
    }
    throw new Error(`Unimplemented Android test endpoint: ${request.method} ${url.pathname}`);
  };
}
