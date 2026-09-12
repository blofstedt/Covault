// lib/vialDensity.ts
//
// How much of itself a collapsed budget vial can afford to show.
//
// On mobile the collapsed vials share ONE fixed-height column. They never
// scroll — every row is `flex: 1` with `min-height: 0` inside a container the
// height of the screen minus the balance, the chart and the bottom bar (see
// DashboardBudgetSectionsList, which explains why that container deliberately
// never flips to `overflow-y: auto`). So each category you switch on does not
// add height to the page, it takes height off every other vial.
//
// Measured on a 393x852 phone, with the chart at the height it renders at
// rest:
//
//   7 vials → 53px each   the two-line row's natural size. Comfortable.
//   8 vials → 45px        two-line starts losing its padding
//   9 vials → 39px        two-line has visibly none left
//  10 vials → 34px        two-line runs edge to edge
//
// Nothing is literally truncated at any of those — checked against the
// browser's own rendering rather than assumed — but from eight upward the row
// is wearing its padding as slack, and by ten it reads as cramped. That is a
// look problem, and on this app a look problem is a real problem.
//
// So past seven the row drops its second line ("$288 left") and keeps the name
// and the limit: the same pair the card already shows while it is expanded,
// tightened. Its natural height is about 30px, which fits all of eight, nine
// and ten with room to spare — so the fix holds for every count the app
// offers, rather than buying one more category and breaking at the next.
//
// Why a count and not a measurement: a measured threshold would have to be
// re-read on resize and could flip mid-expand, changing padding and font size
// on the same frame the 320ms expand transition starts. That is precisely the
// class of hitch the constant `overflow-hidden` in
// DashboardBudgetSectionsList exists to avoid. A count cannot flicker.
//
// The trade-off that comes with that: on a much taller phone, eight two-line
// vials might genuinely have fitted, and this gives up their second line
// anyway. Losing one line on a tall screen is a smaller cost than a row that
// reads as broken on an ordinary one.

/**
 * The first vial count at which the collapsed row drops to one line.
 *
 * Seven is the most that renders at the two-line row's natural height, so
 * eight is where the density changes.
 */
export const DENSE_ROW_THRESHOLD = 8;

/**
 * Whether the collapsed rows should show one line (name and limit) instead of
 * two (name, "$288 left", and limit).
 *
 * Only ever consulted while every card is collapsed — an expanded card has
 * the whole column to itself and is drawn at full size regardless.
 */
export function shouldUseDenseRows(visibleCount: number): boolean {
  return (Number(visibleCount) || 0) >= DENSE_ROW_THRESHOLD;
}
