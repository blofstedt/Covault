// Unique colors per budget category — used in both the bar chart and transaction list.
// Each entry maps a lowercase category keyword to a pair of [primary, light] colors.
const BUDGET_COLORS: Record<string, { primary: string; light: string; bg: string }> = {
  housing:   { primary: '#6366f1', light: '#a5b4fc', bg: 'bg-indigo-500/15 dark:bg-indigo-500/20' },   // indigo
  groceries: { primary: '#22c55e', light: '#86efac', bg: 'bg-green-500/15 dark:bg-green-500/20' },      // green
  transport: { primary: '#f59e0b', light: '#fcd34d', bg: 'bg-amber-500/15 dark:bg-amber-500/20' },      // amber
  utilities: { primary: '#3b82f6', light: '#93c5fd', bg: 'bg-blue-500/15 dark:bg-blue-500/20' },        // blue
  leisure:   { primary: '#ec4899', light: '#f9a8d4', bg: 'bg-pink-500/15 dark:bg-pink-500/20' },        // pink
  services:  { primary: '#8b5cf6', light: '#c4b5fd', bg: 'bg-violet-500/15 dark:bg-violet-500/20' },    // violet
  dining:    { primary: '#f97316', light: '#fdba74', bg: 'bg-orange-500/15 dark:bg-orange-500/20' },     // orange
  other:     { primary: '#64748b', light: '#cbd5e1', bg: 'bg-slate-500/15 dark:bg-slate-500/20' },       // slate
};

// Fallback palette for categories not matching known keywords
const FALLBACK_PALETTE = [
  { primary: '#14b8a6', light: '#5eead4', bg: 'bg-teal-500/15 dark:bg-teal-500/20' },      // teal
  { primary: '#e11d48', light: '#fda4af', bg: 'bg-rose-500/15 dark:bg-rose-500/20' },       // rose
  { primary: '#06b6d4', light: '#67e8f9', bg: 'bg-cyan-500/15 dark:bg-cyan-500/20' },       // cyan
  { primary: '#84cc16', light: '#bef264', bg: 'bg-lime-500/15 dark:bg-lime-500/20' },       // lime
  { primary: '#a855f7', light: '#d8b4fe', bg: 'bg-purple-500/15 dark:bg-purple-500/20' },   // purple
  { primary: '#ef4444', light: '#fca5a5', bg: 'bg-red-500/15 dark:bg-red-500/20' },         // red
];

export function getBudgetColor(name: string, index: number): { primary: string; light: string; bg: string } {
  const lower = name.toLowerCase();
  for (const key of Object.keys(BUDGET_COLORS)) {
    if (lower.includes(key)) {
      return BUDGET_COLORS[key];
    }
  }
  return FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
}
