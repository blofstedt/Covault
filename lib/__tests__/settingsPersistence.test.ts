import { describe, expect, it } from 'vitest';
import { persistSetting } from '../settings/persistSetting';
import { SettingSaveQueue, type SettingValue } from '../settings/settingSaveQueue';

describe('saving a dashboard setting', () => {
  it('reports success only when the server changed a row', async () => {
    const requests: Array<{ path: string; body: string | null }> = [];
    const request = async (path: string, init: RequestInit) => {
      requests.push({ path, body: String(init.body ?? '') });
      return Response.json([{ user_id: 'user-1', share_level: 'totals' }]);
    };

    await persistSetting('user-1', 'share_level', 'totals', request);

    expect(requests).toEqual([{
      path: '/settings?user_id=eq.user-1',
      body: '{"share_level":"totals"}',
    }]);
  });

  it('rejects a successful response that changed no row', async () => {
    await expect(
      persistSetting('user-1', 'share_level', 'totals', async () => Response.json([])),
    ).rejects.toThrow('updated no settings row');
  });

  it('rejects a failed response', async () => {
    await expect(
      persistSetting('user-1', 'share_level', 'totals', async () =>
        new Response('column missing', { status: 400 }),
      ),
    ).rejects.toThrow('failed (400)');
  });
});

describe('rapid changes to one setting', () => {
  it('restores the last value accepted by the server when the newer choice fails', async () => {
    const queue = new SettingSaveQueue();
    const writes: SettingValue[] = [];
    const rollbacks: SettingValue[] = [];
    const save = async (_key: string, value: SettingValue) => {
      writes.push(value);
      if (value === 'totals') throw new Error('offline');
    };
    const onFailure = (value: SettingValue) => rollbacks.push(value);

    const first = queue.enqueue({
      key: 'shareLevel', value: 'categories', previousValue: 'transactions', save, onFailure,
    });
    const second = queue.enqueue({
      key: 'shareLevel', value: 'totals', previousValue: 'categories', save, onFailure,
    });
    await Promise.all([first, second]);

    expect(writes).toEqual(['categories', 'totals']);
    expect(rollbacks).toEqual(['categories']);
  });

  it('restores the original value when both quick changes fail', async () => {
    const queue = new SettingSaveQueue();
    const rollbacks: SettingValue[] = [];
    const save = async () => { throw new Error('offline'); };
    const onFailure = (value: SettingValue) => rollbacks.push(value);

    const first = queue.enqueue({
      key: 'shareLevel', value: 'categories', previousValue: 'transactions', save, onFailure,
    });
    const second = queue.enqueue({
      key: 'shareLevel', value: 'totals', previousValue: 'categories', save, onFailure,
    });
    await Promise.all([first, second]);

    expect(rollbacks).toEqual(['transactions', 'transactions']);
  });

  it('drops queued writes when the signed-in user changes', async () => {
    const queue = new SettingSaveQueue();
    const writes: SettingValue[] = [];
    const rollbacks: SettingValue[] = [];
    let finishFirst: (() => void) | undefined;
    const firstInFlight = new Promise<void>((resolve) => { finishFirst = resolve; });
    const save = async (_key: string, value: SettingValue) => {
      writes.push(value);
      if (value === 'categories') await firstInFlight;
    };
    const onFailure = (value: SettingValue) => rollbacks.push(value);

    const first = queue.enqueue({
      key: 'shareLevel', value: 'categories', previousValue: 'transactions', save, onFailure,
    });
    const second = queue.enqueue({
      key: 'shareLevel', value: 'totals', previousValue: 'categories', save, onFailure,
    });
    await Promise.resolve();
    queue.clear();
    finishFirst?.();
    await Promise.all([first, second]);

    expect(writes).toEqual(['categories']);
    expect(rollbacks).toEqual([]);
  });
});
