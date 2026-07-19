# Covault Agent Runbook

Scope: the whole repository.

## Mission

Covault is fully AI-managed, so prefer surgical, low-risk changes that keep the app working and make future agent runs easier to verify.

## Safety rules

- Never commit secrets. `.env`, `CONTEXT.md`, `CONTEXT.local.md`, `*credentials*`, and `*secrets*` are intentionally ignored.
- Do not paste real GitHub, Supabase, Vercel, Google, or Android signing tokens into tracked files, logs, PR bodies, or screenshots.
- Do not wrap imports in `try/catch` blocks.
- Avoid broad rewrites unless a user explicitly asks for them. Keep refactors small and behavior-preserving.
- If changing Android runtime behavior, remember `android-custom/` is the source for custom Capacitor Java files and `scripts/sync-android.sh` copies them into `android/`.

## Preferred verification ladder

Run the smallest useful check while iterating, then run the full suite before committing when code changes are made:

```bash
npm run typecheck
npm run typecheck:unused
npm test
npm run build
```

Or run everything with:

```bash
npm run verify
```

For schema-only edits, also consider:

```bash
python3 scripts/check_schema_drift.py --full
```

## Codebase map for future agents

- `App.tsx`: root app state, auth/data orchestration, top-level routing between onboarding/dashboard/parsing/settings.
- `components/`: React UI. Dashboard-specific pieces live in `components/dashboard_components/`; AI parsing UI lives in `components/transaction_parsing/`.
- `lib/hooks/useUserData.ts`: facade that composes data-loading, transaction ops, household linking, settings, and theme hooks.
- `lib/notificationProcessor.ts`: notification dedup/parsing/AI/category/insert pipeline. Treat this as high-risk; make tiny changes with tests.
- `lib/deviceTransactionParser.ts` and `lib/aiExtractor.ts`: transaction extraction logic. Add parser tests for new bank/vendor patterns.
- `lib/hooks/transactionMappers.ts`: database row ↔ app model conversion. Keep enum/label mapping centralized here.
- `supabase/schema.sql`: canonical fresh schema. `supabase/migrations/` contains incremental production changes.

## PR/commit guidance

- Summarize behavior impact explicitly: "behavior-preserving" if applicable.
- Include the exact verification commands run.
- Prefer one coherent commit per task.
