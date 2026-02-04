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
Create a `.env` file in the root directory with:
```
VITE_PUBLIC_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
GEMINI_API_KEY=your_gemini_api_key (optional)
```

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

Sync with Android:
```bash
npm run cap:sync
```

Build and sync:
```bash
npm run cap:build
```

## Architecture

- **Frontend**: React 19 with TypeScript
- **Styling**: Tailwind CSS (production-ready, not CDN)
- **Backend**: Supabase (PostgreSQL + Auth)
- **Build Tool**: Vite
- **Mobile**: Capacitor for native Android app

## Common Issues

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
