#!/usr/bin/env bash
# Remember which commit this turn started from, so the Stop hook can lint
# every file the turn touched — including ones already committed by then.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse HEAD > "$(git rev-parse --git-dir)/claude-turn-start" 2>/dev/null || true
exit 0
