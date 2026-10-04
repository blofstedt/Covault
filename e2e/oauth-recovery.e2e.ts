import { createHash, randomUUID } from 'node:crypto';
import { test, expect } from './fixtures';

function localBaseUrl(baseURL: string | undefined): string {
  if (!baseURL) throw new Error('A local base URL is required.');
  return baseURL;
}

test('completes one real SDK PKCE exchange on the current local origin', async ({ page, request, baseURL: configuredURL }) => {
  const baseURL = localBaseUrl(configuredURL);
  const userId = randomUUID();
  const token = `covault-e2e.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.${userId}`;
  const endpoint = `${baseURL}/mock-supabase/__test/vaults`;
  const seed = await request.post(endpoint, { data: {
    userId, token, vendor: 'Local OAuth Store', transactionId: randomUUID(),
  } });
  expect(seed.ok()).toBe(true);
  let authorizationUrl = '';
  const exchanges: unknown[] = [];
  const verifiers: string[] = [];

  try {
    // There is no seeded auth session. Only the SDK's callback exchange signs in.
    await page.addInitScript(userId => {
      localStorage.setItem(`covault_onboarded_v1:${userId}`, '1');
    }, userId);
    await page.route('**/mock-supabase/auth/v1/authorize?**', async route => {
      authorizationUrl = route.request().url();
      await route.fulfill({ status: 302, headers: { Location: `${baseURL}/?code=local-success&keep=review` }, body: '' });
    });
    await page.route('**/mock-supabase/auth/v1/token?grant_type=pkce', async route => {
      exchanges.push(route.request().postDataJSON());
      // Supabase sends JSON; inspect the received value without trusting its shape.
      const data: unknown = route.request().postDataJSON();
      if (data && typeof data === 'object' && 'code_verifier' in data && typeof data.code_verifier === 'string') {
        verifiers.push(data.code_verifier);
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        access_token: token, refresh_token: `refresh-${userId}`, token_type: 'bearer', expires_in: 3600,
        user: {
          id: userId, email: `${userId}@example.test`, created_at: '2020-01-01T00:00:00Z',
          user_metadata: { full_name: 'Browser Test' }, app_metadata: { provider: 'google', providers: ['google'] },
          aud: 'authenticated', role: 'authenticated',
        },
      }) });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Connect with Google' }).click();
    await expect(page.getByRole('button', { name: 'Find entry...' })).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}/?keep=review`);
    await page.getByRole('button', { name: 'Find entry...' }).click();
    await page.getByPlaceholder('Find entry...').fill('Local OAuth');
    await expect(page.getByText('Local OAuth Store', { exact: true })).toBeVisible();
    expect(exchanges).toEqual([{ auth_code: 'local-success', code_verifier: expect.stringMatching(/^[a-zA-Z0-9]+$/) }]);
    expect(verifiers).toHaveLength(1);
    const authorization = new URL(authorizationUrl);
    expect(authorization.searchParams.get('provider')).toBe('google');
    expect(authorization.searchParams.get('redirect_to')).toBe(baseURL);
    expect(authorization.searchParams.get('code_challenge_method')).toBe('s256');
    expect(authorization.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifiers[0]).digest('base64url'));
  } finally {
    const deleted = await request.delete(`${endpoint}/${userId}`);
    expect(deleted.ok()).toBe(true);
  }
});

test('shows a denied callback clearly, keeps unrelated URL state, and allows retry', async ({ page, baseURL }, testInfo) => {
  await page.goto('/?keep=review#error=access_denied&error_description=private-provider-detail&theme=light');
  await expect(page.getByRole('alert')).toHaveText('Google sign-in was cancelled. You can try again.');
  await expect(page.getByRole('button', { name: 'Connect with Google' })).toBeEnabled();
  await expect(page).toHaveURL(`${baseURL}/?keep=review#theme=light`);
  await page.screenshot({ path: testInfo.outputPath('oauth-cancelled-dark-393.png') });
  await page.route('**/mock-supabase/auth/v1/authorize?**', async route => {
    await route.fulfill({ status: 302, headers: { Location: `${baseURL}/?retry=1#error=access_denied` }, body: '' });
  });
  await page.getByRole('button', { name: 'Connect with Google' }).click();
  await expect(page.getByRole('alert')).toHaveText('Google sign-in was cancelled. You can try again.');
  await expect(page.getByRole('button', { name: 'Connect with Google' })).toBeEnabled();
  await expect(page).toHaveURL(`${baseURL}/?retry=1`);
});

test('keeps callback feedback and retry usable on a narrow light-theme phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(() => { localStorage.setItem('covault_settings', JSON.stringify({ theme: 'light' })); });
  await page.goto('/?error=access_denied');
  await expect(page.getByRole('alert')).toHaveText('Google sign-in was cancelled. You can try again.');
  const retry = page.getByRole('button', { name: 'Connect with Google' });
  await expect(retry).toBeEnabled();
  const buttonBounds = await retry.boundingBox();
  expect(buttonBounds).toEqual({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) });
  expect((buttonBounds?.y ?? 640) + (buttonBounds?.height ?? 1)).toBeLessThanOrEqual(640);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath('oauth-cancelled-light-320.png') });
});

test('explains an invalid code with a verifier and removes only callback parameters', async ({ page, baseURL }) => {
  await page.addInitScript(() => { localStorage.setItem('sb-127-auth-token-code-verifier', JSON.stringify('local-verifier')); });
  const exchanges: unknown[] = [];
  await page.route('**/mock-supabase/auth/v1/token?grant_type=pkce', async route => {
    exchanges.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({
      code: 'flow_state_expired', msg: 'Private callback diagnostic',
    }) });
  });
  await page.goto('/?code=expired&keep=review#section');
  await expect(page.getByRole('alert')).toHaveText("We couldn't finish Google sign-in. Please try again.");
  await expect(page.getByRole('button', { name: 'Connect with Google' })).toBeEnabled();
  await expect(page).toHaveURL(`${baseURL}/?keep=review#section`);
  expect(exchanges).toEqual([{ auth_code: 'expired', code_verifier: 'local-verifier' }]);
});

test('explains a callback opened without its verifier instead of silently ignoring it', async ({ page, baseURL }) => {
  await page.goto('/?code=copied-from-another-origin&keep=review#section');
  await expect(page.getByRole('alert')).toHaveText("We couldn't finish Google sign-in. Please try again.");
  await expect(page.getByRole('button', { name: 'Connect with Google' })).toBeEnabled();
  await expect(page).toHaveURL(`${baseURL}/?keep=review#section`);
});
