# Phone-size visual checks

The visual-check page mounts the same dashboard, budget, entry, Review,
settings, and onboarding walkthrough components used by the app. It uses the
walkthrough's example figures or an empty fixture and does not need a Supabase
account. Vite serves it for local checks; it is not part of the Android or web
production bundle.

Use a 390 × 844 viewport, then compare the dark and light versions of these
states:

| Screen | Example address | What to look at |
| --- | --- | --- |
| Onboarding | `?screen=onboarding&theme=dark` | Caption placement, spotlight alignment, and example-data label |
| Dashboard, empty | `?screen=home&fixture=empty&theme=dark` | Balance, chart, and the absence of budget rows |
| Dashboard, populated | `?screen=home&fixture=populated&theme=dark` | Card spacing, category colors, chart, and bottom navigation |
| Expanded budget | `?screen=budget&fixture=populated&theme=dark` | The open card's height and transaction list |
| Add entry | `?screen=add&fixture=populated&theme=dark` | Form fields, category choice, and primary action |
| Review, empty | `?screen=review&fixture=empty&theme=dark` | Empty-queue message and page spacing |
| Review, populated | `?screen=review&fixture=populated&theme=dark` | Duplicate and categorization controls in the queue |
| Settings | `?screen=settings&fixture=populated&theme=dark` | Section cards, toggles, and long-content spacing |
| Date picker | `?screen=calendar&theme=dark` | Month controls, announcement, and safe-area padding |

Start the local Vite server and open each address at
`/visual-tests/index.html` with the query shown above. Replace `theme=dark`
with `theme=light` to compare the other palette. For motion-sensitive checks,
enable the browser's reduced-motion preference before opening the page. The
tour advances through onboarding using its own Next button; wait for the
spotlight to settle before comparing screenshots.

## Current shared values

These are the existing values seen in the shared components and the rendered
screens, not a new design system. Keeping the measurements visible makes later
consolidation deliberate rather than a guess based on one screen.

| Element | Existing treatment |
| --- | --- |
| General card (`CardWrapper`) | White/slate surface, 2.5 rem corners, 1.5 rem padding, category-colored border, inset light ring |
| Settings section (`SettingsCard`) | Muted slate surface, 1.5 rem corners, 1.5 rem padding |
| Budget card | Category palette, 2 rem corners, shared 320 ms ease-out curve for the expand interaction |
| Confirm/notice dialog | Maximum 20 rem width, 2.5 rem corners, 2 rem padding, shared 320 ms entrance |
| Review action/category sheet | Maximum 24 rem width, 2 rem corners, shared 320 ms backdrop/panel entrance |
| Shared toggle | 3 × 1.75 rem standard or 2 × 1.25 rem compact, with a 200 ms color/thumb transition |
| Primary action buttons | Usually 1 rem corners and 1 rem vertical padding; active press scales slightly |

Modal and sheet entrances use the same 320 ms curve as the budget interaction,
and that motion is disabled under a reduced-motion preference. Most surfaces
still close immediately rather than animating out. The shared keyboard pattern
keeps the visible walkthrough above stage dialogs mounted later; the separate
possible-duplicate popover remains non-modal.

These checks establish a repeatable browser baseline, not Android WebView
behavior. Device-sized screenshots do not verify native keyboard movement,
safe-area insets, or animation smoothness on a phone.
