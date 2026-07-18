# Stage 4b-i Handoff — Kotlin Branch

**Branch:** `Kotlin`
**Builds on:** Stage 4a (data layer)
**Risk to existing React app:** zero.

## What landed

The home dashboard. Real visual port of `components/Dashboard.tsx`'s
`showParsing === false` branch — the screen you see 95% of the time
when you open the app.

### New files

| File | Purpose | Source port |
|---|---|---|
| `ui/dashboard/BudgetIcons.kt` | Maps budget name to a Material Icons Extended vector | `components/dashboard_components/getBudgetIcon.tsx` |
| `ui/dashboard/TransactionItem.kt` | Single transaction row with all the badges (AI / Projected / Future / Refund / Income) | `components/TransactionItem.tsx` |
| `ui/dashboard/BudgetSection.kt` | Collapsible budget card with spent + projected gradient bars and an expanded transaction list | `components/BudgetSection.tsx` |
| `ui/dashboard/DashboardBalanceSection.kt` | Top-of-dashboard balance number, search button, settings cog, "set monthly income" hint | `components/dashboard_components/DashboardBalanceSection.tsx` |
| `ui/dashboard/DashboardBottomBar.kt` | Fixed bottom bar: home / add transaction / parsing with pending-count badge | `components/dashboard_components/DashboardBottomBar.tsx` |
| `ui/dashboard/DashboardScreen.kt` (rewritten) | The home view composition: balance → list of budget sections → bottom bar | `components/Dashboard.tsx` (home branch) |

### Modified files

- `gradle/libs.versions.toml` + `app/build.gradle.kts` — added
  `androidx.compose.material:material-icons-extended` so we have
  the budget category icons. Already in libs.versions.toml from
  Stage 1; confirmed the dep is wired.

### Tests

- `ui/dashboard/BudgetIconsTest.kt` — 3 cases verifying the icon
  mapping works for all 7 known budget categories and falls back
  sensibly for unknown names.

**Total Kotlin tests: 56 cases** (Stage 4a had 53, this stage adds 3).

## What you can verify locally

```bash
cd android-kotlin
./gradlew :app:testDebugUnitTest     # 56 tests
./gradlew :app:assembleDebug
./gradlew installDebug
# Open the app:
#  - Sign in with Google
#  - Onboard (or skip)
#  - The home dashboard now renders with:
#    - A gradient balance number at the top (green if positive, red if negative)
#    - "Our Remaining Balance" or "Remaining Balance" depending on household mode
#    - A "Find entry..." button that toggles into a search field
#    - A settings cog on the right (Stage 4b-iii wires the modal)
#    - A list of 7 budget cards, each with a spent/projected gradient bar
#    - Tap a budget to expand it; tap again to collapse
#    - Each transaction in the expanded view shows vendor, date, amount, and the right badges
#    - The bottom bar with home / + / parsing buttons
#    - A pending count badge on the parsing button (if you have any)
```

If the dashboard looks plain or the gradient bars are missing colors,
check the `BudgetColors` mapping in `domain/BudgetColors.kt` matches
the React `lib/budgetColors.ts` — they should be byte-for-byte
identical.

## Known limitations / explicit stubs (will be addressed in 4b-ii and 4b-iii)

- **Settings cog is a no-op.** Tapping it does nothing yet.
- **"Find entry..." opens the field but doesn't show results.** The
  `SearchResults` component is in 4b-ii.
- **The + button is a no-op.** Tapping it doesn't open the
  `TransactionForm` yet — that's 4b-ii.
- **The parsing button is a no-op.** Tapping it doesn't show the
  `TransactionParsing` screen — that depends on Stage 6
  (notification listener).
- **No budget flow chart.** `BudgetFlowChart.tsx` (a D3 chart) is the
  largest single visual component and will land in 4b-iv.
- **No search-results panel yet.** Wired when the balance section's
  search is connected.
- **No transaction action modal yet.** Tapping a transaction does
  nothing.
- **No partner transactions visible yet.** The household-merge
  happens in `UserDataRepository.applyHouseholdAndRemap` but we
  don't surface the partner's name badge on the home view yet (the
  `isShared` prop reads from the user's settings, which currently
  may not flip unless the React app's onboarding wrote the right
  values).

## Design decisions specific to this stage

**1. The `BudgetSection` gradient bars are stacked with `Row(weight=...)`.**
The React app uses absolute `width: ${spentWidth}%` and `width:
${projectedWidth}%` on two sibling divs. The Compose port uses
`Row` with `weight` for the same effect, which automatically
animates the bar widths via Compose's layout phase when the
spend value changes. `animateFloatAsState` smooths the
transitions.

**2. The "Other" budget sorts to the bottom.**
The React `DashboardBudgetSectionsList` uses a comparator that
puts `Other` last. The Kotlin port does the same in the
`DashboardScreen` so the visual ordering matches.

**3. The `BottomBar` is fixed at the bottom with `windowInsetsPadding(navigationBars)`.**
The React app uses a `fixed bottom-0` div with a CSS
`env(safe-area-inset-bottom)` padding. The Compose port mirrors
this with the `navigationBars` WindowInsets and a `BottomCenter`
alignment in a `Box`.

**4. The balance number uses `Brush.linearGradient` for the text color.**
React uses `background-clip: text; -webkit-text-fill-color:
transparent` to apply a gradient to the text. Compose has no
direct equivalent, but `TextStyle(brush = Brush.linearGradient(...))`
does the same thing — the brush is sampled per-glyph and applied
as the text's color.

**5. The "+" button in the bottom bar uses a primary-tinted circle
instead of a green/emerald accent.**
The React app uses Tailwind's `bg-emerald-600` directly. Our
Compose `MaterialTheme.colorScheme.primary` is the Material 3
default purple (defined in `ui/theme/Theme.kt`). Stage 4b-iv will
add a custom brand color scheme to make the primary color match
the React app's emerald. For now the visual difference is small
(purple vs emerald) but the layout is correct.

## Stage 4b-ii preview

- `TransactionForm` (port of `components/TransactionForm.tsx`) —
  add a new transaction via the + button
- `TransactionActionModal` (port of `TransactionActionModal.tsx`) —
  tap a transaction to edit/delete
- `SearchResults` (port of `SearchResults.tsx`) — results panel
  when the search field has text
- The `onAddTransaction` / `onTransactionTap` / `onSearchQueryChange`
  hooks in `DashboardScreen` will become real
- Vendor history is loaded once on first session and cached

This is the next 2-3 sub-stages. 4b-iii adds the settings modal
with all 14 sub-sections; 4b-iv adds the budget flow chart.
