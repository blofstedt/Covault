import { z } from 'zod';
import { test as base, expect } from './fixtures';

type Theme = 'dark' | 'light';
const FIXED_TIME = '2026-01-15T12:00:00.000Z';
const USER_ID = '00000000-0000-4000-8000-000000000101';
const TRANSACTION_ID = '00000000-0000-4000-8000-000000000102';
const token = `covault-e2e.${Buffer.from(JSON.stringify({ exp: Date.parse(FIXED_TIME) / 1000 + 3600 })).toString('base64url')}.${USER_ID}`;
const settingsSchema = z.array(z.object({ user_id: z.string() }).passthrough());
const transactionSchema = z.array(z.object({ id: z.string(), user_id: z.string(), vendor: z.string() }).passthrough());

/** Reuses the existing local-only fixture and fake server's session checks. */
export const test = base.extend<{ screenshotTheme: Theme; screenshotVault: void }>({
  screenshotTheme: ['dark', { option: true }],
  screenshotVault: [async ({ page, request, baseURL, screenshotTheme }, runFixture) => {
    if (!baseURL) throw new Error('Screenshot capture needs a local base URL.');
    const endpoint = `${baseURL}/mock-supabase/__test/vaults`;
    const seeded = await request.post(endpoint, { data: {
      userId: USER_ID, token, vendor: 'Corner Market', transactionId: TRANSACTION_ID,
    } });
    expect(seeded.status()).toBe(201);
    try {
      // Date stays fixed while real timers and React's motion continue normally.
      await page.clock.setFixedTime(new Date(FIXED_TIME));
      await page.addInitScript(({ userId, token, theme }) => {
        localStorage.setItem('sb-127-auth-token', JSON.stringify({
          access_token: token, refresh_token: 'synthetic-preview-refresh', token_type: 'bearer',
          expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: userId, email: 'preview@example.test', created_at: '2020-01-01T00:00:00Z',
            user_metadata: { full_name: 'Preview Household' },
            app_metadata: { provider: 'email', providers: ['email'] },
            aud: 'authenticated', role: 'authenticated',
          },
        }));
        localStorage.setItem('covault_session_start', String(Date.now()));
        localStorage.setItem(`covault_onboarded_v1:${userId}`, '1');
        localStorage.setItem(`covault_first_capture_seen_v1:${userId}`, '1');
        localStorage.setItem('covault_settings', JSON.stringify({ theme, notificationsEnabled: true }));
      }, { userId: USER_ID, token, theme: screenshotTheme });

      await page.route(/\/mock-supabase\/rest\/v1\/(?:settings|budgets|transactions|overrides|notification_rules|banking_apps)(?:\?|$)/, async route => {
        if (route.request().method() !== 'GET') {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        const table = new URL(route.request().url()).pathname.split('/').pop();
        // Never replace an authorization failure with synthetic success.
        if ([401, 403].includes(response.status())) {
          await route.fulfill({ response });
          return;
        }
        if (table === 'settings') {
          expect(response.status()).toBe(200);
          const rows = settingsSchema.parse(await response.json());
          await route.fulfill({ response, json: rows.map(row => ({
            ...row, theme_selected: screenshotTheme, monthly_income: 5000,
            community_rules_enabled: false, community_rules_contribute: false,
            app_notifications_enabled: false, smart_notifications_enabled: false,
            auto_accept_known_vendors: false,
          })) });
        } else if (table === 'transactions') {
          expect(response.status()).toBe(200);
          const rows = transactionSchema.parse(await response.json());
          expect(rows).toHaveLength(1);
          await route.fulfill({ response, json: [
            ...rows.map(row => ({
              ...row, amount: 44.25, date: '2026-01-12', created_at: '2026-01-12T12:00:00.000Z',
              budget: 'Groceries', type: 'Manual', recur: 'One-time', source: 'manual',
            })),
            {
              id: '00000000-0000-4000-8000-000000000103', user_id: USER_ID,
              vendor: 'Corner Cafe', amount: 18.75, date: '2026-01-14',
              created_at: '2026-01-14T12:00:00.000Z', budget: 'Leisure', type: 'Automatic',
              recur: 'One-time', source: 'notification', is_projected: false,
              caught_cleared: false, confidence: 0.96,
              raw_notification: 'You made a purchase at CORNER CAFE for $18.75.',
            },
          ] });
        } else if (table === 'budgets') {
          expect(response.status()).toBe(200);
          await route.fulfill({ response, json: [
            'Housing', 'Groceries', 'Transport', 'Utilities', 'Leisure', 'Services', 'Other',
          ].map(budget => ({ user_uuid: USER_ID, budget, amount: 500, Visible: true })) });
        } else {
          expect(response.status()).toBe(404);
          await route.fulfill({ status: 200, json: [] });
        }
      });
      await page.route('**/mock-supabase/rest/v1/rpc/server_now', async route => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.fulfill({ response, json: FIXED_TIME });
      });
      await runFixture();
    } finally {
      const removed = await request.delete(`${endpoint}/${USER_ID}`);
      expect(removed.ok(), 'The screenshot household must be removed').toBe(true);
    }
  }, { auto: true }],
});

export { expect } from '@playwright/test';
