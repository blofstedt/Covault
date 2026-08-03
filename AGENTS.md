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
- **Say plainly what you did not verify.** CI does not run this app. A green
  build is not evidence that capture, the widget, or anything visual works.
- **Answer the question that was asked**, then stop.
