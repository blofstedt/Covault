# Quick Fix Guide: Android Supabase Error

## The Problem
You're getting "Supabase is not configured" error on Android, but the web version works fine.

## The Solution (3 Steps)

### Step 1: Create `.env` File ⚙️

In the project root, create a `.env` file with your Supabase credentials:

```bash
VITE_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**Where to get these:**
1. Go to https://app.supabase.com/
2. Open your project
3. Click **Settings** (⚙️) → **API**
4. Copy "Project URL" and "anon public" key

---

### Step 2: Add Android Redirect URL in Supabase 🔐

This is **CRITICAL** - without this, Android OAuth won't work!

1. In Supabase Dashboard, go to **Authentication** → **URL Configuration**
2. Scroll to **Redirect URLs** section
3. Add this URL: `com.covault.app://auth/callback`
4. Click **Save**

**Screenshot guide:**
```
Supabase Dashboard
└── Authentication (left sidebar)
    └── URL Configuration (tab)
        └── Redirect URLs section
            └── Add: com.covault.app://auth/callback
            └── Click Save button
```

---

### Step 3: Rebuild the Android App 📱

```bash
# From the project root
npm run cap:build
```

This will:
- Build the web app with your env vars embedded
- Sync to Android project
- Copy custom Android resources

Then open in Android Studio and run:
```bash
npx cap open android
```

---

## Why This Fixes It

**The Issue:** Android apps need environment variables to be embedded into the JavaScript bundle at build time. The previous config wasn't explicitly telling Vite to do this for Android builds.

**The Fix:** Updated `vite.config.ts` to explicitly define the Supabase env vars, ensuring they're embedded when you run `npm run build`.

---

## Verification

After rebuilding, you can verify the env vars are embedded:

```bash
# Check if your Supabase URL is in the build
grep -r "your-project-id.supabase.co" dist/assets/
```

You should see output showing your Supabase URL in the JavaScript files.

---

## Still Having Issues?

Check the comprehensive guides:
- **ANDROID_SETUP.md** - Full Android setup walkthrough
- **README.md** - Updated with Android-specific instructions

Or verify your Supabase redirect URLs are correct:
1. Supabase must have: `com.covault.app://auth/callback`
2. Google OAuth must have: `https://your-project-id.supabase.co/auth/v1/callback`

---

## What Changed in the Code

✅ **vite.config.ts** - Added explicit env var definitions
✅ **.env.example** - Template for environment variables
✅ **ANDROID_SETUP.md** - Complete Android setup guide
✅ **README.md** - Android-specific instructions added

The fix is already committed. You just need to:
1. Create your `.env` file
2. Add the redirect URL in Supabase
3. Rebuild with `npm run cap:build`

That's it! 🎉
