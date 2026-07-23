# Stage 4b-iii Handoff — Kotlin Branch

**Branch:** `Kotlin`
**Builds on:** Stage 4b-ii (add/edit/delete + search)
**Risk to existing React app:** zero.

## What landed

The full settings modal with all 14 sub-sections, plus the two
repositories that back the writes.

### New files

| File | Purpose | Source port |
|---|---|---|
| `ui/dashboard/SettingsModalSections.kt` | 14 sub-sections + the modal composable: FAQ button, Income, Budget Limits, Theme, Notification listener, Rollover, Smart Notifications, Discretionary Shield, Vault Sharing, Export, Import, Report, Support, Sign Out | `components/dashboard_components/DashboardSettingsModal.tsx` + `settings_modal_components/*` |
| `data/repository/SettingsRepository.kt` | Settings table CRUD + partner link/unlink | `lib/hooks/useUserSettings.ts` + `lib/hooks/useHouseholdLinking.ts` |
| `data/repository/BudgetRepository.kt` | `budgets` table CRUD for per-user limits and visibility | `lib/hooks/useUserSettings.ts` |

### Modified files

| File | Change |
|---|---|
| `ui/dashboard/DashboardViewModel.kt` | Added `updateIncome`, `updateBudgetLimit`, `linkPartner`, `unlinkPartner`, `signOut`. Injected the new repositories. |
| `ui/dashboard/DashboardScreen.kt` | Wired the settings modal: state for `showSettings`, `partnerLinkEmail`, `isLinkingPartner`, `themeOverride`. Settings cog now opens the modal. |

## What you can verify on device

- Tap the settings cog at the top of the dashboard
- The full settings modal opens with all 14 sections
- Edit monthly income → save → refresh dashboard → income persisted
- Edit a budget limit → save → budget bar updates
- Toggle theme → dashboard renders in the new theme (Stage 4b-iv retunes the brand colors; the toggle itself works)
- Connect / disconnect partner → settings row updated
- Sign out → returns to auth screen

## Stage 4b-iv preview (next, then I'm stopping UI work)

The budget flow chart (`BudgetFlowChart.tsx`) — a D3 chart that
visualizes the spent / projected / limit per budget. ~150 LOC.
After that, the dashboard is feature-complete with the React app
(at least for the manual-entry flow; the AI notification flow is
Stage 6).

I'll then stop UI work and move to:
- Stage 5: household linking polish (the `useHouseholdLinking` flow)
- Stage 6: notification listener + AI extraction (notification-driven
  transactions)
- Stage 7: recurring executor + projection (future-dated recurring
  rows)
- Stage 8: cleanup + removing the React app from the branch
