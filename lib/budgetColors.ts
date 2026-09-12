// Shared budget category color palette
// Each category gets a distinct color used consistently across budget bars, icons, and charts

// Every category gets its OWN hue. The fallback list below exists for names
// this map does not know, and it repeats — so a category missing from here is
// not merely "a bit similar" to another vial, it is drawn in the identical
// colour. Shopping and Personal would have arrived as exact copies of
// Housing's teal and Groceries' green.
//
// The three later additions sit in the hues the original seven leave free:
// rose, orchid, and a marine dark enough to read apart from Services' cyan at
// a glance. Ten is the comfortable limit of this family — an eleventh would
// have to start repeating a hue at a different weight.
export const BUDGET_CATEGORY_COLORS: Record<string, string> = {
  Housing:   '#5b9e97', // muted teal
  Groceries: '#6b9e6e', // muted green
  Transport: '#6e8ec4', // muted blue
  Utilities: '#c49a4a', // muted amber
  Leisure:   '#9a7bbf', // muted purple
  Services:  '#5ea0ad', // muted cyan
  Shopping:  '#c0757f', // muted rose
  Personal:  '#b478ad', // muted orchid
  Travel:    '#4a7f96', // deep marine
  Other:     '#8a95a3', // muted slate
};

// Fallback colors for unknown category names
const FALLBACK_COLORS: string[] = [
  '#5b9e97',
  '#6b9e6e',
  '#6e8ec4',
  '#c49a4a',
  '#9a7bbf',
  '#5ea0ad',
  '#8a95a3',
  '#c48a5a',
];

/**
 * Get the solid color for a budget category.
 * Returns a consistent color for known categories, or a fallback color based on index.
 */
export function getBudgetColor(name: string, index: number = 0): string {
  return BUDGET_CATEGORY_COLORS[name] || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

/**
 * Get the gradient pair [start, end] for a budget category (for chart use).
 * The start is the main color and the end is a lighter/brighter variant.
 */
export function getBudgetGradient(name: string, index: number = 0): [string, string] {
  const base = getBudgetColor(name, index);
  // Use the base color as gradient start, and a brighter variant as gradient end
  return [base, lightenColor(base, 30)];
}

/**
 * Lighten a hex color by a percentage (0-100).
 */
function lightenColor(hex: string, percent: number): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + Math.round((255 - (num >> 16)) * (percent / 100)));
  const g = Math.min(255, ((num >> 8) & 0x00ff) + Math.round((255 - ((num >> 8) & 0x00ff)) * (percent / 100)));
  const b = Math.min(255, (num & 0x0000ff) + Math.round((255 - (num & 0x0000ff)) * (percent / 100)));
  return `#${(0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
