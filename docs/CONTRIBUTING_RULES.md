# Contributor rules

These rules apply to new work and to existing code changed during a cleanup.
Preserve the documented capture, money, cache, native and motion invariants in
CLAUDE.md. A general convention never overrides a verified app requirement.

## Folder ownership and exports

- Use PascalCase for component folders. Structural folders use lowercase names;
  prefer one word, and use camelCase when two words are necessary. Never use
  snake_case folders, except the required `__tests__` convention. Generated
  native projects and tool configuration keep their required names.
- Keep simple components as files directly in their owning folder, including
  `app/components/common`. A component with its own subcomponents gets a
  same-name PascalCase folder and an `index.ts` exporting its main component.
  Tests alone do not justify a component folder. Keep one component per file.
- `App.tsx` or `App.jsx` may live at the project root. Never create `app/app`.
- Put every test or spec file in an `__tests__` folder beside its owner.
- Place a component used by one parent beneath that parent. Group private
  parts by the visible container they belong to, such as a card or section.
  Place shared feature parts at their nearest common feature owner.
- Promote code to common only when independent consumers actually share it,
  or when it has a deliberately reusable control or accessibility contract.
  Similar-looking code alone does not establish shared ownership.
- Keep feature hooks, tests and pure helpers beside their owner. Put stateful
  services in descriptive files. Do not turn utils.ts into unrelated storage.
- Import a complex component through its folder entry. Import simple components
  directly from their files. Export only its main component
  and contracts needed outside it. Do not create an app-wide component barrel.
  Private implementation imports remain within their owner.
- Export hooks and ordinary functions by name. Do not export the same binding
  as both named and default. Import types from the module that defines them.
- Add queries, mutations or schemas files only when that responsibility exists.
  Private children use their feature's resources; reusable controls own theirs.

## Types and boundaries

- Prefer function components for new UI. Preserve framework-required classes
  such as error boundaries. Destructure props and defaults at the boundary.
- Define explicit external contracts and infer ordinary local values. Derive
  types from validated schemas when possible. Avoid duplicated shape lists,
  unsafe assertions and casts that conceal an unhandled state.
- Validate external input before using it. Validate money as complete input
  before conversion. Keep nullable values distinct when the distinction matters.
- Model meaningful states explicitly. Avoid combinations of booleans that allow
  impossible states, and handle each supported state deliberately.
- Keep database and native access behind their owning data or service layer.
  Shared controls receive values and actions through props.
- Use the established owner for shared data. Do not add a second cache or a
  competing source of truth. Preserve the existing first-paint and core-load
  behavior rather than moving it to a generic cache during cleanup.
- Cancel obsolete reads when supported and prevent older replies replacing newer
  state. A browser cancellation does not prove a server-side write stopped.
- Reconcile an unknown write outcome before retrying. Bound retries and avoid
  retrying authentication, validation or permanent failures blindly.

## Interface and interaction

- Reuse the category palette, card surfaces, shared controls and motion clock.
  Read the repository-local design and interaction guides for affected work.
- Respond to available space with CSS. Use capability checks for native APIs,
  pointer behavior and supported browser features rather than guessing a device.
- Keep essential actions available without hover. Use native buttons and links,
  accessible names, visible focus and keyboard alternatives for gestures.
  Preserve zoom, scrolling and a non-drag way to complete important actions.
- Keep focus and unrelated content stable during updates. Reserve necessary
  space for changing content. Do not hide layout defects with arbitrary widths
  or animations. Check the transition as well as the settled screen.
- Distinguish initial loading, background refresh, paused work, empty results
  and failure. Retained data must still belong to the visible account and scope.
  Disable actions whose target is ambiguous while the scope changes.
- Show only real progress and confirmed outcomes. Preserve entered data during
  recovery. Do not announce success before saving is confirmed.
- Follow [System messages](SYSTEM_MESSAGES.md) for confirmation, status and error
  copy. Keep actionable problems available beyond a transient toast.

## Tests and evidence

- Test the behavior a person depends on, including failure and recovery. Reuse
  relevant existing coverage instead of duplicating implementation assertions.
- Use focused unit tests for logic and real browser checks for layout, focus,
  navigation and event ordering. A simulated DOM does not prove these work.
- Colocate a test with its owner. Keep cross-feature regressions in the shared
  regression area. Use the app's provider wrapper for component tests.
- Prefer accessible selectors. When identical controls require a stable test
  identifier, use one instead of a positional guess and check semantics too.
- Verify APIs against the installed dependency. Use project-local tools. Run
  npm run verify before committing and report checks that actually completed.
- A build does not prove physical-phone motion, capture, haptics or live database
  behavior. State those gaps, and retain failed checks in the PR evidence.
- Publish screenshot evidence only for a visual change. Changed screens may show
  after alone or before, after and difference. Omit unchanged screens entirely.

## Documentation and delivery

- Explain current behavior and invariants. Remove obsolete guidance when its
  replacement is verified. Keep historical incidents and internal identifiers
  out of general rules. Link detailed guides from a short repository index.
- Automate mechanically checkable rules where practical. Do not weaken a check
  merely to make a cleanup pass. Remove code only after verifying it is obsolete.
- Keep each PR about one coherent outcome. Separate unrelated policy, structure,
  behavior and release changes. Use one reviewable commit per PR.
- Use an isolated branch or worktree when sharing the repository. Preserve other
  sessions' changes. Commit and push with the personal project identity, leave
  PRs open and do not merge or enable automatic merging without authorization.
- Do not change release timing as a side effect of cleanup. Evaluate the current
  release workflow separately before proposing a schedule change.
- Reuse generic practices only. Keep employer-specific material, identities,
  private designs, source code and metadata out of this personal repository.
- Check current stable versions, licenses and known vulnerabilities when adding
  dependencies. Preserve source and license information for shared skills.

The repository-local skills provide the detailed language, design, accessibility,
TypeScript, validation, testing and database guidance. Load only those relevant
to the work. Rules are not permission to broaden a change's behavior.
