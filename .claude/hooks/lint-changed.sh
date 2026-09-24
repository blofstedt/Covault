#!/usr/bin/env bash
# Stop hook: run `eslint --fix` on every lintable file this turn changed.
#
# "Changed this turn" = differs from the commit the turn started on (recorded
# by turn-start.sh), committed or not, plus new untracked files. If the fixer
# rewrites anything, or errors remain that it cannot fix, Claude is sent back
# once to deal with it (commit the fixes, fix the rest) rather than ending the
# turn with lint-dirty work.
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
input=$(cat)
# Already sent back once this turn: fix what can be fixed, but never loop.
again=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).stop_hook_active===true))}catch{process.stdout.write("false")}})')

gitdir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
start=$(cat "$gitdir/claude-turn-start" 2>/dev/null)
git cat-file -e "${start:-HEAD}^{commit}" 2>/dev/null || start=HEAD

mapfile -t files < <(
  { git diff --name-only --diff-filter=ACMR "${start:-HEAD}" --; git ls-files --others --exclude-standard; } \
    | grep -E '\.(ts|tsx|js|mjs|cjs)$' | sort -u | while read -r f; do [ -f "$f" ] && echo "$f"; done
)
[ ${#files[@]} -eq 0 ] && exit 0
[ -x node_modules/.bin/eslint ] || exit 0

before=$(cat -- "${files[@]}" | git hash-object --stdin)
out=$(mktemp)
node_modules/.bin/eslint --fix --max-warnings=0 -- "${files[@]}" > "$out" 2>&1
status=$?
# Tailwind prints "warn - ambiguous class" notes of its own; they are not findings.
report=$(grep -v '^warn - ' "$out" | sed 's/\x1b\[[0-9;]*m//g' | grep -v '^[[:space:]]*$')
rm -f "$out"
after=$(cat -- "${files[@]}" | git hash-object --stdin)

[ "$again" = "true" ] && exit 0

msg=""
[ "$before" != "$after" ] && msg="eslint --fix rewrote some of the files changed this turn; review and commit those edits."
[ $status -ne 0 ] && msg="${msg:+$msg }Lint problems remain that --fix could not repair:
$(printf '%s\n' "$report" | head -40)"
[ -z "$msg" ] && exit 0

node -e 'process.stdout.write(JSON.stringify({decision:"block",reason:process.argv[1]}))' "$msg"
exit 0
