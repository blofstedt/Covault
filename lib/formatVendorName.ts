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
 * Clean a vendor name a PERSON typed.
 *
 * Trims and collapses whitespace but never touches case. formatVendorName is
 * for taming SHOUTY bank text on the capture path; applying it to a manual edit
 * silently overwrites the user's intent — "A&W" came back as "A&w", so a rename
 * that only changed capitalization saved the value that was already there and
 * looked like nothing happened. Same for IKEA, LCBO, H&M, PayPal, McDonald's.
 */
export function cleanVendorInput(name: string): string {
  return (name || '').trim().replace(/\s+/g, ' ');
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

  // Strip store/location/terminal identifiers ANYWHERE, not just at the end.
  // Anchoring to the end meant "staples #462 ca" kept its store number (the
  // trailing "ca" is stripped on a later line, too late to help), so it never
  // matched the same purchase reported as plain "staples".
  v = v.replace(/\s*#\s*\d+/g, ' ');
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
 * The tokens that carry any identity: everything but store numbers and
 * one- or two-letter fragments ("ca", "us", "st", a stray initial).
 *
 * Falls back to the raw tokens when stripping would leave nothing, so a
 * merchant whose whole name is a number ("7 11") is still comparable.
 */
function identifyingTokens(vendor: string): string[] {
  const all = vendorTokens(vendor);
  const kept = all.filter(t => !/^\d+$/.test(t) && t.length > 2);
  return kept.length > 0 ? kept : all;
}

/**
 * A word with its vowels dropped, which is how banks abbreviate: "AMZN" for
 * Amazon, "MKTP" for Marketplace, "PYMT" for payment. The first letter is
 * always kept, because it is the letter a person recognises the name by.
 */
function consonantSkeleton(word: string): string {
  return word.charAt(0) + word.slice(1).replace(/[aeiou]/g, '');
}

/**
 * Do two single words name the same thing?
 *
 * Three ways to agree: the same word, one the start of the other, or the same
 * word with the vowels squeezed out. The last is why "AMZN Prime" is Amazon
 * Prime — but it needs three consonants to count, or short words start
 * colliding with each other ("bar" and "bear" both reduce to "br").
 *
 * All three are deliberately loose, because this is only ever asked as part of
 * checking a WHOLE name: a prefix is enough between the words of a multi-word
 * name ("PUB MOBILE" / "Public Mobile") because the rest of the name is still
 * being checked. On its own it is not enough — see the single-word rule in
 * fuzzyVendorMatch.
 */
function wordsAgree(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return true;

  if (short.length < 3) return false;
  const skeleton = consonantSkeleton(a);
  return skeleton.length >= 3 && skeleton === consonantSkeleton(b);
}

/**
 * Fuzzy-match two vendor names — "are these the same merchant?"
 *
 * Returns true when:
 *   1. The names are identical once punctuation and spacing are dropped, OR
 *   2. One name is the start of the other ("Staples" / "Staples #462 Ca"), or
 *      appears inside it with enough length to be the name rather than a
 *      descriptor ("SQ *Bloom Cafe" / "Bloom Cafe"), OR
 *   3. The names START with the same word AND every word of the shorter name
 *      is accounted for in the longer one ("Shoppers Drug Mart #23" /
 *      "Shoppers Drugmart").
 *
 * Rule 3 is the one that was wrong, and it was wrong in the direction that
 * costs money. It used to accept ANY shared word of four letters or more,
 * anywhere in either name — so "Bloom Cafe" and "Hero Cafe" were the same
 * merchant, and so were "Kinton Ramen" and "Ramen Danbo", "Joe's Pizza" and
 * "Pizza Hut", and "Calgary Co-op" and "Calgary Public Library". The word
 * people share is precisely the word that says what KIND of business it is,
 * which is the one word that cannot identify which business it is.
 *
 * What that cost: a capture matching the wrong merchant in the phone's local
 * memory arrived in Review wearing the other merchant's name and the other
 * merchant's budget, one careless tap from being filed that way. And two
 * genuinely different merchants charging the same amount on the same day
 * counted as one purchase re-announced, so the second was dropped outright.
 *
 * So the bar is now "the same merchant, spelled differently" rather than "two
 * businesses of the same kind", and where it is unsure it says no. It will
 * miss that two named branches of one chain are the same place ("Wendy's
 * Cochrane" vs "Wendy's Crowfoot" — though either still matches plain
 * "Wendy's" by rule 2). That direction is deliberate: a miss costs a duplicate
 * hint nobody was relying on, while a false match costs a purchase or files
 * one under a stranger's name. `fuzzyVendorMatch.test.ts` pins both directions.
 */
export function fuzzyVendorMatch(a: string, b: string): boolean {
  if (!a || !b) return false;

  const normA = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normB = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normA || !normB) return false;

  if (normA === normB) return true;

  // 2) One name inside the other. A prefix may be short, because a bank
  // appends to a name rather than prepending to it; a match in the MIDDLE has
  // to be long enough to be a name, or "cafe" inside "Hero Cafe" would match
  // every cafe there is.
  const [shortName, longName] = normA.length <= normB.length ? [normA, normB] : [normB, normA];
  if (shortName.length >= 4 && longName.startsWith(shortName)) return true;
  if (shortName.length >= 6 && longName.includes(shortName)) return true;

  // 3) Same first word, and nothing in the shorter name left unexplained.
  const tokA = identifyingTokens(a);
  const tokB = identifyingTokens(b);
  if (tokA.length === 0 || tokB.length === 0) return false;
  if (!wordsAgree(tokA[0], tokB[0])) return false;

  const [fewer, more] = tokA.length <= tokB.length ? [tokA, tokB] : [tokB, tokA];

  // A one-word name has nothing else to corroborate it, so it has to be that
  // word — "Pho" must not swallow "Phoenix Store".
  if (fewer.length === 1) return more.some(t => t === fewer[0]);

  return fewer.every(t => more.some(u => wordsAgree(t, u)));
}
