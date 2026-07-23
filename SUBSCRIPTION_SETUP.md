# Subscription & Trial Setup Guide

This guide covers the SQL migration for the 14-day free trial system and the steps to configure Google Play Billing for in-app subscriptions.

---

## 1. SQL Migration (Existing Databases)

Run `supabase/schema.sql` in the **Supabase SQL Editor**. It is fully idempotent — safe to run on an existing database with data:

- Uses `CREATE TABLE IF NOT EXISTS` (never drops tables)
- Uses `ALTER TABLE ... ADD COLUMN` with `IF NOT EXISTS` guards
- Uses `CREATE INDEX IF NOT EXISTS`
- RLS policies are wrapped in existence checks
- Existing users are backfilled with trial data via `COALESCE` (won't overwrite)

> **For brand-new databases** with no data, you can alternatively use `supabase/schema_fresh_install.sql`, which drops and recreates everything cleanly.

---

## 2. Entitlement Logic

The app uses a single source of truth for premium access defined in `lib/entitlement.ts`:

```typescript
hasPremiumAccess =
  subscription_status === 'active'
  OR current_time < trial_ends_at
```

**Premium Features** (gated after trial expires):
- Custom notifications
- Automatic bank notification parsing
- Spending chart access
- Priority help
- Ability to request features

**Free Features** (always available):
- Core budgeting
- Manual transaction entry
- Viewing transactions
- Basic app functionality

---

## 3. Google Play Billing Setup

### Prerequisites
- Google Play Developer account ($25 one-time fee)
- App published on Google Play (at least in internal/closed testing)
- Signed release APK/AAB

### Step 1: Create the Subscription in Google Play Console

1. Go to [Google Play Console](https://play.google.com/console)
2. Select your app → **Monetize** → **Products** → **Subscriptions**
3. Click **Create subscription**
4. Fill in:
   - **Product ID**: `covault_premium` (this ID is used in the app code)
   - **Name**: Covault Premium
   - **Description**: Unlock all premium features including custom notifications, spending charts, and more
5. Add a **Base plan**:
   - **Plan ID**: `monthly` (or `yearly`)
   - **Price**: Set your monthly/yearly price
   - **Renewal type**: Auto-renewing
   - **Grace period**: 7 days (recommended)
   - **Account hold**: 30 days (recommended)
6. **Do NOT** enable a Google Play free trial (the app manages its own 14-day trial)
7. Click **Activate**

### Step 2: Install the Capacitor Billing Plugin

For Capacitor apps, use the `@capgo/capacitor-purchases` plugin or the native Google Play Billing Library via a custom Capacitor plugin.

```bash
npm install @capgo/capacitor-purchases
npx cap sync android
```

### Step 3: Implement the Purchase Flow (Client-Side)

In your app, when the user taps **Subscribe**:

```typescript
// Example integration point in Dashboard.tsx handleSubscribe():
import { Purchases } from '@capgo/capacitor-purchases';

const handleSubscribe = async () => {
  try {
    // 1. Get available packages
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.availablePackages[0];
    if (!pkg) return;

    // 2. Start purchase flow
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });

    // 3. Send purchase token to your backend for verification
    // 4. Backend updates subscription_status = 'active' in Supabase
    // 5. Reload user data to reflect new status
  } catch (err) {
    console.error('Purchase failed:', err);
  }
};
```

### Step 4: Server-Side Verification (Supabase Edge Function)

Create a Supabase Edge Function to verify purchases with Google Play:

```sql
-- Create the edge function endpoint
-- File: supabase/functions/verify-purchase/index.ts
```

```typescript
// supabase/functions/verify-purchase/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  const { purchaseToken, productId } = await req.json();

  // Verify with Google Play Developer API
  // (requires Google Service Account credentials)
  const verifyUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.covault.app/purchases/subscriptions/${productId}/tokens/${purchaseToken}`;

  const googleRes = await fetch(verifyUrl, {
    headers: { Authorization: `Bearer ${GOOGLE_ACCESS_TOKEN}` },
  });

  if (!googleRes.ok) {
    return new Response(JSON.stringify({ error: 'Invalid purchase' }), { status: 400 });
  }

  const purchase = await googleRes.json();

  // Update user subscription status in Supabase
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const userId = req.headers.get('x-user-id'); // Pass from client
  await supabase
    .from('settings')
    .update({ subscription_status: 'active' })
    .eq('user_id', userId);

  return new Response(JSON.stringify({ status: 'active' }), { status: 200 });
});
```

### Step 5: Handle Real-Time Developer Notifications (RTDN)

Google Play sends webhook notifications when subscriptions change (renewed, cancelled, expired, etc.):

1. In Google Play Console → **Monetize** → **Monetization setup**
2. Set up a **Cloud Pub/Sub topic** for RTDN
3. Create a Supabase Edge Function or Cloud Function that:
   - Listens to the Pub/Sub topic
   - Parses the notification
   - Updates `subscription_status` in the `settings` table accordingly

### Step 6: Testing

1. Add test accounts in Google Play Console → **Settings** → **License testing**
2. Use `adb` to install debug builds
3. Test the full flow:
   - New user signup → 14-day trial starts
   - Trial expiration → premium features lock
   - Subscribe → features unlock immediately
   - Cancel subscription → features lock after billing period ends

---

## 4. Edge Cases Handled

| Scenario | Behavior |
|---|---|
| Trial expires while app is open | Features lock on next data refresh or app resume |
| Subscription always overrides trial | `subscription_status === 'active'` bypasses trial check |
| Trial persists across reinstalls | Backend is source of truth (no local-only tracking) |
| No credit card for trial | Trial is free, no payment required |
| No auto-subscription after trial | User must explicitly subscribe |
| Logout/reinstall/device change | Trial never resets (`trial_consumed = true`) |

---

## 5. Architecture Summary

```
User signs up
  → handle_new_user() trigger sets trial_started_at, trial_ends_at, trial_consumed
  → App loads trial data from settings table
  → hasPremiumAccess() checks: subscription_status === 'active' OR now < trial_ends_at
  → UI gates premium features via PremiumGate component
  → Locked features show "Subscribe for More!" modal on tap
  → Subscribe button triggers Google Play Billing flow
  → Purchase verified server-side → subscription_status = 'active'
  → App refreshes → all features unlock
```
