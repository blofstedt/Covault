# Android Setup Guide for Covault

This guide will help you set up and build the Covault Android app, especially if you're encountering Supabase configuration issues.

## Prerequisites

- Node.js >= 20.0.0
- Android Studio
- Java Development Kit (JDK) 11 or higher
- A Supabase account with a project set up

## Step 1: Set Up Environment Variables

The most common cause of "Supabase is not configured" errors on Android is missing environment variables during the build process.

1. **Create a `.env` file** in the project root (if you don't have one already):

```bash
# Copy the example file
cp .env.example .env
```

2. **Edit `.env` and add your Supabase credentials**:

```env
VITE_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

**Where to find these values:**
- Log in to [Supabase Dashboard](https://app.supabase.com/)
- Select your project
- Go to **Settings > API**
- Copy "Project URL" → `VITE_PUBLIC_SUPABASE_URL`
- Copy "anon public" key → `VITE_SUPABASE_ANON_KEY`

## Step 2: Configure Supabase Redirect URLs

This is **CRITICAL** for Android OAuth to work.

1. In Supabase Dashboard, go to **Authentication > URL Configuration**
2. Scroll to **Redirect URLs** section
3. Add the following URL: `com.covault.app://auth/callback`
4. Click **Save**

**Why this is needed:** When users authenticate with Google on Android, Supabase needs to know where to redirect them back. The Android app uses a custom URL scheme (`com.covault.app://`) to handle OAuth callbacks.

## Step 3: Configure Google OAuth (if using Google Sign-In)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to **APIs & Services > Credentials**
4. Find and edit your **OAuth 2.0 Client ID**
5. Under **Authorized redirect URIs**, add:
   ```
   https://your-project-id.supabase.co/auth/v1/callback
   ```
6. Save changes

## Step 4: Build the Android App

With environment variables properly configured, build the app:

```bash
# Install dependencies (if not already done)
npm install

# Build the web app and sync to Android
npm run cap:build
```

This command does three things:
1. Runs `npm run build` - builds the React app and **embeds your env vars** into the JavaScript bundle
2. Runs `npx cap sync android` - copies the built files to the Android project
3. Runs `bash scripts/sync-android.sh` - copies custom Android resources (icons, manifest, etc.)

## Step 5: Open and Run in Android Studio

```bash
# Open the Android project in Android Studio
npx cap open android
```

Then in Android Studio:
1. Wait for Gradle sync to complete
2. Click the green "Run" button
3. Select a device/emulator
4. The app should launch

## Troubleshooting

### Issue: "Supabase is not configured" error on Android

**Diagnosis:** The environment variables weren't properly embedded during build.

**Solution:**
1. Verify `.env` file exists with correct values
2. Delete the `dist` folder: `rm -rf dist`
3. Rebuild: `npm run cap:build`
4. Verify env vars are in the build:
   ```bash
   grep -r "your-project-id.supabase.co" dist/assets/
   ```
   You should see your Supabase URL in the JavaScript files.

### Issue: OAuth redirect fails

**Diagnosis:** The redirect URL isn't configured in Supabase.

**Solution:**
1. Double-check Supabase Dashboard > Authentication > URL Configuration
2. Ensure `com.covault.app://auth/callback` is in the Redirect URLs list
3. Save and wait a few minutes for changes to propagate

### Issue: "Failed to get session" or authentication loops

**Solution:**
1. Clear the Android app data:
   - Settings > Apps > Covault > Storage > Clear Storage
2. Uninstall and reinstall the app
3. Try authentication again

### Issue: Build fails with "vite not found"

**Solution:**
```bash
# Remove node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

## Verifying Your Setup

To verify everything is configured correctly:

1. **Check `.env` file:**
   ```bash
   cat .env
   ```
   Should show your Supabase URL and key.

2. **Check Vite config:**
   ```bash
   grep -A 5 "VITE_PUBLIC_SUPABASE" vite.config.ts
   ```
   Should show the env vars are defined.

3. **Check build output:**
   ```bash
   npm run build
   # Then check if env vars are embedded:
   grep -o "https://[^\"]*supabase.co" dist/assets/*.js | head -1
   ```
   Should output your Supabase URL.

4. **Check Supabase redirect URLs:**
   - Log in to Supabase Dashboard
   - Go to Authentication > URL Configuration
   - Verify `com.covault.app://auth/callback` is listed

## Additional Resources

- [Supabase Authentication Documentation](https://supabase.com/docs/guides/auth)
- [Capacitor Android Documentation](https://capacitorjs.com/docs/android)
- [Vite Environment Variables](https://vitejs.dev/guide/env-and-mode.html)

## Getting Help

If you're still having issues:
1. Check the Android logs: `adb logcat | grep -i supabase`
2. Check the browser console in Android Studio's Device Inspector
3. Open an issue on GitHub with:
   - Your build command output
   - Android logcat output
   - Screenshots of errors
