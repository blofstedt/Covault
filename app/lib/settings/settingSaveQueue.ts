export type SettingValue = boolean | string | number;

interface PendingSave {
  lastSavedValue: SettingValue;
  count: number;
  tail: Promise<void>;
}

interface SaveRequest {
  key: string;
  value: SettingValue;
  previousValue: SettingValue;
  save: (key: string, value: SettingValue) => Promise<void>;
  onFailure: (lastSavedValue: SettingValue, error: unknown) => void;
}

/**
 * Keep writes to one setting in tap order. If the final queued choice fails,
 * restore the latest value the server accepted, even if earlier writes failed.
 */
export class SettingSaveQueue {
  private pending = new Map<string, PendingSave>();
  private generation = 0;

  enqueue({ key, value, previousValue, save, onFailure }: SaveRequest): Promise<void> {
    const generation = this.generation;
    const entry = this.pending.get(key) ?? {
      lastSavedValue: previousValue,
      count: 0,
      tail: Promise.resolve(),
    };
    this.pending.set(key, entry);
    entry.count += 1;

    entry.tail = entry.tail.then(async () => {
      try {
        if (generation !== this.generation) return;
        await save(key, value);
        if (generation !== this.generation) return;
        entry.lastSavedValue = value;
      } catch (error) {
        // If a newer choice is already waiting, leave its optimistic value in
        // place. The last queued failure restores the last confirmed value.
        if (generation === this.generation && entry.count === 1) {
          onFailure(entry.lastSavedValue, error);
        }
      } finally {
        entry.count -= 1;
        if (entry.count === 0 && this.pending.get(key) === entry) {
          this.pending.delete(key);
        }
      }
    });

    return entry.tail;
  }

  clear(): void {
    this.generation += 1;
    this.pending.clear();
  }
}
