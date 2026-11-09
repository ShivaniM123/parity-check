import { autoScroll, extractPage } from './extract.js';

const FREEZE_CSS = `
*, *::before, *::after { transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }
`;

/**
 * Renders one page at one viewport width: screenshot + element fingerprint.
 * One context per capture, closed right away to keep memory low.
 */
export async function capturePage(browser, url, {
  width, height = 900, maxHeight = 12000, hideSelectors = [], waitMs = 800, timeout = 60000,
}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && consoleErrors.length < 20) consoleErrors.push(msg.text().slice(0, 300));
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && failedRequests.length < 30) failedRequests.push({ url: res.url(), status: res.status() });
  });
  page.on('requestfailed', (req) => {
    if (failedRequests.length < 30) failedRequests.push({ url: req.url(), status: req.failure()?.errorText || 'failed' });
  });
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.evaluate(autoScroll, { maxHeight }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
    await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});
    await page.waitForTimeout(waitMs);
    const data = await page.evaluate(extractPage, { hideSelectors });
    const shotHeight = Math.max(1, Math.min(data.height, maxHeight));
    const png = await page.screenshot({
      fullPage: true,
      clip: {
        x: 0, y: 0, width, height: shotHeight,
      },
      animations: 'disabled',
      timeout,
    });
    data.status = response ? response.status() : 0;
    data.consoleErrors = consoleErrors;
    data.failedRequests = failedRequests;
    data.truncated = data.height > maxHeight;
    return { data, png };
  } finally {
    await context.close();
  }
}
