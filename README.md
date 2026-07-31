# Covault

A personal budget tracker for a household. Track spending across budget
categories, capture transactions automatically from Android banking
notifications, and share a vault with a partner.

React 19 + TypeScript + Vite, packaged for Android with Capacitor. Data lives in
Supabase; AI extraction runs **on-device** via `@huggingface/transformers`, so
there is no OpenAI or Gemini key.

> **Working on this repo with an AI?** Point it at `CLAUDE.md` — that is the
> index written for it, and it should be read before anything else.
> `docs/ARCHITECTURE.md` has the deep detail. This file is just setup.

## Requirements

- Node.js 20+
- A Supabase project
- For local Android builds: JDK 21 and the Android SDK (or let CI do it)

## Setup

```bash
git clone https://github.com/blofstedt/Covault.git
cd Covault
npm install --legacy-peer-deps   # flag matches CI; needed for React 19 / Vite 6 peer ranges
cp .env.example .env             # then fill in the values below
npm run dev                      # http://localhost:3000
```

`.env`:

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key>
VITE_ADMIN_EMAIL=you@example.com   # optional
```

Both required values are in Supabase → Project Settings → API ("Project URL"
and the "anon/public" key). `VITE_PUBLIC_SUPABASE_URL` also works in place of
the first.

Without them the app falls back to a stub client that logs warnings and does
nothing useful.

**Never commit the service-role key.** It belongs in an environment variable or
a GitHub Actions secret, never in the client bundle. `.env` and anything
matching `*credentials*` / `*secrets*` are gitignored.

## Database

For an existing database, run
`supabase/migrations/2026_08_01_sync_schema_to_app.sql` in the Supabase SQL
editor. It is idempotent — safe to run twice — and brings the schema in line
with the current app. Migration files whose header says **SUPERSEDED** are
history; you do not need them.

For a fresh project, run `supabase/schema.sql` first. It creates the tables the
app uses: `settings`, `budgets`, `transactions`, `overrides`, `banks`,
`notification_rules`. Without it you will see 404s in the console for missing
tables.

`pending_transactions` is deliberately **not** in the schema; the app treats its
absence as an empty queue. See `docs/ARCHITECTURE.md`.

## Auth configuration

Required for Google OAuth to work on web and Android.

In Supabase → **Authentication → URL Configuration**, add these redirect URLs:

- `http://localhost:3000` — local dev
- your production web URL
- `com.covault.app://auth/callback` — **required for Android**

In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services →
Credentials → your OAuth 2.0 Client ID, add this authorised redirect URI:

- `https://<your-project-ref>.supabase.co/auth/v1/callback`

## Commands

```bash
npm run dev              # dev server
npm run verify           # typecheck + unused check + tests + build
npm test                 # tests only
npm run build            # production build to dist/
npm run cap:build        # web build + cap sync + custom native file sync
npm run cap:sync         # sync only, no rebuild
```

## Android build

`.github/workflows/build-android.yml` builds a debug APK on every push to
`main` and attaches it to the run as an artifact. That is the easiest way to get
a build.

Locally:

```bash
npm run cap:build
cd android && ./gradlew assembleDebug
```

Custom native code lives in **`android-custom/`**, not `android/`.
`scripts/sync-android.sh` copies it in. The `android/` directory is generated
and gitignored — CI deletes and recreates it on every build, so edits made there
are lost.

Transaction capture needs Android's special **Notification access** permission
(Settings → Apps → Special app access → Notification access). The app links you
straight there.

## Known limitations

- **Google Play Billing is not implemented.** The 14-day trial works; paid
  subscriptions are not wired up.
- **CI never runs the app.** It type-checks, tests and builds an APK.
  Notification capture, tray suppression, on-device AI, the home-screen widget,
  haptics and anything visual can only be verified on a real device.

## License

Private project.
