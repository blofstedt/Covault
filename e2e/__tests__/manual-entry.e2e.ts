import { z } from 'zod';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';

function required<Value>(value: Value | null | undefined, name: string): Value {
  if (value === null || value === undefined) throw new Error(`${name} is required`);
  return value;
}

const testSettingsSchema = z.array(z.object({ theme_selected: z.string() }).passthrough());

for (const viewport of [
  { width: 320, height: 568, theme: 'dark', surfaceColor: 'rgb(15, 23, 42)' },
  { width: 393, height: 851, theme: 'dark', surfaceColor: 'rgb(15, 23, 42)' },
  { width: 412, height: 400, theme: 'dark', surfaceColor: 'rgb(15, 23, 42)' },
  { width: 393, height: 851, theme: 'light', surfaceColor: 'rgb(255, 255, 255)' },
]) {
  test(`${viewport.theme} manual entry stays usable at ${viewport.width}x${viewport.height}`, async ({ page, signedInVault }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.route('**/mock-supabase/rest/v1/settings?**', async route => {
      const response = await route.fetch();
      const rows = testSettingsSchema.parse(await response.json());
      await route.fulfill({ response, json: rows.map(row => ({ ...row, theme_selected: viewport.theme })) });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Manual entry', exact: true });
    await expect(dialog).toHaveCSS('background-color', viewport.surfaceColor);
    const amount = dialog.getByLabel('Amount', { exact: true });
    const vendor = dialog.getByRole('combobox', { name: 'Vendor' });
    await expect(amount).toBeFocused();
    await expect(vendor).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();

    await amount.pressSequentially('1234.56');
    await page.screenshot({ path: testInfo.outputPath('manual-entry-amount.png') });
    await amount.press('Enter');
    await expect(vendor).toBeFocused();
    await vendor.fill(`Corner Store ${signedInVault.userId.slice(0, 8)}`);
    await vendor.press('Enter');
    const food = dialog.getByRole('button', { name: 'Food', exact: true });
    await expect(dialog.getByRole('button', { name: 'Housing', exact: true })).toBeFocused();
    await food.click();

    const confirm = dialog.getByRole('button', { name: 'Confirm Entry' });
    await expect(confirm).toBeEnabled();
    const monthly = dialog.getByRole('button', { name: 'Monthly', exact: true });
    await monthly.scrollIntoViewIfNeeded();
    await monthly.tap();
    await expect(monthly).toHaveAttribute('aria-pressed', 'true');
    await expect(monthly).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('heading', { name: 'Manual Entry', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(confirm).toBeInViewport({ ratio: 1 });
    const bounds = required(await dialog.boundingBox(), 'Manual entry bounds');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const saveBounds = required(await confirm.boundingBox(), 'Confirm Entry bounds');
    expect(saveBounds.height).toBeGreaterThanOrEqual(44);
    expect(saveBounds.y + saveBounds.height).toBeLessThanOrEqual(viewport.height);
    const recurrenceBounds = required(await monthly.boundingBox(), 'Monthly recurrence bounds');
    expect(recurrenceBounds.y + recurrenceBounds.height).toBeLessThanOrEqual(saveBounds.y);
    await page.screenshot({ path: testInfo.outputPath('manual-entry.png') });
  });
}

test('manual entry rejects a text paste and sends the corrected cents to saving', async ({ page, context, baseURL, signedInVault }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: required(baseURL, 'Local base URL') });
  await page.route('**/mock-supabase/rest/v1/transactions', async route => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const row = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: [row] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Manual entry', exact: true });
  const amount = dialog.getByLabel('Amount', { exact: true });
  await page.evaluate(() => navigator.clipboard.writeText('12abc'));
  await amount.press('ControlOrMeta+V');
  await expect(amount).toHaveValue('');
  await expect(dialog.getByText('Paste an amount only, with up to two decimal places.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();

  await page.evaluate(() => navigator.clipboard.writeText('$1,234.56'));
  await amount.press('ControlOrMeta+V');
  await expect(amount).toHaveValue('1,234.56');
  await dialog.getByRole('combobox', { name: 'Vendor' }).fill('Corner Store');
  await dialog.getByRole('button', { name: 'Food', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Confirm Entry' })).toBeEnabled();

  await amount.press('ControlOrMeta+A');
  await page.evaluate(() => navigator.clipboard.writeText('-12'));
  await amount.press('ControlOrMeta+V');
  await expect(amount).toHaveValue('1,234.56');
  await amount.blur();
  await expect(dialog.getByText('Paste an amount only, with up to two decimal places.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Confirm Entry' })).toBeDisabled();

  await amount.press('ControlOrMeta+A');
  await page.evaluate(() => navigator.clipboard.writeText('$1,234.56'));
  await amount.press('ControlOrMeta+V');
  await expect(dialog.getByRole('button', { name: 'Confirm Entry' })).toBeEnabled();
  const saving = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/rest/v1/transactions'));
  await dialog.getByRole('button', { name: 'Confirm Entry' }).click();
  const request = await saving;
  expect(request.postDataJSON()).toMatchObject({
    amount: 1234.56, vendor: 'Corner Store', user_id: signedInVault.userId,
    budget: 'Food', type: 'Manual', recur: 'One-time',
  });
  await expect(dialog).toBeHidden();
});

interface AmountInsertion {
  page: Page;
  amount: Locator;
  value: string;
}

test('manual entry accepts a decimal comma and pasted replacement cents', async ({ page, context, baseURL, signedInVault }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: required(baseURL, 'Local base URL') });
  await page.route('**/mock-supabase/rest/v1/transactions', async route => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 201, json: [route.request().postDataJSON()] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Manual entry', exact: true });
  const amount = dialog.getByLabel('Amount', { exact: true });
  await amount.pressSequentially('1234,56');
  await expect(amount).toHaveValue('1,234.56');
  await expect(amount).toHaveAttribute('aria-invalid', 'false');

  await amount.press('ControlOrMeta+A');
  await amount.press('ArrowRight');
  await amount.press('Shift+ArrowLeft');
  await amount.press('Shift+ArrowLeft');
  await page.evaluate(() => navigator.clipboard.writeText('00'));
  await amount.press('ControlOrMeta+V');
  await expect(amount).toHaveValue('1,234.00');
  await amount.press('Enter');
  const vendor = dialog.getByRole('combobox', { name: 'Vendor' });
  await expect(vendor).toBeFocused();
  await vendor.fill('Edited Corner Store');
  await dialog.getByRole('button', { name: 'Food', exact: true }).click();
  const saving = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/rest/v1/transactions'));
  await dialog.getByRole('button', { name: 'Confirm Entry' }).click();
  const request = await saving;
  expect(request.postDataJSON()).toMatchObject({
    amount: 1234, vendor: 'Edited Corner Store', user_id: signedInVault.userId,
    budget: 'Food', type: 'Manual', recur: 'One-time',
  });
  await expect(dialog).toBeHidden();
});

for (const insertion of [
  { name: 'keyboard', insert: async ({ amount, value }: AmountInsertion) => { await amount.pressSequentially(value); } },
  { name: 'text insertion', insert: async ({ page, value }: AmountInsertion) => { await page.keyboard.insertText(value); } },
]) {
  for (const invalidAmount of ['12abc', '1e3', '-12']) {
    test(`manual entry explains rejected ${insertion.name} ${invalidAmount} and saves only the corrected amount`, async ({ page, signedInVault }, testInfo) => {
      await page.route('**/mock-supabase/rest/v1/transactions', async route => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        await route.fulfill({ status: 201, json: [route.request().postDataJSON()] });
      });
      await page.goto('/');
      await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Manual entry', exact: true });
      const amount = dialog.getByLabel('Amount', { exact: true });
      const confirm = dialog.getByRole('button', { name: 'Confirm Entry' });
      await expect(amount).toBeFocused();
      await insertion.insert({ page, amount, value: invalidAmount });
      await expect(amount).toHaveAttribute('aria-invalid', 'true');
      await amount.blur();
      await expect(amount).toHaveAttribute('aria-invalid', 'true');
      await expect(confirm).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath('rejected-text.png') });

      await amount.fill('12.34');
      await expect(amount).toHaveValue('12.34');
      await expect(amount).toHaveAttribute('aria-invalid', 'false');
      await dialog.getByRole('combobox', { name: 'Vendor' }).fill('Corrected Corner Store');
      await dialog.getByRole('button', { name: 'Food', exact: true }).click();
      await expect(confirm).toBeEnabled();

      await amount.focus();
      await amount.press('ControlOrMeta+A');
      await amount.press('ArrowRight');
      await insertion.insert({ page, amount, value: '9' });
      await expect(amount).toHaveAttribute('aria-invalid', 'true');
      await expect(confirm).toBeDisabled();
      await amount.blur();
      await expect(confirm).toBeDisabled();

      await amount.fill('12.34');
      await expect(confirm).toBeEnabled();
      const saving = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/rest/v1/transactions'));
      await confirm.click();
      const request = await saving;
      expect(request.postDataJSON()).toMatchObject({
        amount: 12.34, vendor: 'Corrected Corner Store', user_id: signedInVault.userId,
        budget: 'Food', type: 'Manual', recur: 'One-time',
      });
      await expect(dialog).toBeHidden();
    });
  }
}
