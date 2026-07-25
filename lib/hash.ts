// lib/hash.ts
//
// One djb2 implementation for the whole app. It was previously copy-pasted
// in four places (notificationProcessor's in-memory dedup key and fingerprint
// hash, localNotificationMemory's AI cache key, and useNotificationListener's
// inline key). The listener's copy produced byte-identical output to the
// processor's, so the two dedup layers silently depended on the two copies
// staying in sync.

/** djb2 string hash, as an unsigned 32-bit integer. */
export function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** djb2 rendered in base 36 — the form every call site actually stores. */
export function djb2Base36(input: string): string {
  return djb2(input).toString(36);
}
