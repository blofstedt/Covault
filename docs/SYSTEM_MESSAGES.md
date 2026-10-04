# System messages

Use this guide when adding or changing text that Covault displays on its own
behalf: confirmation dialogs, saving feedback, capture notices, status messages
and errors. These are app messages, not instructions given to an AI model.

## General wording

- Tell the person what happened to their purchase, budget or vault. Prefer
  "Budget updated" to a generic announcement that an operation succeeded.
- Keep each message focused on one outcome. Lead with the information needed
  to decide what to do next.
- Use sentence case, ordinary words and direct sentences. Avoid celebratory
  punctuation and filler such as "successfully" or "simply".
- Use the same names as the surrounding app, including Review, budget and
  vault. Describe the user's task rather than an internal process.
- State only what is known. A purchase waiting in Review is not already filed;
  an optimistic screen update is not proof that a setting was saved. Describe
  an inferred capture problem as a possibility rather than a confirmed cause.
- Write counts naturally, including the singular form. If translation support
  is added, use its plural handling rather than joining fragments of sentences.

## Confirming an action

A confirmation should explain the decision before the person makes it.

- Give the title a specific action and object, such as "Remove this purchase?".
  Generic titles such as "Warning" do not explain what is being decided.
- Use the body for the consequence. Identify the affected item or count and
  explain permanent loss when it applies. Do not claim an action is reversible
  unless the app really provides that recovery.
- Label the action button with its action, such as "Remove purchase". Use
  "Cancel" for abandoning the action. Avoid yes/no labels that depend on
  remembering the title.
- For destructive decisions, put initial focus on the safe choice. Closing
  the dialog must cancel rather than approve the action.

## Outcomes and progress

- Saving feedback should report the completed result, such as "Expense added".
  While work is pending, say so instead of announcing completion early.
- Keep ordinary feedback brief. A transient toast must not be the only place
  to find an important problem or the instructions needed to resolve it.
- Describe the result of the interaction instead of repeating the button label.
  Include an Undo action only when it actually reverses that result.
- Announce status updates to assistive technology without moving focus. Avoid
  repeating the same announcement through multiple live regions.

## Problems and recovery

Explain what could not be completed, then give a next step that the app can
actually support. For example, "The expense wasn't saved. Check your connection
and try again." Use that advice only when failure is confirmed and retrying is
appropriate. If the result is unknown, say so and offer a way to check it before
retrying, so the message does not encourage adding the same purchase twice.

For invalid input, identify the field and the correction, such as "Enter an
amount greater than zero." Keep the explanation beside the field and available
until the problem is resolved. Preserve the person's input when recovery permits.

Do not blame the person, expose raw service errors or show a stack trace in the
message. Keep technical diagnostics separate from the explanation. Do not
promise that data is safe, saved or deleted unless the outcome is confirmed.

## Requested wording

Treat suggested copy as a proposal unless the user explicitly requires exact
wording. Preserve the intended behavior, improve unclear text and describe any
meaningful wording change in the pull request. If the intended consequence or
recovery is unclear, ask before inventing it.

## Review and public references

Read the title, body and buttons independently. Each must make sense when heard
by a screen reader without the rest of the screen. Check that every claim about
saving, deletion, capture and recovery matches the actual behavior.

These rules use public guidance, with examples specific to Covault:

- [Carbon modal guidelines](https://www.carbondesignsystem.com/building-blocks/core/components/modal/guidelines)
  explain action titles, consequences and descriptive button labels.
- [WAI-ARIA alert dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/)
  explains accessible dialog names and descriptions.
- [WCAG status message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
  explains announcing outcomes without requiring a focus change.

Adding this guide does not verify existing copy, screen reader announcements or
Android behavior. Check those when changing the affected interaction.
