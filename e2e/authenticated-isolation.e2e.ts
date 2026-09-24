import { test, expect } from './fixtures';

for (const browserUser of ['first', 'second']) {
  test(`${browserUser} signed-in vault stays isolated`, async ({ page, request, baseURL, signedInVault }) => {
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'Find entry...' })).toBeVisible();
    await page.getByRole('button', { name: 'Find entry...' }).click();
    await page.getByPlaceholder('Find entry...').fill('Vault');
    await expect(page.getByText(signedInVault.vendor, { exact: true })).toBeVisible();
    await expect(page.getByText(signedInVault.rivalVendor, { exact: true })).toHaveCount(0);

    const forbidden = await request.get(
      `${baseURL}/mock-supabase/rest/v1/transactions?select=*&user_id=eq.${signedInVault.rivalId}`,
      { headers: { Authorization: `Bearer ${await page.evaluate(() => JSON.parse(localStorage.getItem('sb-127-auth-token') ?? '{}').access_token)}` } },
    );
    expect(forbidden.status()).toBe(403);
  });
}
