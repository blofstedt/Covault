export interface VendorRuleMatchFields {
  match_key?: string | null;
  match_type?: string | null;
}

export interface VendorRuleMatch<T> {
  key: string;
  rows: T[];
}

/**
 * Return the rules for the first usable key, preserving the caller's row order.
 * Callers pass the polished vendor key before its aliases so a rule for the
 * name shown to the person wins over a rule for a parser-recognized alias.
 */
export function findFirstMatchingVendorRules<T extends VendorRuleMatchFields>(input: {
  rows: readonly T[];
  keys: readonly string[];
}): VendorRuleMatch<T> | null {
  for (const key of input.keys) {
    const normalizedKey = key.toLowerCase();
    if (!normalizedKey) continue;

    const matchingRows = input.rows.filter((row) => {
      const matchKey = (row.match_key || '').toLowerCase();
      if (!matchKey) return false;

      switch (row.match_type || 'exact') {
        case 'exact':
          return normalizedKey === matchKey;
        case 'prefix':
          return normalizedKey.startsWith(matchKey);
        case 'contains':
          return normalizedKey.includes(matchKey);
        default:
          return false;
      }
    });

    if (matchingRows.length > 0) return { key, rows: matchingRows };
  }

  return null;
}
