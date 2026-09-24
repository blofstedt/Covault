import { describe, expect, it, vi } from 'vitest';
import { insertNotificationTransaction } from '../notificationPersistence';

describe('insertNotificationTransaction', () => {
  it('inserts a row once when the database accepts it', async () => {
    const row = { id: 'capture-1', vendor: 'Loblaws', amount: 42.11 };
    const insert = vi.fn().mockResolvedValue({ error: null });

    await expect(insertNotificationTransaction(row, insert)).resolves.toBeNull();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(row);
  });

  it('retries without only the optional late-added columns', async () => {
    const row = {
      id: 'capture-1',
      vendor: 'Loblaws',
      amount: 42.11,
      confidence: 0.83,
      auto_filed: true,
      caught_cleared: true,
    };
    const insert = vi.fn()
      .mockResolvedValueOnce({ error: { message: 'column confidence does not exist' } })
      .mockResolvedValueOnce({ error: null });

    await expect(insertNotificationTransaction(row, insert)).resolves.toBeNull();
    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert).toHaveBeenNthCalledWith(1, row);
    expect(insert).toHaveBeenNthCalledWith(2, {
      id: 'capture-1',
      vendor: 'Loblaws',
      amount: 42.11,
      caught_cleared: true,
    });
    expect(row).toHaveProperty('confidence', 0.83);
    expect(row).toHaveProperty('auto_filed', true);
  });

  it('does not retry a failure unrelated to optional columns', async () => {
    const error = { message: 'permission denied' };
    const insert = vi.fn().mockResolvedValue({ error });

    await expect(insertNotificationTransaction({ id: 'capture-1' }, insert)).resolves.toBe(error);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({ id: 'capture-1' });
  });

  it('returns the retry failure when an older schema still rejects the row', async () => {
    const retryError = { message: 'row violates a constraint' };
    const insert = vi.fn()
      .mockResolvedValueOnce({ error: { message: 'column auto_filed does not exist' } })
      .mockResolvedValueOnce({ error: retryError });

    await expect(insertNotificationTransaction({ id: 'capture-1', auto_filed: true }, insert))
      .resolves.toBe(retryError);
    expect(insert).toHaveBeenCalledTimes(2);
  });
});
