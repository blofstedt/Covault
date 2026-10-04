import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './pr-screenshots.fixtures';

type ScreenshotName = `mobile-${'dashboard' | 'manual-filled' | 'manual-invalid'}-${'dark' | 'light'}.png`
  | 'mobile-review-dark.png' | 'mobile-settings-light.png';

async function capture(page: Page, name: ScreenshotName) {
  const directory = process.env.COVAULT_SCREENSHOT_DIR;
  if (!directory || !isAbsolute(directory)) throw new Error('COVAULT_SCREENSHOT_DIR must be an absolute directory.');
  await mkdir(directory, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation =>
      animation.effect?.getTiming().iterations !== Infinity,
    ).map(animation => animation.finished.catch(() => {})));
  });
  await page.screenshot({ path: join(directory, name), type: 'png',
    fullPage: false, animations: 'disabled', caret: 'hide', scale: 'css' });
}

async function captureReview(page: Page) {
  await page.getByRole('button', { name: 'Open review', exact: true }).click();
  await expect(page.getByText('Corner Cafe', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Delete all 1 captured transactions', exact: true })).toBeVisible();
  await capture(page, 'mobile-review-dark.png');
}

async function captureSettings(page: Page) {
  // The loaded dashboard's settings cog currently has a stable HTML id.
  await page.locator('#settings-button').click();
  const settings = page.getByRole('dialog', { name: 'Vault Settings', exact: true });
  await expect(settings).toBeVisible();
  await expect(settings.getByText('Monthly Income', { exact: true })).toBeVisible();
  await expect(settings.locator('#settings-income-container').getByRole('spinbutton')).toHaveValue('5000');
  await capture(page, 'mobile-settings-light.png');
}

for (const { theme, htmlClass, captureMore } of [
  { theme: 'dark', htmlClass: /\bdark\b/, captureMore: captureReview },
  { theme: 'light', htmlClass: /^(?!.*\bdark\b)/, captureMore: captureSettings },
] as const) {
  test.describe(`${theme} PR screenshots`, () => {
    test.use({ screenshotTheme: theme });

    test('captures the fixed mobile household and expense states', async ({ page }) => {
      await page.goto('/');
      const html = page.locator('html');
      await expect(html).toHaveClass(htmlClass);
      await expect(html).not.toHaveClass(/theme-transitioning/);
      await expect(page.getByRole('heading', { name: 'Groceries', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Leisure', exact: true })).toBeVisible();
      await expect(page.locator('#balance-header')).toContainText('4,937');
      await expect(page.getByRole('button', { name: 'Add transaction', exact: true })).toBeVisible();
      await capture(page, `mobile-dashboard-${theme}.png`);

      await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
      const form = page.getByRole('dialog', { name: 'Manual entry', exact: true });
      const amount = form.getByLabel('Amount', { exact: true });
      const vendor = form.getByRole('combobox', { name: 'Vendor' });
      const confirm = form.getByRole('button', { name: 'Confirm Entry', exact: true });
      await expect(amount).toBeFocused();
      await amount.fill('12.34');
      await amount.press('Enter');
      await expect(vendor).toBeFocused();
      await vendor.fill('Corner Store');
      await vendor.press('Enter');
      await form.getByRole('button', { name: 'Groceries', exact: true }).click();
      await expect(amount).toHaveValue('12.34');
      await expect(vendor).toHaveValue('Corner Store');
      await expect(confirm).toBeEnabled();
      await capture(page, `mobile-manual-filled-${theme}.png`);

      await form.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(form).toBeHidden();
      await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
      await expect(amount).toBeFocused();
      await amount.fill('0');
      await amount.press('Enter');
      await expect(form.getByText('Enter an amount greater than zero, with up to two decimal places.', { exact: true })).toBeVisible();
      await expect(confirm).toBeDisabled();
      await expect(vendor).toBeDisabled();
      await capture(page, `mobile-manual-invalid-${theme}.png`);
      await form.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(form).toBeHidden();

      await captureMore(page);
    });
  });
}
