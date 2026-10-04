<!--
Keep the description brief and useful to the person reviewing it. Lead with
what changes for the app's users. Check every claim and remove optional sections
that do not apply. Replace prompts before requesting review. Keep Screenshots
for every PR. Follow docs/PR_SCREENSHOTS.md for visual evidence.
-->

## Summary

<!-- One to three bullets describing what someone can now do or what works better. -->

- [User-visible outcome]

## Why

<!-- The problem this fixes or the reason for the change. Avoid repeating Summary. -->

- [Problem or reason]

## Changes by area

<!-- Group the changes by app area, such as expense entry, capture, sharing, or developer tools. Include only details that help a reviewer understand the result. -->

- [App area]: [Grouped changes]

## Verification

<!-- Keep this short and relevant. Record checks actually run and their results; link to CI instead of repeating suite counts. Distinguish browser emulation from a real Android phone, and local test data from live Supabase. State relevant gaps. A passing build does not prove capture, the widget, keyboards, visuals, or motion work. -->

- [Actual check and result, or CI link]
- [Relevant behavior not verified, if any]

## Screenshots

<!-- Required for visible changes, including agent-created PRs. Show images only for changed screens or states. Add relevant mobile before/after pairs with short captions, exact base/head commits, viewport, and theme. You may link the automated screenshot comment instead of duplicating its images, but identify which pairs show this change. Inspect the images before claiming visual verification. Keep affected error and interaction states. Extend capture coverage for new UI outside the default states before requesting review. The default suite does not verify every new feature. -->

<!-- Do not include unchanged comparison images. For changes with no visible effect, replace the table with "No visible change" and explain why. Do not classify a dependency or styling change as nonvisual without checking its effect on rendered screens. See docs/PR_SCREENSHOTS.md for the publisher's initial activation limit and verification limits. -->

| Screen or state, viewport, theme | Before, base commit | After, head commit | Caption and visual result |
| --- | --- | --- | --- |
| [Relevant mobile state] | [Image or bot-comment link] | [Image or bot-comment link] | [What changed, what was inspected, and any limit] |

<!-- Optional: add a real issue link or "Closes #123" when applicable. -->

<details>
<summary>Implementation notes</summary>

<!-- Optional: include only technical details or risks that help a reviewer. Remove this block if the sections above already explain the change. -->

- [Review detail or risk]

</details>
