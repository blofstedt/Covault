import { test, expect } from '../fixtures';

test('rejected letters recover through zero validation and keyboard progression', async ({ page, signedInVault }) => {
  await page.route('**/mock-supabase/rest/v1/transactions', async route => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 201, json: [route.request().postDataJSON()] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Add transaction', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Manual entry', exact: true });
  const amount = dialog.getByLabel('Amount', { exact: true });
  const vendor = dialog.getByRole('combobox', { name: 'Vendor' });
  const confirm = dialog.getByRole('button', { name: 'Confirm Entry' });

  await expect(amount).toBeFocused();
  await page.keyboard.insertText('abc');
  await amount.press('Enter');
  await expect(amount).toHaveValue('');
  await expect(amount).toBeFocused();
  await expect(dialog.getByText('Enter numbers only, with up to two decimal places.', { exact: true })).toBeVisible();
  await expect(vendor).toBeDisabled();
  await expect(confirm).toBeDisabled();

  // The letters were rejected, so these Backspaces act on an empty field.
  await amount.press('Backspace');
  await amount.press('Backspace');
  await amount.press('Backspace');
  await page.keyboard.insertText('0');
  await amount.press('Enter');
  await expect(amount).toHaveValue('0');
  await expect(amount).toBeFocused();
  await expect(dialog.getByText('Enter an amount greater than zero, with up to two decimal places.', { exact: true })).toBeVisible();
  await expect(vendor).toBeDisabled();
  await expect(confirm).toBeDisabled();

  await amount.press('Backspace');
  await page.keyboard.insertText('12.34');
  await amount.press('Enter');
  await expect(amount).toHaveValue('12.34');
  await expect(amount).toHaveAttribute('aria-invalid', 'false');
  await expect(vendor).toBeFocused();
  await page.keyboard.insertText('Android Corner Store');
  await vendor.press('Enter');
  await expect(dialog.getByRole('button', { name: 'Housing', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Food', exact: true }).tap();
  await expect(confirm).toBeEnabled();

  const saving = page.waitForRequest(request => request.method() === 'POST'
    && request.url().endsWith('/rest/v1/transactions'));
  await confirm.tap();
  const request = await saving;
  expect(request.postDataJSON()).toMatchObject({
    amount: 12.34, vendor: 'Android Corner Store', user_id: signedInVault.userId,
    budget: 'Food', type: 'Manual', recur: 'One-time',
  });
  await expect(dialog).toBeHidden();
});
