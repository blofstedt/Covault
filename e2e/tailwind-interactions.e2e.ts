import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

test.use({ reducedMotion: 'no-preference' });

function requireLabel(label: string | null): string {
  if (!label) throw new Error('The current month needs an accessible name.');
  return label;
}

async function settleEntrance(control: Locator) {
  await control.evaluate(async element => {
    const animations = new Set<Animation>();
    for (let parent: Element | null = element; parent; parent = parent.parentElement) {
      for (const animation of parent.getAnimations()) {
        if (animation.effect?.getTiming().iterations !== Infinity) animations.add(animation);
      }
    }
    await Promise.all([...animations].map(animation => animation.finished.catch(() => {})));
  });
}

/** A held pointer exposes the mobile layout's real press animation before release. */
async function pressWithFeedback(page: Page, control: Locator, scale: number, duration: number) {
  await expect(control).toBeVisible();
  await control.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => !document.documentElement.classList.contains('theme-transitioning'));
  await settleEntrance(control);
  const bounds = await control.boundingBox();
  if (!bounds) throw new Error('The touch target has no rendered bounds.');
  const feedback = await control.evaluateHandle(element => {
    const durations: number[] = [];
    const observe = (event: Event) => {
      if (!(event instanceof TransitionEvent) || event.target !== element ||
          !['scale', 'transform'].includes(event.propertyName)) return;
      for (const animation of element.getAnimations()) {
        if (animation instanceof CSSTransition && animation.transitionProperty === event.propertyName) {
          const timing = animation.effect?.getTiming().duration;
          if (typeof timing === 'number') durations.push(timing);
        }
      }
    };
    element.addEventListener('transitionrun', observe);
    return { durations, dispose: () => element.removeEventListener('transitionrun', observe) };
  });
  let released = false;
  try {
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await expect.poll(async () => (await feedback.jsonValue()).durations).toContain(duration);
    await expect.poll(async () => (await control.boundingBox())?.width).toBeCloseTo(bounds.width * scale, 1);
    await page.mouse.up();
    released = true;
  } finally {
    if (!released) await page.mouse.up();
    await feedback.evaluate(record => record.dispose());
    await feedback.dispose();
  }
}

test('mobile month, budget and transaction controls keep their press feedback and motion clocks', async ({ page, signedInVault }) => {
  await page.goto('/');
  const months = page.getByRole('group', { name: 'Choose a month' });
  const currentMonth = months.locator('button[aria-pressed="true"]');
  const currentLabel = requireLabel(await currentMonth.getAttribute('aria-label'));
  const earlierMonth = months.getByRole('button').first();
  await pressWithFeedback(page, earlierMonth, 0.97, 320);
  await expect(earlierMonth).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Back to now' })).toBeVisible();
  await months.getByRole('button', { name: currentLabel, exact: true }).tap();
  await expect(months.getByRole('button', { name: currentLabel, exact: true })).toHaveAttribute('aria-pressed', 'true');

  // The budget summary is the existing heading's nearest tap target, not a button.
  const budget = page.getByRole('heading', { name: 'Food', exact: true })
    .locator('xpath=ancestor::div[contains(@class, "cursor-pointer")][1]');
  await pressWithFeedback(page, budget, 0.99, 320);
  const transaction = page.getByRole('button', { name: `Transaction: ${signedInVault.vendor},`, exact: false });
  await expect(transaction).toBeVisible();
  await pressWithFeedback(page, transaction, 0.98, 200);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Vendor' })).toHaveValue(signedInVault.vendor);
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('14.25');
});

