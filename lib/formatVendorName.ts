/**
 * Format a vendor name to Title Case (first letter uppercase, rest lowercase).
 * E.g., "AMAZON" → "Amazon", "amazon" → "Amazon", "mCdOnAlDs" → "Mcdonalds"
 */
export function formatVendorName(name: string): string {
  if (!name || !name.trim()) return name.trim();
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Normalize a vendor string for duplicate detection.
 *
 * Strips common bank-notification suffixes that vary between the auto-detected
 * charge and a manually entered template. Without this, "Fizz (Tx. Incl.)" and
 * "Fizz" are treated as different vendors and the system can't recognize them
 * as the same recurring charge.
 *
 * Stripped patterns:
 *   - Parenthetical suffixes: "(Tx. Incl.)", "(Auto)", "(Online)", "(Pre-Auth)"
 *   - Trailing transaction metadata: "REF #1234", "TXN 5678"
 *   - Trailing location codes: "AB", "ON", "QC" (Canadian provinces)
 *   - Trailing store/terminal numbers: "#1234", "STR 567"
 */
export function normalizeVendorForDedup(vendor: string | null | undefined): string {
  if (!vendor) return '';
  let v = String(vendor).toLowerCase().trim();

  // Strip parenthetical suffixes: "(Tx. Incl.)", "(Auto)", "(Online)", etc.
  v = v.replace(/\s*\([^)]*\)\s*/g, ' ');

  // Strip trailing transaction reference numbers
  v = v.replace(/\s*(?:ref|txn|transaction)[\s#:]*\d+\s*$/i, '');

  // Strip trailing store/location/terminal identifiers
  v = v.replace(/\s*#\s*\d+\s*$/, '');
  v = v.replace(/\s+(?:store|str|loc|location|terminal|tml|unit|kiosk)\s*#?\s*\d*$/i, '');

  // Strip trailing Canadian province codes (and common US state abbreviations)
  v = v.replace(/\s+(?:ab|bc|mb|nb|nl|ns|nt|nu|on|pe|qc|sk|yt)\s*$/i, '');
  v = v.replace(/\s+(?:ca|us|uk)\s*$/i, '');

  // Collapse whitespace and normalize to lowercase alphanumeric + spaces
  v = v.replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();

  return v;
}

/**
 * Normalize a vendor string into lowercase alphanumeric tokens for comparison.
 */
function vendorTokens(vendor: string): string[] {
  return vendor
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/**
 * Fuzzy-match two vendor names.
 *
 * Returns true when:
 *   1. Normalized strings are identical, OR
 *   2. One normalized string contains the other, OR
 *   3. Token-level Jaccard similarity ≥ 0.5
 *
 * This catches common cases like:
 *   "PUB MOBILE" ≈ "Public Mobile"
 *   "AMZN MKTP CA" ≈ "Amazon" (after canonical resolution upstream)
 *   "SHOPPERS DRUG MART #23" ≈ "Shoppers Drug Mart"
 */
export function fuzzyVendorMatch(a: string, b: string): boolean {
  if (!a || !b) return false;

  const normA = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normB = b.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) return true;

  // Token-level Jaccard similarity
  const tokA = vendorTokens(a);
  const tokB = vendorTokens(b);
  if (tokA.length === 0 || tokB.length === 0) return false;

  // Check if any significant token (4+ chars) from one appears in the other
  const sigA = tokA.filter(t => t.length >= 4);
  const sigB = tokB.filter(t => t.length >= 4);

  for (const t of sigA) {
    if (sigB.some(s => s.includes(t) || t.includes(s))) return true;
  }
  for (const t of sigB) {
    if (sigA.some(s => s.includes(t) || t.includes(s))) return true;
  }

  // Jaccard on full token sets
  const setA = new Set(tokA);
  const setB = new Set(tokB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 && intersection / union >= 0.5;
}
