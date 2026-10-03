# Shared Covault skills

These nine skills are committed to the repository so every contributor gets them
when they pull. Codex reads `.agents/skills/`. Claude Code reads the same copies
through relative links in `.claude/skills/`; none points to a personal folder.
Start a new assistant session from the repository root after pulling.

| Skill | Use it for | Source snapshot | Licence |
| --- | --- | --- | --- |
| microinteractions | Button feedback, loading states, toggles and interaction motion | [Wondel.ai v1.8.0, skill 1.4.1](https://github.com/wondelai/skills/tree/6621b1f32cca2b9b17d7a18c076bf6e7da83f8a6/microinteractions) | MIT, included in the skill folder |
| design-everyday-things | Clear controls, discoverability and recovering from mistakes | [Wondel.ai v1.8.0, skill 1.4.0](https://github.com/wondelai/skills/tree/6621b1f32cca2b9b17d7a18c076bf6e7da83f8a6/design-everyday-things) | MIT, included in the skill folder |
| frontend-design | Visual direction, typography, layout and interface copy | [Anthropic snapshot](https://github.com/anthropics/skills/tree/8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4/skills/frontend-design) | Apache 2.0, included as LICENSE.txt |
| unslop | Removing filler, jargon and stock AI phrases from writing | [pstack snapshot](https://github.com/backnotprop/pstack/tree/157aae39a733135e93d8b5b19ff62c6a84b0ad56/skills/unslop) | MIT, included in the skill folder |
| zod | Input schemas, parsed types and useful validation errors | [Pedro Proenca's dot-skills snapshot](https://github.com/pproenca/dot-skills/tree/cf93c57cac89d6fc3e4194686000411567f5caf3/skills/.curated/zod) | MIT, included in the skill folder |
| typescript-best-practices | Types that prevent invalid states and boundary mistakes | [pstack snapshot](https://github.com/backnotprop/pstack/tree/157aae39a733135e93d8b5b19ff62c6a84b0ad56/skills/typescript-best-practices) | MIT, included in the skill folder |
| principle-test-behavior-not-implementation | Tests that check what the user observes | [pstack snapshot](https://github.com/backnotprop/pstack/tree/157aae39a733135e93d8b5b19ff62c6a84b0ad56/skills/principle-test-behavior-not-implementation) | MIT, included in the skill folder |
| accessibility | Labels, focus, keyboard use, touch targets and accessible errors | [Addy Osmani's web-quality-skills snapshot](https://github.com/addyosmani/web-quality-skills/tree/afa8da942115f2961fdbfa80807ea0b232ff6c00/skills/accessibility) | MIT, included in the skill folder |
| supabase-postgres-best-practices | Database design, SQL, indexes and household access rules | [Supabase v0.1.9, skill 1.1.1](https://github.com/supabase/agent-skills/tree/544bfc56c89afe2b87b20017a59b2c6e9502a1fb/skills/supabase-postgres-best-practices) | MIT, included in the skill folder |

The pstack source is Michael Ramos's assistant-neutral mirror of Lauren Tan's
[pstack collection](https://github.com/cursor/plugins/tree/main/pstack).
The TypeScript copy also includes that snapshot's type-system and boundary
principles as local references.

## Default use and explicit commands

`.claude/settings.json` sets `skillOverrides` to `on` for all nine project
skills. Claude Code lists their names and descriptions so the assistant can
select them; it does not load every full guide on every prompt. This is the
[supported skill visibility setting](https://code.claude.com/docs/en/skills#override-skill-visibility-from-settings),
not a custom `defaultSkills` key. The file also declares the
[published settings schema](https://json.schemastore.org/claude-code-settings.json).

`CLAUDE.md` sets the default usage policy by task. Use unslop for writing,
TypeScript for TypeScript work, Zod for input validation, behavior testing for
tests, accessibility for controls, the design skills for visual and interaction
work, and Supabase guidance for SQL, schema and access-rule work. Existing
React, Vite and Vitest plugins remain enabled in shared settings. Those plugins
still fetch their sources separately; these nine skill copies need no download.

Ask any assistant to use a skill by name when needed. In Claude Code, the
project commands include `/zod`, `/typescript-best-practices`, `/accessibility`
and the other folder names in the table. Managed settings and personal skill
names can affect what a particular installation exposes. The repository copies
and default policy remain available without the installer's personal folders.

Covault's `CLAUDE.md` remains the project guide. Preserve the existing visual
language, shared controls, Android motion rules and database access limits.
Optional skills mentioned by upstream guides are not installed unless listed
above. React Hook Form is not used by this app, so its skill is not included.

## Sources and local changes

Sources and licences were checked on 2026-10-03. Wondel.ai v1.8.0 and Supabase
v0.1.9 were the latest stable collection releases. Anthropic, the pstack mirror,
dot-skills and web-quality-skills published no releases or tags, so the checked
main-branch snapshots are pinned above.

Local changes to upstream text are intentional:

- Removed `disable-model-invocation: true` from unslop, TypeScript and behavior
  testing. These reference guides can now be selected for relevant tasks.
- Replaced the TypeScript guide's required principle names with links to its
  included local references. Updated their cross-references accordingly.
- Added Covault notes to Zod. Some upstream examples use Zod 3 APIs or make
  broad performance and security claims. The notes require current Zod 4 APIs,
  complete amount validation, safe error formatting and actual measurements.
  The upstream references remain available as examples; they are not tested
  Covault code or permission to change unrelated forms.
- Added command-line and mobile guidance to accessibility, and changed its
  optional sibling-skill link to the pinned upstream page.
- Trimmed one accidental trailing space in the accessibility HTML example and
  one in Supabase's contribution reference. Replaced Zod's five two-space
  Markdown hard breaks with CommonMark backslash endings, preserving the
  rendered line breaks without trailing whitespace.

Only instruction documents, reference documents, metadata and licence text were
copied. No executables, new hooks, assistant services, tool permission grants or
package dependencies were added by this skill installation. A package
vulnerability audit does not apply to these text copies. Sources were reviewed
for portability and tool side effects.

The shared settings passed the published JSON schema and `claude doctor` on
Claude Code 2.1.288. All nine frontmatter documents parsed as YAML, their local
links resolved, and their Claude links also resolved in an extracted portable
copy. This CLI's plugin validator skipped symlinks and did not inspect nested
skill metadata in dereferenced copies, so that command is not counted as proof.
The brother's installation and automatic skill selection were not tested.

To update, check the upstream release and licence again, replace the selected
skill folder with its references, reapply the local changes above, and update
this record. Keep Claude Code links relative and inside this repository.
