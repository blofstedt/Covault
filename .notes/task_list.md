# Task List — current priorities & known follow-ups

Keep this short and current. Tick items as they land; add new ones on top.

## ▶ NEXT UP: Dashboard / chart / settings / rules design parity with React
Goal: dashboard, `<>` (Learned Rules) screen, and settings **closely mirror the
old React app's layout & design**. React sources are in git history before the
"Remove React" commit — read them for reference:
`git show 45864ad~1:components/<path>`.

**Balance header** — `ui/dashboard/DashboardBalanceSection.kt`
(React ref: `components/dashboard_components/DashboardBalanceSection.tsx`)
- [ ] Remove the "Set monthly income in settings" hint text.
- [ ] Center "Remaining Balance"; make its font slightly bigger.
- [ ] Add a soft glow/blur behind the balance number, colored by sign
      (emerald for positive, rose/red for negative), **no sharp edges** —
      a radial-gradient blur, subtly animated (fade/pulse).

**Budget flow chart** — `ui/dashboard/BudgetFlowChart.kt`
(React ref: `components/dashboard_components/BudgetFlowChart.tsx` — D3)
- [ ] Fade the chart out at the **left and right edges** (horizontal alpha
      gradient mask so the areas dissolve into the card edges).
- [ ] Make the chart **smaller / shorter** so all collapsed budget cards stay
      visible without scrolling.
- [ ] Polish the visual to match React (gradient bands, smoothing, spacing).
- [ ] **Morph on expand:** when a budget card is expanded, the chart animates to
      show ONLY that budget's band/section; collapse animates back to the full
      stack. Animation must be **smooth** (animate the paths/alpha, don't snap).
      Needs the expanded-budget id passed from `DashboardScreen`/`BudgetSection`
      into the chart (React did this via `highlightedBudgetId`).

**Budget cards / expand** — `ui/dashboard/BudgetSection.kt`, `DashboardScreen.kt`
- [ ] Wire the expanded-budget id to the chart so the morph above can trigger.
- [ ] Verify collapsed layout matches React (spacing, so all 7 are visible).

**Settings menu** — `ui/dashboard/SettingsModalSections.kt`
(React ref: `components/dashboard_components/DashboardSettingsModal.tsx` + the
`settings_modal_components/` folder)
- [ ] Rework layout/styling to closely mirror React (card look, section order,
      headers). Owner reports the current Kotlin settings "looks messed up."

**Learned Rules `<>` screen** — `ui/dashboard/LearnedRulesModal.kt`
(React ref: `components/transaction_parsing/LearnedRulesCard.tsx` and siblings)
- [ ] Rework to mirror React's rules UI (owner reports it "looks messed up" and
      the entry icon changed). Confirm the entry affordance/icon matches React.

Verification for all of the above: `./gradlew :app:compileDebugKotlin` +
`:app:testDebugUnitTest` in CI, then **owner device-test** (animations, glow,
morph, and layout can't be verified by CI).

## Needs owner device-testing (CI can't verify)
- [ ] Sign-in completes end-to-end (the `/callback` redirect fix).
- [ ] `SystemCategories.idForName` fix: budget limits persist across app restarts,
      and per-category spend fills its budget card.
- [ ] Income "Save" persists after reopening the app.
- [ ] Budget chart renders as a smoothed multi-month stacked area (tune curve
      tension / spacing if it looks off).
- [ ] Settings → Bank Notification Listener: status pill + "Grant/Manage
      notification access" opens the system page and flips green on return.
- [ ] Learned Rules screen loads and is legible (was likely the old theme bug).

## Deferred cleanup (do in a fresh, focused session)
- [ ] Unused-import sweep (~60 lines across many files). Warnings only; low value,
      high edit-count — batch it and let CI compile gate it.
- [ ] Optional: remove the 6 `@Preview` composables (recommended: keep them).

## Product decisions (not cleanup — ask the owner first)
- [ ] Premium/subscription gating was removed as dead code. Decide if it should
      come back.
- [ ] Banking-app picker in the notification section (needs a native package
      query) was not ported from React.

## Housekeeping
- [ ] Rotate the Supabase PAT once all work is finished.
