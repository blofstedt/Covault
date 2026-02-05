# 🔧 How to Fix and Test the APK

## The Problem We Found

Your GitHub Actions workflow was building the APK with the **WRONG environment variable name**, causing Supabase to be undefined in the APK. That's why:
- ✅ Vercel worked (it handles env vars automatically)
- ❌ Downloaded APK didn't work (needs exact env var names)

## Step-by-Step Fix

### Step 1: Update GitHub Secrets ⚙️

1. **Go to your repository secrets:**
   ```
   https://github.com/blofstedt/Covault/settings/secrets/actions
   ```

2. **Check if you have these secrets:**
   - Look for `VITE_PUBLIC_SUPABASE_URL` (note the "PUBLIC")
   - Look for `VITE_SUPABASE_ANON_KEY`
   - Look for `GEMINI_API_KEY` (optional)

3. **If you only have `VITE_SUPABASE_URL`:**
   - Click "New repository secret"
   - Name: `VITE_PUBLIC_SUPABASE_URL`
   - Value: (same as your `VITE_SUPABASE_URL` - your Supabase project URL)
   - Click "Add secret"

4. **Verify you have:**
   - ✅ `VITE_PUBLIC_SUPABASE_URL` = https://your-project-id.supabase.co
   - ✅ `VITE_SUPABASE_ANON_KEY` = your-anon-key
   - ✅ `GEMINI_API_KEY` = your-gemini-key (optional)

### Step 2: Merge This PR to Main 🔀

1. Go to your PR: https://github.com/blofstedt/Covault/pull/[PR_NUMBER]
2. Click "Merge pull request"
3. Confirm merge

### Step 3: Build a New APK 🏗️

1. **Go to Actions tab:**
   ```
   https://github.com/blofstedt/Covault/actions
   ```

2. **Run the workflow:**
   - Click on "Build Android App" workflow
   - Click "Run workflow" button (top right)
   - Select branch: `main`
   - Click green "Run workflow" button

3. **Wait for build to complete** (~5-10 minutes)
   - You'll see a green checkmark when done

4. **Download the APK:**
   - Click on the completed workflow run
   - Scroll down to "Artifacts"
   - Download the `Covault-YYYYMMDD-HHMMSS.apk` file

### Step 4: Install and Test 📱

1. **Transfer APK to your Android device**
   - Via USB, Google Drive, email, etc.

2. **Uninstall the old APK first** (important!)
   - Settings → Apps → Covault → Uninstall
   - This clears the old cached data

3. **Install the new APK**
   - Open the APK file
   - Allow installation from unknown sources if prompted

4. **Test authentication:**
   - Open Covault
   - Tap "Connect with Google"
   - Should open browser for Google OAuth
   - After authorizing, should return to app
   - ✅ You should be authenticated!

## Debugging If It Still Doesn't Work

If authentication still fails after all this:

### Check 1: Verify Supabase Config in APK

Use `adb logcat` to see the console logs:
```bash
adb logcat | grep -E "supabase|Supabase|auth"
```

You should see:
- ✅ **Good:** Supabase client initializing with your URL
- ❌ **Bad:** "Stub client in use" or "Supabase is not configured"

If you see the "not configured" message, the env vars still aren't being embedded.

### Check 2: Verify GitHub Secrets Were Used

1. Go to the Actions run you used
2. Click on "Build web app" step
3. Look for this in the logs:
   ```
   Run npm run build
   env:
     VITE_PUBLIC_SUPABASE_URL: ***
     VITE_SUPABASE_ANON_KEY: ***
   ```
   The `***` means the secrets are being passed (GitHub hides them for security)

### Check 3: Verify Deep Link Configuration

In Supabase Dashboard:
1. Go to Authentication → URL Configuration
2. Under "Redirect URLs", verify you have:
   ```
   com.covault.app://auth/callback
   ```

## What We Fixed in This PR

1. ✅ **Manifest 401 Error** - Fixed by using root manifest.json
2. ✅ **Android Auth Flow** - Added skipBrowserRedirect and better deep link parsing
3. ✅ **APK Build Environment Variables** - Fixed workflow to use correct env var names
4. ✅ **Android-specific Supabase Config** - Platform-aware configuration

## Questions?

If you're still having issues:
1. Share the output of `adb logcat | grep -i supabase`
2. Share a screenshot of your GitHub Secrets page (blur the actual values)
3. Share the GitHub Actions build logs

Everything should work once the secrets are named correctly! 🎉
