# Covault

A modern budget tracking Progressive Web App (PWA) built with React, TypeScript, and Supabase.

## Features

- 📊 Budget tracking across multiple categories
- 💰 Monthly income management
- 🔄 Transaction tracking (manual and auto-added)
- 🏠 Household budget sharing
- 📱 Progressive Web App (works offline)
- 🌙 Dark mode support
- 🔐 Secure authentication with Google OAuth

## Setup

### Prerequisites

- Node.js >= 20.0.0
- npm or yarn
- A Supabase account and project

### Installation

1. Clone the repository:
```bash
git clone https://github.com/blofstedt/Covault.git
cd Covault
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env` file in the root directory (see `.env.example` for reference):
```
VITE_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
GEMINI_API_KEY=your_gemini_api_key (optional)
```

**Get your Supabase credentials:**
- Go to your Supabase project dashboard
- Navigate to Settings > API
- Copy the "Project URL" (for `VITE_SUPABASE_URL` or `VITE_PUBLIC_SUPABASE_URL`)
- Copy the "anon/public" key (for `VITE_SUPABASE_ANON_KEY`)

**Note:** Both `VITE_SUPABASE_URL` and `VITE_PUBLIC_SUPABASE_URL` are supported for compatibility.

**Configure Supabase Authentication URLs:**

This is **critical** for OAuth to work on both web and Android:

1. In Supabase Dashboard, go to **Authentication > URL Configuration**
2. Under **Redirect URLs**, add:
   - For web development: `http://localhost:3000`
   - For web production: `https://your-domain.com`
   - **For Android: `com.covault.app://auth/callback`** ← REQUIRED for Android
3. Click **Save**

**Configure Google OAuth:**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to APIs & Services > Credentials
3. Edit your OAuth 2.0 Client ID
4. Under "Authorized redirect URIs", add:
   - `https://your-project-id.supabase.co/auth/v1/callback`
5. Save changes

4. **IMPORTANT: Set up the Supabase database schema**

Before running the app, you MUST create the required database tables in your Supabase project:

1. Open your Supabase project dashboard
2. Go to the SQL Editor
3. Copy the contents of `supabase/schema.sql`
4. Paste and run the SQL in the editor

This will create all necessary tables:
- `categories` - Budget categories
- `settings` - User settings and preferences
- `budgets` - Per-user budget limits
- `transactions` - Transaction records
- `pending_transactions` - Auto-parsed transactions awaiting review
- `household_links` - Household partner connections
- `link_codes` - Temporary codes for household linking
- And other supporting tables

**⚠️ Without running schema.sql first, you will see 404 errors in the console for missing tables.**

### Development

Run the development server:
```bash
npm run dev
```

The app will be available at `http://localhost:3000`

### Build

Build for production:
```bash
npm run build
```

Preview the production build:
```bash
npm run preview
```

### Capacitor (Mobile)

**Prerequisites for Android:**
- Android Studio installed
- Java Development Kit (JDK) 11 or higher
- Android SDK (API level 22 or higher)

**Building for Android:**

1. Ensure your `.env` file has the correct Supabase credentials:
```bash
# These MUST be set for Android builds
# Both VITE_SUPABASE_URL and VITE_PUBLIC_SUPABASE_URL are supported
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

2. Build the web app and sync with Android:
```bash
npm run cap:build
```

This command runs:
- `npm run build` - Builds the React app with env vars embedded
- `npx cap sync android` - Copies build to Android project
- `bash scripts/sync-android.sh` - Copies custom Android resources

3. Open in Android Studio:
```bash
npx cap open android
```

4. Run the app from Android Studio or build APK:
```bash
cd android
./gradlew assembleDebug
```

**Important: Supabase redirect URL for Android**

The Android app uses a custom URL scheme for OAuth callbacks: `com.covault.app://auth/callback`

You **MUST** add this to your Supabase project:
1. Go to Supabase Dashboard > Authentication > URL Configuration
2. Under "Redirect URLs", add: `com.covault.app://auth/callback`
3. Click Save

Without this, you'll get a "Supabase is not configured" error on Android.

**Sync with Android (without rebuild):**
```bash
npm run cap:sync
```

**Build and sync:**
```bash
npm run cap:build
```

## Developer Mode

A secret developer mode is available on **desktop/web only** for quickly previewing UI screens with fake data.

### How to Activate

1. Open the app in a desktop browser
2. On any screen, type **`developer`** on your keyboard (don't click into any input field first)
3. A yellow **🛠 Dev Mode** panel appears in the top-right corner

### How to Deactivate

- Click the **Exit** button in the Dev Mode panel, **or**
- Type **`developer`** again on your keyboard from any screen

### Features

| Feature | Description |
|---------|-------------|
| **Screen Jumping** | Instantly switch between Auth, Onboarding, Dashboard, and Transaction Parsing screens |
| **Solo / Joint Toggle** | Switch the user mode between single user and joint (couples) budgeting |
| **Parsing Toggle** | Switch between notification parsing enabled and disabled views |
| **Fake Data** | All data shown in developer mode is fake — no real database calls are made |

> **Note:** Developer mode is not available on native Android. It only activates when a physical keyboard is detected (desktop browsers).

## Architecture

- **Frontend**: React 19 with TypeScript
- **Styling**: Tailwind CSS (production-ready, not CDN)
- **Backend**: Supabase (PostgreSQL + Auth)
- **Build Tool**: Vite
- **Mobile**: Capacitor for native Android app

## Common Issues

### "Supabase is not configured" Error on Android

**Symptoms**: The Android app shows "Supabase is not configured" error, but web version works fine.

**Solutions**:

1. **Check environment variables are set** before building:
   ```bash
   # Create .env file with your Supabase credentials
   # Both VITE_SUPABASE_URL and VITE_PUBLIC_SUPABASE_URL are supported
   cat > .env << EOF
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   EOF
   
   # Then rebuild
   npm run cap:build
   ```

2. **Add Android redirect URL in Supabase**:
   - Go to Supabase Dashboard > Authentication > URL Configuration
   - Under "Redirect URLs", add: `com.covault.app://auth/callback`
   - Save changes

3. **Verify the build includes env vars**:
   After building, check that `dist/assets/index-*.js` contains your Supabase URL (you can grep for it)

4. **Clear Android app data** and reinstall:
   - In Android Settings, go to Apps > Covault
   - Clear Storage and Cache
   - Uninstall and reinstall the app

### Console Errors about Missing Tables

If you see errors like:
```
Could not find the table 'public.budgets' in the schema cache
```

This means you haven't run the database schema yet. Follow step 4 in the Installation section above.

### Service Worker Registration Failed

This is normal in development. The service worker only works properly in production builds.

### Tailwind CDN Warning

This has been fixed! The app now uses Tailwind CSS as a proper PostCSS plugin, not the CDN version.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `npm run build` to ensure it builds successfully
5. Submit a pull request

## License

[Add your license here]
