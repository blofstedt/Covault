# Pull request screenshots

Every PR must explain its visual effect. For a visible change, provide mobile
before/after screenshots of only the changed screens and states before requesting
review. This applies to agent-created PRs as well as human-authored PRs. For a
change with no visible effect, keep the template's Screenshots section and
write "No visible change" with a short explanation.

Use [the PR template](../.github/pull_request_template.md). Describe the outcome
for someone who does not read code. A dependency or stylesheet change can
affect the app's appearance even if it adds no screen.

## What the automatic capture covers

The [capture workflow](../.github/workflows/pr-screenshots.yml) renders the PR's exact base and head commits with the
same artificial data. It takes ten screenshots per revision in a Chromium
mobile viewport of 393 × 852:

| State | Theme |
| --- | --- |
| Dashboard | Dark and light |
| Manual entry, filled | Dark and light |
| Manual entry, invalid amount | Dark and light |
| Review | Dark |
| Review filing, pending and rejected | Dark |
| Settings | Light |

These states show a repeatable sample of the app. They do not cover every
control, screen or feature. If a PR changes UI outside this list, add the
relevant capture states before requesting review. Include affected errors,
empty states and interaction states. Check narrower or shorter phone sizes
when the change could clip content or hide an action.

The capture job has read-only permissions and uses fake data. A separate
[trusted publisher](../.github/workflows/publish-pr-screenshots.yml) stores PNGs in the `pr-screenshots` branch and updates one
bot comment on the PR only when a captured screen changes. The publisher
compares decoded pixels, ignoring channel differences of one level for rendering
rounding. Only changed states get before, after and magenta difference images.
Unchanged states produce no published images. If all states are unchanged, no
comment is created and any older screenshot bot comment is removed. The complete
captures remain available in the short-lived workflow artifact for diagnosis.

Image URLs name the image commit, so existing links
continue to show the same evidence. The publisher does not rewrite the
author's PR description. The same process applies to dependency PRs and PRs
from forks.

The trusted publisher starts working only after its workflow has merged into
`main`. The PR that introduces this setup cannot demonstrate automatic
publication through that workflow before the merge. Use its capture
artifacts for initial review and state that comment publication is still
unverified. Do not merge merely to remove this limitation.

## What the author must provide

1. Name the exact base and head commits for the comparison. Capture the same
   viewport, theme, data and relevant scroll position on both revisions.
2. Show each changed screen or state in a before/after row. If the base lacks
   a new feature, show its existing entry point and explain what the base did.
3. Add a short caption that says what changed for the app's user. Identify
   the screen, theme and viewport. Retain affected error states alongside the
   successful state.
4. Open and inspect the images. Say which layout, text, contrast or control
   placement you checked and whether you found a problem. A successful
   capture job alone is not a visual review.
5. Link the relevant pairs from the bot comment in the PR description, or
   embed the pairs there. Do not claim that unrelated default screenshots
   verify the new UI. Keep the PR's verification section explicit about what
   ran and what remains unverified.

After pushing another UI change, wait for evidence matching the new head
commit and inspect it again. A screenshot of an older head cannot verify the
current PR. If capture or publication fails, keep the PR open with the
missing evidence stated; repair the capture or supply equivalent relevant
before/after images before requesting visual review.

For local fixture checks, see [Phone-size visual checks](UI_VISUAL_CHECKS.md).
Those fixtures are useful for adding coverage, but the chosen screenshots
still need to show the UI this PR changes.

## What screenshots do not verify

The automatic images come from a browser with artificial data. They do not
verify real Supabase access rules or writes, Google sign-in, Android keyboards,
native safe-area behavior, notification capture, widget layout, haptics or
physical-phone smoothness. A still image cannot establish animation timing
or smoothness.

Record separate behavior checks and their results in Verification. Name
browser emulation, Android emulator checks and physical-phone checks
accurately. Report any relevant checks you did not run. The Android emulator
workflow has its own scope and limits in
[Android testing](ANDROID_TESTING.md).