test('review category and rename controls stay usable on a touch-only phone', async ({ page, signedInVault }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(userId => {
    localStorage.setItem(`covault_first_capture_seen_v1:${userId}`, '1');
    localStorage.setItem('covault_settings', JSON.stringify({ notificationsEnabled: true }));
  }, signedInVault.userId);
  await page.route('**/mock-supabase/rest/v1/transactions?**', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify([{
      id: 'captured-touch-row', user_id: signedInVault.userId, vendor: 'Unmatched Touch Store', amount: 14.25,
      date: new Date().toISOString().slice(0, 10), created_at: new Date().toISOString(),
      budget: 'Other', recurrence: 'One-time', type: 'Automatic', caught_cleared: false,
    }]) });
  });
  await page.route('**/mock-supabase/rest/v1/overrides?**', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify([{
      id: 'known-touch-rule', user_id: signedInVault.userId, proper_name: 'Known Touch Store',
      match_key: 'knowntouchstore', match_type: 'exact', category_id: 'Food',
    }]) });
  });
  await page.route('**/mock-supabase/rest/v1/overrides', async route => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify([{
      id: 'groceries-touch-rule', user_id: signedInVault.userId, proper_name: 'Known Touch Store',
      match_key: 'knowntouchstore', match_type: 'exact', category_id: 'Groceries',
    }]) });
  });
  await page.route('**/mock-supabase/rest/v1/notification_rules?**', async route => {
    await route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open review' }).tap();
  await expect(page.getByText('Unmatched Touch Store', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'More actions for Unmatched Touch Store' }).tap();
  await page.getByRole('button', { name: 'Change category', exact: false }).tap();
  const categories = page.getByRole('dialog', { name: 'Choose a category' });
  await expect(categories).toBeVisible();
  await expect(categories.getByRole('button', { name: 'Food', exact: true })).toBeEnabled();
  await categories.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(categories).toBeHidden();
  await page.getByRole('button', { name: 'More actions for Unmatched Touch Store' }).tap();
  await page.getByRole('button', { name: 'Rename vendor', exact: false }).tap();
  const rename = page.getByRole('dialog', { name: 'Rename merchant' });
  await expect(rename).toBeVisible();
  await rename.getByRole('textbox', { name: 'Merchant name' }).fill('Corrected Touch Store');
  await expect(rename.getByRole('textbox', { name: 'Merchant name' })).toHaveValue('Corrected Touch Store');
  await rename.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(rename).toBeHidden();
  await expect(page.getByText('Unmatched Touch Store', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: /Known Touch Store.*Food/ }).tap();
  const changeCategory = page.getByRole('button', { name: 'Change Category', exact: true });
  await changeCategory.tap();
  await expect(categories).toBeVisible();
  const choice = categories.getByRole('button', { name: 'Groceries', exact: true });
  await expect(choice).toBeVisible();
  await expect(choice).toBeEnabled();
  await settleEntrance(categories);
  await expect(choice).toBeInViewport({ ratio: 1 });
  await expect(categories.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath('learned-rule-category-chooser.png') });
  await categories.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(categories).toBeHidden();
  await expect(page.getByRole('button', { name: /Known Touch Store.*Food/ })).toBeVisible();
  await page.getByRole('button', { name: 'Edit Name', exact: true }).tap();
  const properName = page.getByRole('textbox');
  await expect(properName).toHaveValue('Known Touch Store');
  await properName.press('Escape');
  await expect(properName).toBeHidden();

  await changeCategory.tap();
  await expect(categories).toBeVisible();
  const savedRule = page.waitForRequest(request => request.method() === 'POST' &&
    new URL(request.url()).pathname === '/mock-supabase/rest/v1/overrides');
  await choice.tap();
  expect((await savedRule).postDataJSON()).toMatchObject({
    category_id: 'Groceries', proper_name: 'Known Touch Store',
  });
  await expect(categories).toBeHidden();
  await expect(page.getByRole('button', { name: /Known Touch Store.*Groceries/ })).toBeVisible();
});

test('an amount field keeps a visible focus cue in forced colors', async ({ page, signedInVault }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Find entry...' })).toBeVisible();
  await page.getByRole('button', { name: 'Add transaction' }).tap();
  const amount = page.getByLabel('Amount', { exact: true });
  await amount.focus();
  await expect(amount).toBeFocused();
  const cue = await amount.evaluate(element => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor };
  });
  expect(cue.style).toBe('solid');
  expect(cue.width).toBe('2px');
  expect(cue.color).not.toBe('rgba(0, 0, 0, 0)');
  await amount.fill('12.34');
  await expect(amount).toHaveValue('12.34');
  await expect(page.getByRole('combobox', { name: 'Vendor' })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Vendor' }).fill(signedInVault.vendor);
  await expect(page.getByRole('combobox', { name: 'Vendor' })).toHaveValue(signedInVault.vendor);
});
