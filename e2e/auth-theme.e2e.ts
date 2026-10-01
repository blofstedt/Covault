import { test, expect } from './fixtures';

test('opens the sign-in screen in the default dark theme', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Covault' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect with Google' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
});

test('uses this browser context’s saved light theme', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('covault_settings', JSON.stringify({ theme: 'light' }));
  });
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Connect with Google' })).toBeVisible();
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
});

test('does not inherit another parallel test’s light theme', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Connect with Google' })).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('covault_settings') ?? '{}').theme)).toBe('dark');
});
