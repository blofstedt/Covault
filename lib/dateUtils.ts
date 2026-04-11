/**
 * Parse a date string (e.g. "2025-02-01" or "2025-02-01T00:00:00.000Z")
 * into a local Date object without timezone conversion.
 *
 * Using `new Date("2025-02-01T00:00:00.000Z")` shifts the date backwards
 * in timezones west of UTC (e.g. US timezones), causing Feb 1 to display
 * as Jan 31. This helper extracts year/month/day from the string and
 * constructs a Date in the local timezone, avoiding that shift.
 */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}


/**
 * Return today's date as a YYYY-MM-DD string in the user's local timezone.
 *
 * `new Date().toISOString().slice(0, 10)` returns the UTC date, which rolls
 * over to "tomorrow" after ~5-7 PM in US timezones. This helper avoids that
 * by reading year/month/day from the local clock.
 */
export function getLocalToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Return a YYYY-MM key using local calendar parsing semantics.
 */
export function getLocalMonthKey(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
