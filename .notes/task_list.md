# Task List — current priorities & known follow-ups

Keep this short and current. Tick items as they land; add new ones on top.

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
