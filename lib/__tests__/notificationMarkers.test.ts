import { describe, expect, it, vi } from 'vitest';
import { createNotificationMarkers, type NotificationMarkerStore } from '../notificationMarkers';

function markerStore() {
  const processed = new Set<string>();
  const rejected = new Set<string>();
  const reviewQueue: string[] = [];
  const store: NotificationMarkerStore = {
    isProcessed: vi.fn((key) => processed.has(key)),
    markProcessed: vi.fn((key) => { processed.add(key); }),
    isRejected: vi.fn((key) => rejected.has(key)),
    markRejected: vi.fn((key) => { rejected.add(key); }),
    addToReviewQueue: vi.fn((id) => { reviewQueue.push(id); }),
  };
  return { store, processed, rejected, reviewQueue };
}

describe('notification outcome markers', () => {
  it('keeps rejections provisional while warming the current-session cache', () => {
    const recent = new Map<string, number>();
    const { store, rejected } = markerStore();
    const markers = createNotificationMarkers(recent, store);

    markers.recordRejected('bank|fingerprint', 123);

    expect(recent.get('bank|fingerprint')).toBe(123);
    expect(rejected.has('bank|fingerprint')).toBe(true);
    expect(markers.isRejected('bank|fingerprint')).toBe(true);
    expect(markers.isCaptured('bank|fingerprint', 'legacy-key')).toBe(false);
  });

  it('records a capture under its persistent key and supports the older in-memory key', () => {
    const recent = new Map<string, number>();
    const { store, processed } = markerStore();
    const markers = createNotificationMarkers(recent, store);

    markers.recordCaptured('bank|fingerprint', 'bank|fingerprint|2026-09-24', 456);

    expect(recent.get('bank|fingerprint')).toBe(456);
    expect(processed.has('bank|fingerprint|2026-09-24')).toBe(true);
    expect(markers.isCaptured('bank|fingerprint|2026-09-24', 'bank|fingerprint')).toBe(true);
    expect(markers.isCaptured('missing-key', 'bank|fingerprint')).toBe(false);

    processed.add('legacy-only-key');
    expect(markers.isCaptured('new-captured-key', 'legacy-only-key')).toBe(true);
  });

  it('queues a new row for review unless it was auto-accepted', () => {
    const { store, reviewQueue } = markerStore();
    const recent = new Map<string, number>();
    const markers = createNotificationMarkers(recent, store);

    markers.recordInsertedTransaction('auto-key', 'auto-captured', 'auto-accepted', true, 10);
    markers.recordInsertedTransaction('review-key', 'review-captured', 'needs-review', false, 20);

    expect(reviewQueue).toEqual(['needs-review']);
    expect(markers.isCaptured('auto-captured', 'legacy-auto-key')).toBe(true);
    expect(markers.isCaptured('review-captured', 'legacy-review-key')).toBe(true);
    expect(recent.get('auto-key')).toBe(10);
    expect(recent.get('review-key')).toBe(20);
  });
});
