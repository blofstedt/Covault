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

The [codebase plan](docs/CODEBASE_PLAN.md) tracks the next reliability, structure,
and design improvements. It starts with small changes that keep the phone app
working while the code is reorganized.

## Requirements

- Node.js 22.22.2+
- A Supabase project
- For local Android builds: JDK 21 and the Android SDK (or let CI do it)
- Browser: Chrome 111+, Safari 16.4+, or Firefox 128+
- Android: System WebView 111 or newer. Update Android System WebView and Chrome
  through your app store if the app cannot open.

These browser requirements come from [Tailwind 4](https://tailwindcss.com/docs/upgrade-guide).
The Android configuration declares the same minimum. Its plain HTML recovery page
works without React or Tailwind, including when the browser is too old to draw the app.

## Setup

```bash
git clone https://github.com/blofstedt/Covault.git
cd Covault
npm ci --legacy-peer-deps        # install exactly what the lockfile records
cp .env.example .env.development.local # then fill in the values below
npm run dev                      # http://127.0.0.1:4173
```

`.env.development.local`:

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key>
VITE_ADMIN_EMAIL=you@example.com   # optional
```

Both required values are in Supabase → Project Settings → API ("Project URL"
and the "anon/public" key). `VITE_PUBLIC_SUPABASE_URL` also works in place of
the first.

Without them the app falls back to a stub client that logs warnings and does
nothing useful when started directly with Vite. `npm run dev` checks the
configuration first and explains missing values before starting the server.

**Never commit the service-role key.** It belongs in an environment variable or
a GitHub Actions secret, never in the client bundle. `.env` and anything
matching `*credentials*` / `*secrets*` are gitignored.

## Database

For a new project, run `supabase/schema.sql` once in the Supabase SQL editor.
That is the whole setup. It was generated from the live project and checked
against it on 2026-10-03, and it refuses to run where the tables already exist.

The existing live project is fully up to date as of 2026-10-03. For how to
check any database, and for how to change one, see
[docs/DATABASE_SETUP.md](docs/DATABASE_SETUP.md). Do not re-run the older
files in `supabase/migrations/`. Live already reflects them, and some of them
drop tables.

`pending_transactions` is deliberately **not** in the schema, and the app no
longer refers to it. Captures waiting with the app closed live in the phone's
own queue. See `docs/ARCHITECTURE.md`.

## Auth configuration

Required for Google OAuth to work on web and Android.

In Supabase → **Authentication → URL Configuration**, add these redirect URLs:

- `http://localhost:*` and `http://localhost:*/**` — local development
- `http://127.0.0.1:*` and `http://127.0.0.1:*/**` — local development
- your production web URL
- `com.covault.app://auth/callback` — **required for Android**

In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services →
Credentials → your OAuth 2.0 Client ID, add this authorised redirect URI:

- `https://<your-project-ref>.supabase.co/auth/v1/callback`

## Local sign-in

Use **Connect with Google** at `http://127.0.0.1:4173`. Local development uses
real Supabase authentication and the same vault as the deployed app.

The local redirect entries above must be saved in Supabase's **Authentication
→ URL Configuration → Redirect URLs**. Keep the **Site URL** set to the deployed
app. If a local address is absent from the allowlist, Supabase sends sign-in
back to the deployed Site URL instead. Editing these settings requires an
account with permission to manage authentication.

`npm run dev` uses one fixed port and stops if that port is occupied. It does
not silently pick another address. For a second preview, supply another free
port with Vite's `--port` option. The loopback redirect patterns above cover
those ports too. Continue the sign-in in the same browser and at the same
hostname where it started; `localhost` and `127.0.0.1` store separate sessions.

Linked Git worktrees can reuse the main checkout's `.env.development.local`
when they have no Supabase settings of their own. Only the public project URL
and client key are inherited. A worktree's own settings take priority; a
partially configured worktree fails clearly rather than borrowing a key from
another project. Nothing copies or commits the environment files. Use a
Supabase **publishable** or **anon/public** key, never a secret or service-role key.

The browser test suite remains separate. It uses fake local accounts and
never signs into the live household.

## Commands

```bash
npm run dev              # dev server
npm run verify           # typecheck + unused check + lint + tests + build
npm test                 # tests only
npm run test:e2e         # Playwright browser tests against a local stand-in for Supabase
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

Custom native code lives in **`native/android/`**, not `android/`.
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
