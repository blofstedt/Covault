# Play Store listing copy

Not read by any build step — this is text to paste into Play Console's store
listing form by hand. Kept in the repo so it's versioned and easy to update
alongside the app, not because anything loads it.

## App name (30 characters max)

```
Covault: Budget & Spending
```
27 characters.

## Short description (80 characters max)

```
Budgeting that fills itself in from your bank alerts. No manual entry.
```
72 characters.

## Full description (4000 characters max)

```
Covault tracks what you spend without you having to type it in.

When your bank sends a purchase notification, Covault reads it, figures out
the vendor and amount, and files it under the right budget category —
automatically, the moment you buy something. No manual entry, no importing
statements, no forgetting to log a purchase and losing track by the end of
the month.

HOW IT WORKS

• Automatic capture — Covault reads your bank's own notifications the
  moment a purchase happens and turns them into categorized transactions on
  its own.
• On-device AI — the parsing that reads your bank alerts runs entirely on
  your phone. Your transaction details are never sent to a cloud AI service
  to be read.
• Budget by category — see what you've spent and what's left in each
  category at a glance, not just a single number at the end of the month.
• Recurring charges — subscriptions and bills are recognized and shown
  ahead of time, so they don't blindside your budget or get captured twice.
• Share with your household — link with a partner and see the same budget,
  built from both of your spending.
• Home screen widget — check where you stand without opening the app.
• Uncertain about a capture? — anything Covault isn't confident about goes
  to a review queue instead of being filed automatically, so you always
  have the final say.

WHY IT'S DIFFERENT

Most budgeting apps ask you to either link a read-only bank feed to a third
party, or type in every purchase by hand. Covault does neither: it reads
the notification your bank already sends you, processes it on your own
phone, and only ever needs your bank in the sense that your phone already
does.

PRICING

Covault is $6.99/month after a one-month free trial. No ads, no selling
your data — the subscription is the whole business model.

PRIVACY

Covault does not sell your data. Purchase parsing happens on-device. See
the in-app Privacy Policy for full details.
```
Well under the 4000-character limit — leaves room to extend later without
restructuring.

## Category

Finance (Budgeting subcategory, if offered).

## Content rating

Not something this file can complete — Play Console's own questionnaire
has to be filled out inside the console. Expect a low/no-violence
"Everyone" rating; the only sensitive area is financial data handling,
which the Data Safety form (see below) covers.

## Data safety form — what to declare

Fill this out inside Play Console using what's actually true of the app:

- Collects: name, email (account), financial transaction data (amount,
  vendor, category), device notifications (read, on-device only, to
  detect purchases).
- Shared with third parties: Supabase (the app's own backend — data
  processor, not a third party for this form's purposes), Sentry (crash
  reports only — no transaction data, see lib/errorReporting.ts).
- Not sold to anyone.
- Encrypted in transit: yes (Supabase over HTTPS).
- Users can request deletion: yes — in-app account deletion, see
  lib/accountDeletion.ts.

## Screenshots / feature graphic

Not written here — these are images, not text, and need to be captured
from a running build. Still outstanding.
