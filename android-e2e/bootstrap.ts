import { createTestBackend, TEST_BANK_PACKAGE, TEST_SUPABASE_URL, TEST_USER_ID } from './backend';
import { clearFirstPaintCache } from '../lib/firstPaintCache';

// Vite inserts this as the first dependency of the app entry. It never ships
// in a normal build, and there is no production flag or login bypass at runtime.
// Reopen checks must read the fake database rather than pass from cached UI rows.
clearFirstPaintCache();
const expiry = Math.floor(Date.now() / 1000) + 86_400;
const payload = btoa(JSON.stringify({ exp: expiry, sub: TEST_USER_ID, role: 'authenticated' }));
const token = `android-test.${payload}.not-a-real-signature`;
const storageKey = `sb-${new URL(TEST_SUPABASE_URL).hostname.split('.', 1)[0]}-auth-token`;
localStorage.setItem(storageKey, JSON.stringify({
  access_token: token, refresh_token: 'synthetic-android-refresh', token_type: 'bearer',
  expires_in: 86_400, expires_at: expiry,
  user: {
    id: TEST_USER_ID, email: 'android@example.test', created_at: '2020-01-01T00:00:00Z',
    user_metadata: { full_name: 'Android Test' },
    app_metadata: { provider: 'email', providers: ['email'] },
    aud: 'authenticated', role: 'authenticated',
  },
}));
localStorage.setItem('covault_session_start', String(Date.now()));
localStorage.setItem(`covault_onboarded_v1:${TEST_USER_ID}`, '1');
localStorage.setItem(`covault_first_capture_seen_v1:${TEST_USER_ID}`, '1');
localStorage.setItem('covault_capture_sources_v2', JSON.stringify({ chosen: true, selected: [TEST_BANK_PACKAGE] }));
localStorage.setItem('covault_settings', JSON.stringify({
  theme: 'dark', notificationsEnabled: true,
}));

const backend = createTestBackend(localStorage, token);
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === TEST_SUPABASE_URL) return backend(request);
  if (url.origin === location.origin) return originalFetch(request);
  throw new Error(`Outside network requests are disabled in the Android test APK: ${url.origin}`);
};
