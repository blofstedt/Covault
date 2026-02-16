// Shared budget category color palette
// Each category gets a distinct color used consistently across budget bars, icons, and charts

export const BUDGET_CATEGORY_COLORS: Record<string, string> = {
  Housing:   '#0d9488', // teal-600
  Groceries: '#059669', // emerald-600
  Transport: '#2563eb', // blue-600
  Utilities: '#d97706', // amber-600
  Leisure:   '#9333ea', // purple-600
  Services:  '#0891b2', // cyan-600
  Other:     '#64748b', // slate-500
};

// Fallback colors for unknown category names
const FALLBACK_COLORS: string[] = [
  '#0d9488',
  '#059669',
  '#2563eb',
  '#d97706',
  '#9333ea',
  '#0891b2',
  '#64748b',
  '#e11d48',
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
