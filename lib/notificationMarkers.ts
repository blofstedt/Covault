/** Local marker writes that complete one notification-processing outcome. */
export interface NotificationMarkerStore {
  isProcessed(key: string): boolean;
  markProcessed(key: string): void;
  isRejected(key: string): boolean;
  markRejected(key: string): void;
  addToReviewQueue(transactionId: string): void;
}

export interface RecentNotificationCache {
  set(key: string, at: number): unknown;
}

export function createNotificationMarkers(
  recentCache: RecentNotificationCache,
  store: NotificationMarkerStore,
) {
  return {
    isCaptured(capturedKey: string, legacyKey: string): boolean {
      return store.isProcessed(capturedKey) || store.isProcessed(legacyKey);
    },

    isRejected(key: string): boolean {
      return store.isRejected(key);
    },

    rememberRecent(key: string, at = Date.now()): void {
      recentCache.set(key, at);
    },

    recordRejected(key: string, at = Date.now()): void {
      recentCache.set(key, at);
      store.markRejected(key);
    },

    recordCaptured(inMemoryKey: string, capturedKey: string, at = Date.now()): void {
      recentCache.set(inMemoryKey, at);
      store.markProcessed(capturedKey);
    },

    recordInsertedTransaction(
      inMemoryKey: string,
      capturedKey: string,
      transactionId: string,
      autoAccepted: boolean,
      at = Date.now(),
    ): void {
      if (!autoAccepted) store.addToReviewQueue(transactionId);
      store.markProcessed(capturedKey);
      recentCache.set(inMemoryKey, at);
    },
  };
}
