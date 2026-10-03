# Covault — read CLAUDE.md first

This file exists so that AI tools which look for `AGENTS.md` land in the same
place as the ones that look for `CLAUDE.md`. **`CLAUDE.md` in this same
directory is the real index** — where the code lives, which files a given
request actually touches, and the invariants that look like bugs but are not.
Read it before opening anything else.

The one thing that is repeated here rather than linked, because getting it
wrong makes everything else unreviewable:

## How to answer the person you are working for

They do not write code and cannot check your work by reading it. Your reply is
the deliverable.

- **Plain English only.** No code in the answer, no diffs, no file contents, no
  snippets for them to run. Naming a file so they know where something lives is
  fine; showing its contents is not.
- **Numbered, concise.** Feedback on a change, a plan, a review, or another
  tool's suggestion comes back as a short numbered list — one claim per number,
  verdict first.
- **Explain in consequences, not mechanics.** What it means for the app they
  use, not what the function does.
- **Say plainly what you did not verify.** CI never runs this app on a phone. A green
  build is not evidence that capture, the widget, or anything visual works.
- **Answer the question that was asked**, then stop.

## Where work goes

**Use a feature branch and open a pull request to `main`.** Commit and push
that branch, then leave the PR open for review. Do not commit or push directly
to `main`, merge a PR, or enable auto-merge unless the user explicitly asks.

Use `.github/pull_request_template.md` for the PR description. Run
`npm run verify` before committing and pushing. `main` builds the phone APK,
so merging a PR can publish an app update.

## What they care about

They judge this app on whether it is beautiful to use — design consistency,
UX, and animation are the point, not the polish at the end. A feature that
works but looks wrong or stutters is not finished.

- Reuse the existing design language (one category palette, the shared card and
  control components) rather than inventing a new look for one screen.
- Everything moving in the same interaction shares one duration and easing
  curve. Mixed clocks are what read as "not smooth".
- Motion has to be smooth in an Android WebView, not just on a desktop browser.
  The performance rules in CLAUDE.md's Invariants exist to protect that feel.
- If the easier implementation looks worse, say so in plain English and let
  them decide. And say plainly when you have not actually seen a visual change
  render — nothing in CI looks at it.
