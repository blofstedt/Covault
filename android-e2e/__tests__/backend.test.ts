import { describe, expect, it } from 'vitest';
import { createTestBackend, TEST_SUPABASE_URL, TEST_USER_ID } from '../backend';

function fixture() {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  return { storage, backend: createTestBackend(storage, 'test-session') };
}

function request(path: string, method = 'GET', body?: unknown, token = 'test-session') {
  return new Request(`${TEST_SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const purchase = {
  id: 'saved-purchase', user_id: TEST_USER_ID, vendor: 'Android Corner Store', amount: 12.34,
  date: '2026-10-04', budget: 'Groceries', type: 'Manual', recur: 'One-time', is_projected: false,
};

describe('isolated Android test database', () => {
  it('saves cents and retains the purchase when a new app instance opens', async () => {
    const { backend, storage } = fixture();
    const saved = await backend(request('transactions', 'POST', purchase));
    expect(saved.status).toBe(201);
    expect(await saved.json()).toEqual([purchase]);
    const reopened = createTestBackend(storage, 'new-session');
    const read = await reopened(request('transactions?id=eq.saved-purchase', 'GET', undefined, 'new-session'));
    expect(await read.json()).toEqual([purchase]);
  });

  it('rejects an unknown session and a different household without losing the test household', async () => {
    const { backend } = fixture();
    expect((await backend(request('transactions', 'GET', undefined, 'wrong-session'))).status).toBe(401);
    expect((await backend(request('transactions?user_id=eq.somebody-else'))).status).toBe(403);
    expect((await backend(request('transactions', 'POST', { ...purchase, user_id: 'somebody-else' }))).status).toBe(403);
    const read = await backend(request('transactions'));
    expect(await read.json()).toMatchObject([{ vendor: 'Android Seed Store', amount: 20, user_id: TEST_USER_ID }]);
  });

  it('rejects duplicate IDs instead of hiding a broken capture deduplication path', async () => {
    const { backend } = fixture();
    await backend(request('transactions', 'POST', purchase));
    const duplicate = await backend(request('transactions', 'POST', purchase));
    expect(duplicate.status).toBe(409);
    const read = await backend(request('transactions?id=eq.saved-purchase'));
    expect(await read.json()).toEqual([purchase]);
  });

  it('refuses text amounts and leaves the seeded purchase intact', async () => {
    const { backend } = fixture();
    expect((await backend(request('transactions', 'POST', { ...purchase, amount: '12abc' }))).status).toBe(400);
    expect(await (await backend(request('transactions'))).json()).toMatchObject([{ vendor: 'Android Seed Store', amount: 20 }]);
  });

  it('fails on unsupported endpoints and real network origins', async () => {
    const { backend } = fixture();
    await expect(backend(request('unexpected-table'))).rejects.toThrow('Unimplemented Android test endpoint');
    await expect(backend(new Request('https://production.example/rest/v1/transactions'))).rejects.toThrow('reserved test origin');
    expect(await (await backend(request('transactions'))).json()).toMatchObject([{ vendor: 'Android Seed Store', amount: 20 }]);
  });
});
