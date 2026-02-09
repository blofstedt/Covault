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
