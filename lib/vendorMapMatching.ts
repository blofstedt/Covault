import { fuzzyVendorMatch, leadWordsAgree } from './formatVendorName';
import type { VendorMapEntry } from './localNotificationMemory';

export type VendorMapMatch =
  | { kind: 'primary'; key: string; entry: VendorMapEntry }
  | { kind: 'alias'; key: string; entry: VendorMapEntry }
  | { kind: 'fuzzy'; key: string; entry: VendorMapEntry };

/**
 * Resolve a phone-saved vendor correction without adopting a weak resemblance.
 * The primary incoming key wins, followed by parser-recognized aliases, then
 * the best fuzzy match whose first words still identify the same merchant.
 */
export function findVendorMapMatch(input: {
  entries: Readonly<Record<string, VendorMapEntry>>;
  vendorKey: string;
  aliasKeys: readonly string[];
  incomingName: string;
}): VendorMapMatch | null {
  const primary = input.entries[input.vendorKey];
  if (primary) return { kind: 'primary', key: input.vendorKey, entry: primary };

  for (const key of input.aliasKeys) {
    if (!key) continue;
    const entry = input.entries[key];
    if (entry) return { kind: 'alias', key, entry };
  }

  let best: VendorMapMatch | null = null;
  let bestScore = 0;
  for (const [key, entry] of Object.entries(input.entries)) {
    if (!fuzzyVendorMatch(input.incomingName, entry.vendor_display)) continue;
    if (!leadWordsAgree(input.incomingName, entry.vendor_display)) continue;

    // Prefer a verbatim first word over an abbreviation match. Strictly
    // greater keeps the first stored entry when equally good names compete.
    const storedFirstWord = (entry.vendor_display || '').toLowerCase().split(/\s+/, 1)[0];
    const incomingFirstWord = input.incomingName.toLowerCase().split(/\s+/, 1)[0];
    const score = storedFirstWord && incomingFirstWord && storedFirstWord === incomingFirstWord
      ? 1
      : 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = { kind: 'fuzzy', key, entry };
    }
  }

  return best;
}
