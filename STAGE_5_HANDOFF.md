# Stage 5 Handoff — Kotlin Branch

**Branch:** `Kotlin`
**Builds on:** Stage 4b-iv
**Risk to existing React app:** zero.

## What landed

Polish + missing pieces that the React app has but the Kotlin port
didn't: FAQ modal, premium gate, household-linking edge cases.

### New files

| File | Purpose | Source port |
|---|---|---|
| `ui/dashboard/FAQModal.kt` | The "Frequently Asked" modal with 6 Q&As about Covault. Opened from the settings modal's FAQ button | `components/dashboard_components/FAQModal.tsx` |
| `ui/dashboard/PremiumGate.kt` | Wraps a section so non-premium users see an upsell | `components/PremiumGate.tsx` |

### Modified files

| File | Change |
|---|---|
| `ui/dashboard/SettingsModalSections.kt` | Added `onShowFAQ` parameter. FAQ button now opens the FAQ modal. Notification listener and Discretionary Shield are wrapped in `PremiumGate` (currently always `hasPremium = true`). |
| `ui/dashboard/DashboardScreen.kt` | Added `showFAQ` state. Wired the FAQ modal to the settings modal's `onShowFAQ` callback. |

## What you can verify on device

- Open settings → tap "Frequently Asked" → FAQ modal with 6 expandable Q&As
- The notification listener and discretionary shield sections render
  inside the `PremiumGate` (today, with `hasPremium = true`, they
  just show as normal sections; flip the `hasPremium` parameter in
  `DashboardSettingsModal(...)` to `false` to see the upsell)

## Household linking

The Stage 4b-iii `linkPartner` / `unlinkPartner` repository calls
already cover the core flow. The React `useHouseholdLinking` hook
also handles two edge cases:
- `handleGenerateLinkCode`: generates a short invite code (e.g.
  `COVAULT-XYZ123`) that the user can share verbally; the partner
  enters the code in their app to link.
- `handleJoinWithCode`: the partner side of the same flow.

The Kotlin port doesn't ship these yet. The email-based link flow
in Stage 4b-iii covers the main use case; the invite-code flow
is a UX shortcut for partners who don't want to share their email.

Adding it is a ~50-LOC repository method (`SettingsRepository.generateLinkCode` writes
`link_code` to the settings row) + a small UI section in the
VaultSharing sub-component. I'm leaving it for a future stage.

## Stage 6+ plan

- **Stage 6**: Notification listener + AI extraction. The
  `NotificationListenerService` + `deviceTransactionParser` +
  `aiExtractor` flow. Native Android component, requires
  BIND_NOTIFICATION_LISTENER permission, will need a settings
  prompt to enable it. This is the biggest non-UI piece.
- **Stage 7**: Recurring transaction executor + future-dated
  projection. Pure logic port.
- **Stage 8**: Cleanup. Tests + lint + version bump + README.
