# Shared Covault skills

These four skills are committed to the repository so every contributor gets them
when they pull. Codex reads the copies in `.agents/skills/`. Claude Code reads the
same copies through relative links in `.claude/skills/`; none points to a personal
folder. Start a new assistant session after pulling if they are not listed yet.

| Skill | Use it for | Source snapshot | Licence |
| --- | --- | --- | --- |
| microinteractions | Button feedback, loading states, toggles and interaction motion | [Wondel.ai v1.8.0, skill 1.4.1](https://github.com/wondelai/skills/tree/6621b1f32cca2b9b17d7a18c076bf6e7da83f8a6/microinteractions) | MIT, included in the skill folder |
| design-everyday-things | Clear controls, discoverability and recovering from mistakes | [Wondel.ai v1.8.0, skill 1.4.0](https://github.com/wondelai/skills/tree/6621b1f32cca2b9b17d7a18c076bf6e7da83f8a6/design-everyday-things) | MIT, included in the skill folder |
| frontend-design | Visual direction, typography, layout and interface copy | [Anthropic snapshot](https://github.com/anthropics/skills/tree/8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4/skills/frontend-design) | Apache 2.0, included as LICENSE.txt |
| unslop | Removing filler, jargon and stock AI phrases from writing | [pstack snapshot](https://github.com/backnotprop/pstack/tree/157aae39a733135e93d8b5b19ff62c6a84b0ad56/skills/unslop) | MIT, included in the skill folder |

The unslop source is Michael Ramos's assistant-neutral mirror of Lauren Tan's
[pstack collection](https://github.com/cursor/plugins/tree/main/pstack).

## Using them

Ask the assistant to use the skill by name. In Claude Code, the commands are
`/microinteractions`, `/design-everyday-things`, `/frontend-design` and `/unslop`.
Unslop retains its upstream manual-invocation setting. The other skills include
descriptions that let an assistant select them for a relevant request.

Covault's `CLAUDE.md` remains the project guide. Preserve its existing visual
language and Android motion rules when applying these general design skills.
The Wondel.ai skills mention other optional skills, such as refactoring-ui;
those are not part of this installation.

## Sources and review

Sources and licences were checked on 2026-10-03. Wondel.ai v1.8.0 was the latest
stable collection release. Anthropic and the pstack mirror published no releases
or tags, so their current main-branch snapshots are pinned in the links above.
The copied skill files and supporting references are unmodified.

Only Markdown and licence text were copied. No executable tools, hooks, assistant
services or package dependencies were added. A package vulnerability audit does
not apply to these text-only copies. The reference paths and Claude Code links
were checked before committing.

To update, check the upstream release and licence again, replace the whole
selected skill folder including its references, and update this source record.
Keep the Claude Code links relative and inside this repository.
