# Supabase Database Schema - Covault

## Overview

The Covault application uses **14 tables** in the Supabase database. The schema file (`supabase/schema.sql`) contains a safe, idempotent migration that can be run on an existing database without data loss.

## Database Tables

### Core Tables (14 total)

1. **categories** - Budget categories (Housing, Groceries, Transport, Utilities, Leisure, Other)
2. **settings** - User settings, preferences, and trial/subscription status
3. **household_links** - Links two users as household partners
4. **link_codes** - Temporary invitation codes for household linking
5. **transactions** - Financial transactions with categories and recurrence
6. **transaction_budget_splits** - Multi-category transaction splits
7. **pending_transactions** - Auto-parsed transactions awaiting approval
8. **budgets** - Per-user category spending limits
9. **validation_baselines** - Learned patterns for notification parsing validation
10. **notification_rules** - Bank notification parsing rules per user
11. **vendor_overrides** - User-specific vendor-to-category mappings
12. **flag_reports** - Reports for incorrect notification parsing
13. **ignored_transactions** - User rules to ignore known non-expense notifications
14. **notification_fingerprints** - Deduplication hashes for notifications

## Key Changes from Problem Statement

The problem statement included tables that were **mismatched** with the actual application:

### ❌ NOT NEEDED (already handled by existing tables):
- `linked_partners` - The app uses `household_links` instead
- `user_budgets` - The app uses `budgets` instead (which stores category name, not category_id)

### ✅ ADDED to match problem statement:
- `settings.app_notifications_enabled` field (boolean DEFAULT false)

## Deployment

### Safe Migration (Existing Database)

1. Open your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy and paste the entire contents of `supabase/schema.sql`
4. Click "Run" to execute

✅ **Safe**: Uses `IF NOT EXISTS` guards throughout. Will not drop tables, delete data, or duplicate rows.

### Fresh Install (Empty Database)

1. Use `supabase/schema_fresh_install.sql` instead
2. This drops all tables and recreates them from scratch

**⚠️ WARNING**: The fresh install script will DROP all existing tables. Only use on an empty/new database.

## Schema Structure

### Relationship Map

```
auth.users (Supabase Auth)
    ↓
    ├── settings (1:1)
    ├── household_links (many:many) ← active household partnerships
    ├── link_codes (1:many) ← temporary invitation codes
    ├── notification_rules (1:many) ← bank parsing rules
    ├── transactions (1:many)
    │       ↓
    │       └── transaction_budget_splits (1:many)
    ├── budgets (1:many) ← category spending limits
    ├── vendor_overrides (1:many)
    ├── flag_reports (1:many)
    ├── pending_transactions (1:many)
    └── validation_baselines (1:many)

categories (global)
    ↓
    ├── transactions (many:1)
    ├── vendor_overrides (many:1)
    └── notification_rules.default_category_id (many:1)
```

## Key Features

### Data Types
- All IDs use `uuid` with `gen_random_uuid()` default
- Amounts use `numeric(12,2)` for monetary values
- Timestamps use `timestamptz` (timestamp with time zone)

### Security
- Row Level Security (RLS) enabled on all tables
- Policies enforce user-owns-data model
- Partner transactions visible via household_links

### Indexes
- Performance indexes on user_id, date, category_id
- Conditional indexes for split_group_id and source_hash
- Composite index on (user_id, vendor)

## Important Notes

1. **Household System**: The app uses `household_links` to connect users, NOT `linked_partners`. This is a direct many-to-many relationship.

2. **Budget System**: The app uses `budgets` table which stores the category **name** as text, not a foreign key to categories table.

3. **Notification Parsing**: The app has a sophisticated notification parsing system:
   - `notification_rules` - rules for parsing bank notifications
   - `pending_transactions` - parsed transactions awaiting confirmation
   - `validation_baselines` - learned validation patterns
   - `flag_reports` - corrections when parsing fails

4. **RLS Policies**: All tables have Row Level Security enabled. Users can only access their own data, with special policies for household partners to view each other's transactions.

## Auto-created Settings

A PostgreSQL trigger automatically creates a settings row for each new user:

```sql
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

This ensures every authenticated user has a settings record with default values.

## Need Help?

If you encounter issues:
1. Check that you're using PostgreSQL 12+ (Supabase uses PostgreSQL)
2. Verify RLS policies are configured correctly
3. Ensure auth.users table exists (Supabase Auth provides this)
4. Check indexes are created for performance
