# Column Mapping Verification

This document verifies that all database schema columns match what the application code actually uses.

## ✅ VERIFIED: All Critical Mappings Are Correct

### 1. transactions Table

**Database Schema:**
```sql
CREATE TABLE public.transactions (
  id uuid,
  user_id uuid,
  vendor text,
  amount numeric(12,2),
  date date,
  category_id uuid,  -- ← Note: column is "category_id" in DB
  recurrence text,
  label text,
  is_projected boolean,
  split_group_id uuid,
  source_hash text,
  user_name text,
  created_at timestamptz,
  updated_at timestamptz
)
```

**TypeScript Interface (Transaction):**
```typescript
interface Transaction {
  id: string;
  user_id: string;
  vendor: string;
  amount: number;
  date: string;
  budget_id: string | null;  // ← Note: property is "budget_id" in TS
  recurrence?: string;
  label?: string;
  is_projected: boolean;
  userName?: string;
  splits?: TransactionSplit[];
  created_at: string;
}
```

**Mapping Code (lib/useUserData.ts):**
```typescript
// To DB: budget_id → category_id
const row: Record<string, any> = {
  category_id: tx.budget_id,  // ✓ Correctly mapped
  // ... other fields
};

// From DB: category_id → budget_id  
return {
  budget_id: row.category_id,  // ✓ Correctly mapped
  // ... other fields
};
```

✅ **Status:** Correctly mapped via `toSupabaseTransaction()` and `fromSupabaseTransaction()`

---

### 2. settings Table

**Database Schema:**
```sql
CREATE TABLE public.settings (
  user_id uuid,
  name text,
  email text,
  partner_id uuid,
  partner_email text,
  partner_name text,
  has_joint_accounts boolean,
  budgeting_solo boolean,
  monthly_income numeric,
  rollover_enabled boolean,
  rollover_overspend boolean,
  use_leisure_as_buffer boolean,
  show_savings_insight boolean,
  theme text,
  has_seen_tutorial boolean,
  app_notifications_enabled boolean  -- ✓ New field added
)
```

**TypeScript Interface (Settings):**
```typescript
interface Settings {
  userId: string;
  name: string;
  email: string;
  partnerId?: string;
  partnerEmail?: string;
  partnerName?: string;
  hasJointAccounts?: boolean;
  budgetingSolo?: boolean;
  monthlyIncome?: number;
  rolloverEnabled?: boolean;
  rolloverOverspend?: boolean;
  useLeisureAsBuffer?: boolean;
  showSavingsInsight?: boolean;
  theme?: 'light' | 'dark';
  hasSeenTutorial?: boolean;
  // Note: app_notifications_enabled not in interface but accessed directly
}
```

**Usage:**
- The app queries `app_notifications_enabled` directly via REST API
- Used in `lib/appNotifications.ts` as snake_case: `settings.app_notifications_enabled`
- Accessed in Dashboard.tsx: `(state.settings as any).app_notifications_enabled`

✅ **Status:** Field exists in schema, app accesses it correctly using snake_case

---

### 3. categories Table

**Database Schema:**
```sql
CREATE TABLE public.categories (
  id uuid,
  name text UNIQUE,
  display_order integer,
  created_at timestamptz
)
```

**Usage:**
- App loads via REST API: `categories?select=*&order=display_order`
- Maps to `BudgetCategory` interface (only uses id, name)
- `PrimaryCategory` interface exists but not actively used

✅ **Status:** Schema matches actual usage

---

### 4. budgets Table

**Database Schema:**
```sql
CREATE TABLE public.budgets (
  id uuid,
  category text,        -- ← Note: stores category NAME, not FK
  limit_amount numeric,
  user_id uuid,
  is_household boolean,
  parent_category text,
  icon text,
  color text,
  created_at timestamptz,
  updated_at timestamptz
)
```

**Usage:**
- Query: `budgets?select=*&user_id=eq.${userId}`
- Maps category name to limit: `limitsByCategory[row.category] = Number(row.limit_amount)`
- Saves: `{ user_id, category: categoryName, limit_amount: newLimit }`

