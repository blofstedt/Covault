import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ localOnly: void }>({
  localOnly: [async ({ context, baseURL }, use) => {
    const unexpected: string[] = [];
    if (!baseURL) throw new Error('Playwright needs a local base URL.');
    const localOrigin = new URL(baseURL).origin;

    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (new URL(url).origin === localOrigin) {
        await route.continue();
      } else if (url.startsWith('https://fonts.googleapis.com/')) {
        // The login behavior check does not need a network font.
        await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
      } else if (
        url.startsWith('https://huggingface.co/Xenova/flan-t5-small/') ||
        url.startsWith('https://cdn.jsdelivr.net/npm/@huggingface/transformers@')
      ) {
        // App startup warms the optional model. These checks exercise sign-in
        // only, so keep the model offline without hiding other network calls.
        await route.abort();
      } else {
        unexpected.push(url);
        await route.abort();
      }
    });

    await use();
    expect(unexpected, 'The browser suite must not contact outside services').toEqual([]);
  }, { auto: true }],
});

export { expect } from '@playwright/test';
