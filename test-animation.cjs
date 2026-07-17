const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 400, height: 800 } });
  const page = await context.newPage();
  await page.goto('http://localhost:8765/test-budget.html');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  // Sample the wrapper height over time during the expand animation
  const result = await page.evaluate(async () => {
    const txList = document.querySelector('.overflow-y-auto');
    if (!txList) return { error: 'tx list not found' };
    const rect = txList.getBoundingClientRect();
    return {
      clientHeight: txList.clientHeight,
      scrollHeight: txList.scrollHeight,
      rect: { top: rect.top, height: rect.height },
    };
  });
  console.log('Result:', JSON.stringify(result, null, 2));

  await browser.close();
})();
