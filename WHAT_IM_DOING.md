# Covault handoff — 2026-09-24

This is a snapshot for another agent, not a lock or a claim that the work is finished. Check the branch, working tree, and recent conversation before taking over.

## What the user asked for

1. Review Covault's codebase and establish an action plan for making it easier to maintain and safer to change. Covault was built by someone without development experience, with AI agents making many decisions in isolation. Question existing patterns, including custom solutions that established tools could replace; do not preserve a design merely because it is already there.
2. Start the foundational improvements on a **new branch off `main`**. Organize the codebase and build good practices without a broad rewrite. Preserve the app's actual behavior and visual quality, especially Android capture, privacy, money totals, and motion.
3. Evaluate state management pragmatically. Zustand may fit a demonstrated need for shared client-only state, but it is not a blanket replacement for screen state or server data. React Query is already present and should be evaluated for server reads.

## Current branch and work

The working tree is on `chore/codebase-foundations`, created from the then-current `main` (`58f4f2e`). The foundation changes are **uncommitted**. `docs/CODEBASE_PLAN.md` is the detailed action plan; read it for rationale, priorities, and open items.

Work currently in the tree:

- Android CI and README installation steps use the committed lockfile through `npm ci --legacy-peer-deps`.
- Strict TypeScript checking is enabled, with the initial nullable-value errors addressed.
- Dashboard setting saves now have a data-layer boundary, detect failed or empty save responses, serialize quick changes to one setting, and restore the last accepted value after a failure. There are new and revised behavior tests for this path.
- README links to the action plan. The plan calls out database setup, workflow permissions, feature boundaries, notification processing, React Query, consistent controls and motion, and tests as subsequent work. Those later items are **planned, not implemented**.

An earlier `npm run verify` completed successfully (type-check, 155 test files / 2,039 tests, and build). Small edits were made afterward; the follow-up check did not produce an observed result before this handoff. Treat the present tree as **not yet fully verified**. No Android phone or visual-flow check has been reported. No commit or push has been made for these changes.

## Coordination: avoid collisions

- **One writer owns this shared worktree and `chore/codebase-foundations` at a time.** The parent agent was actively editing it. Do not edit its files, switch branches, reset, clean, rebase, commit, or push from this worktree while that agent is still working.
- For independent work now, use a separate worktree and branch, and coordinate before touching the same features. To take over this branch, first establish that the parent agent has stopped and review the current diff and status; this file may be stale by then.
- This side conversation's only change is this handoff file. It does not complete, verify, or publish the parent agent's work.

## Next steps for the branch owner

1. Review the current diff and the unchecked items in `docs/CODEBASE_PLAN.md`; resolve any issues in the settings save flow and tests.
2. Run `npm run verify` on the final tree before committing. For any visual or Android-specific change, also check the affected flow in the app; CI does not exercise it.
3. Report what was actually verified, then coordinate the branch's integration with the user. The user's request for a new branch takes precedence over the repository's usual `main`-first convention.
