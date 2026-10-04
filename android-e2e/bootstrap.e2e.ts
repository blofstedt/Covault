import { test, expect } from '@playwright/test';

test('the isolated app saves an expense and reads it again after restarting', async ({ page, context, baseURL }) => {
  const outside: string[] = [];
  if (!baseURL) throw new Error('The test server needs a local URL.');
  const localOrigin = new URL(baseURL).origin;
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === localOrigin) await route.continue();
    else { outside.push(route.request().url()); await route.abort(); }
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add transaction', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add transaction', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Manual entry', exact: true });
  await dialog.getByLabel('Amount', { exact: true }).fill('12.34');
  await dialog.getByRole('combobox', { name: 'Vendor' }).fill('Android Corner Store');
  await dialog.getByRole('button', { name: 'Groceries', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirm Entry', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Find entry...', exact: true }).click();
  await page.getByPlaceholder('Find entry...').fill('Android Corner Store');
  await expect(page.getByText('Android Corner Store', { exact: true })).toBeVisible();
  expect(outside, 'The test build must keep account data and startup traffic local').toEqual([]);
});