✅ **Status:** Stores category NAME (text), not category_id FK - matches app usage

---

### 5. household_links Table

**Database Schema:**
```sql
CREATE TABLE public.household_links (
  id uuid,
  user1_id uuid,
  user2_id uuid,
  created_at timestamptz,
  user1_name text,
  user2_name text
)
```

**Usage:**
- Query: `household_links?select=*&or=(user1_id.eq.${userId},user2_id.eq.${userId})`
- Determines partner relationships for joint accounts

✅ **Status:** Correct structure for many-to-many user partnerships

---

### 6. link_codes Table

**Database Schema:**
```sql
CREATE TABLE public.link_codes (
  code text PRIMARY KEY,
  user_id uuid,
  expires_at timestamptz,
  created_at timestamptz
)
```

**Usage:**
- Query: `link_codes?select=*&code=eq.${code}&expires_at=gt.${now}`
- Create: `{ code, user_id, expires_at }`

✅ **Status:** Correct

---

### 7. pending_transactions Table

**Database Schema:**
```sql
CREATE TABLE public.pending_transactions (
  id uuid,
  user_id uuid,
  app_package text,
  app_name text,
  notification_title text,
  notification_text text,
  notification_timestamp bigint,
  posted_at timestamptz,
  extracted_vendor text,
  extracted_amount numeric(12,2),
  extracted_timestamp timestamptz,
  confidence integer,
  validation_reasons text,
  needs_review boolean,
  pattern_id text,
  created_at timestamptz,
  reviewed_at timestamptz,
  approved boolean
)
```

✅ **Status:** All columns match PendingTransaction interface

---

### 8. transaction_budget_splits Table

**Database Schema:**
```sql
CREATE TABLE public.transaction_budget_splits (
  id uuid,
  transaction_id uuid,
  budget_category text,
  amount numeric(12,2),
  percentage numeric,
  created_at timestamptz
)
```

✅ **Status:** All columns match TransactionBudgetSplit interface

---

### 9. notification_rules Table

**Database Schema:**
```sql
CREATE TABLE public.notification_rules (
  id uuid,
  user_id uuid,
  bank_app_id text,
  bank_name text,
  amount_regex text,
  vendor_regex text,
  default_category_id uuid,
  is_active boolean,
  flagged_count integer,
  last_flagged_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
```

✅ **Status:** Matches app usage in useNotificationListener.ts

---

### 10. vendor_overrides Table

**Database Schema:**
```sql
CREATE TABLE public.vendor_overrides (
  id uuid,
  user_id uuid,
  vendor_name text,
  category_id uuid,
  created_at timestamptz
)
```

✅ **Status:** Correct

---

### 11. flag_reports Table

**Database Schema:**
```sql
CREATE TABLE public.flag_reports (
  id uuid,
  user_id uuid,
  notification_rule_id uuid,
  raw_notification text,
  expected_vendor text,
  expected_amount numeric(12,2),
  resolved boolean,
  created_at timestamptz
)
```

✅ **Status:** Correct

---

### 12. validation_baselines Table

**Database Schema:**
```sql
CREATE TABLE public.validation_baselines (
  id uuid,
  app_package text,
  user_id uuid,
  vendor_length_min integer,
  vendor_length_max integer,
  vendor_character_classes text,
  vendor_case_style text,
  vendor_forbidden_patterns text,
  amount_range_min numeric(12,2),
  amount_range_max numeric(12,2),
  amount_decimal_places integer,
  confidence_threshold integer,
  sample_count integer,
  created_at timestamptz,
  updated_at timestamptz
)
```

✅ **Status:** All columns match ValidationBaseline interface

---

## Summary

✅ **All 12 tables have correct column mappings**
✅ **Critical mapping (budget_id ↔ category_id) is handled correctly in code**
✅ **app_notifications_enabled field added to settings table**
✅ **All snake_case/camelCase conversions are handled properly**
✅ **budgets table correctly stores category NAME (text), not category_id FK**
✅ **household_links table (not linked_partners) matches app usage**

## No Changes Needed

The schema is correct and matches the application code's actual usage patterns.
