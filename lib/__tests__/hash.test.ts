import { describe, it, expect } from 'vitest';
import { djb2, djb2Base36 } from '../hash';
import { buildInMemoryDedupKey } from '../notificationProcessor';

/**
 * These pin the shared helper to the four inline copies it replaced
 * (notificationProcessor's dedup key + fingerprint hash,
 * localNotificationMemory's AI cache key, and useNotificationListener's
 * inline key). If djb2 ever drifts, previously-processed notifications would
 * stop matching their stored keys and get re-captured as duplicates.
 */
const referenceDjb2 = (input: string): number => {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash;
};

describe('djb2', () => {
  const samples = [
    '',
    'a',
    'Scotiabank: Purchase of $56.12 at McDonalds',
    'BMO: You spent $1,204.99 at COSTCO WHOLESALE #123',
    'unicode: café ☕ 東京',
    'x'.repeat(1000),
  ];

  it('matches the inline implementation it replaced', () => {
    for (const s of samples) {
      expect(djb2(s)).toBe(referenceDjb2(s));
    }
  });

  it('stays within unsigned 32-bit range', () => {
    for (const s of samples) {
      const h = djb2(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('renders base36 the way call sites store it', () => {
    for (const s of samples) {
      expect(djb2Base36(s)).toBe(referenceDjb2(s).toString(36));
    }
  });
});

describe('buildInMemoryDedupKey', () => {
  it('keeps the `<bankAppId>|h<hash>` shape both dedup layers rely on', () => {
    const raw = 'Scotiabank: Purchase of $56.12 at McDonalds';
    expect(buildInMemoryDedupKey('com.scotiabank.mobile', raw)).toBe(
      `com.scotiabank.mobile|h${referenceDjb2(raw).toString(36)}`,
    );
  });

  it('falls back to "?" when the bank app id is missing', () => {
    expect(buildInMemoryDedupKey('', 'text')).toBe(`?|h${referenceDjb2('text').toString(36)}`);
  });

  it('gives the same text from different banks distinct keys', () => {
    const raw = 'Purchase of $10.00';
    expect(buildInMemoryDedupKey('bank.a', raw)).not.toBe(buildInMemoryDedupKey('bank.b', raw));
  });

  it('is content-only — it must not vary with the notification timestamp', () => {
    // The timestamp-based key was the source of the double-capture bug.
    const raw = 'Purchase of $10.00';
    expect(buildInMemoryDedupKey('bank.a', raw)).toBe(buildInMemoryDedupKey('bank.a', raw));
  });
});
