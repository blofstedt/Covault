# AGENTS.md — Start Here (read before doing anything)

**Covault** is an AI-maintained, native-Android (Kotlin/Compose) budgeting app.
The entire app is the self-contained Gradle project in **`android-kotlin/`**.
Backend is Supabase. There is no other app.

## The one rule: route, don't scan

**Do NOT read the whole repo.** It wastes tokens and context. Instead:

1. **Read [`CLAUDE.md`](./CLAUDE.md) first.** It is the map. Its
   **"Change-routing map"** table says, for a given change, the exact file(s)
   to edit.
2. **Open only the files the table names** for your task (plus their direct
   collaborators if the edit truly needs them). Grep for a symbol only when the
   table doesn't cover your task.
3. **Check [`.notes/gotchas.md`](./.notes/gotchas.md)** before editing — it lists
   recurring traps that have bitten agents here (don't repeat them).
4. Files are small and single-purpose by design. Reading one file should be
   enough for most edits.

## Working protocol (all agents)

- **Plan before editing.** For anything non-trivial, state which files you'll
  touch and why, then edit. Prefer surgical edits (one method) over rewriting a
  class/file.
- **You cannot run the app here.** CI (`.github/workflows/build-kotlin.yml`)
  only compiles, unit-tests, and builds the APK. **Compile-green ≠ works.**
  Runtime flows (auth, capture, chart, income save) need the owner to device-test.
  Say so; never claim a runtime feature works from a green build.
- **Pure logic lives in `domain/` and is unit-tested.** If you change money math,
  parsing, category resolution, or the chart data, update the matching test in
  `android-kotlin/app/src/test/java/com/covault/app/`.
- **Root-cause fixes only.** If a test fails, diagnose the real behavior; don't
  suppress the symptom.
- **Keep the map current.** If you add/remove a feature or move a file, update
  `CLAUDE.md`'s routing table and Feature status, and `.notes/` if relevant.

## Build / test (from `android-kotlin/`)

```bash
./gradlew :app:compileDebugKotlin     # fast compile check
./gradlew :app:testDebugUnitTest      # unit tests
./gradlew :app:assembleDebug          # debug APK
```

## Git etiquette

- Branch naming: feature branches like `claude/<short-topic>`; never commit
  straight to `main`.
- Open a PR to `main`; merge only after CI is green and (for runtime changes)
  the owner has device-tested.
- Commit messages: imperative subject + a short body explaining *why*.

## Where things live

- `CLAUDE.md` — the map (routing table, stack, DB, architecture, gotchas summary).
- `.notes/project_overview.md` — high-level architecture in one page.
- `.notes/task_list.md` — current priorities and known follow-ups.
- `.notes/gotchas.md` — traps and project-specific quirks. Read before editing.
- `android-kotlin/` — the app.
- `supabase/` — DB schema + migrations (reference only).
