import { autoScroll, extractPage } from './extract.js';

const EMBED_FALLBACKS = 'blockquote.twitter-tweet:not(.twitter-tweet-rendered), blockquote.instagram-media:not(.instagram-media-rendered), blockquote.tiktok-embed:not(:has(iframe))';

const EMBED_SCRIPTS = 'script[src*="platform.twitter.com"], script[src*="instagram.com/embed"], script[src*="tiktok.com/embed"]';

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
    // Edge Delivery loads third-party scripts (donate tabs, chat, consent, analytics widgets)
    // about 3 s after load (scripts/delayed.js). Capture after that, or those widgets are
    // reported missing while they are just not loaded yet.
    await page.waitForFunction(() => performance.now() > 5000, null, { timeout: 8000, polling: 250 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    // social embeds render late (a provider script swaps the fallback for an iframe);
    // only worth waiting for when the provider script is actually on the page
    const pendingEmbeds = await page.evaluate(
      ([sel, scripts]) => !!document.querySelector(sel) && !!document.querySelector(scripts),
      [EMBED_FALLBACKS, EMBED_SCRIPTS],
    ).catch(() => false);
    if (pendingEmbeds) {
      await page.waitForFunction((sel) => !document.querySelector(sel), EMBED_FALLBACKS, { timeout: 6000, polling: 250 }).catch(() => {});
    }
    await page.addStyleTag({ content: FREEZE_CSS }).catch(() => {});
    await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});
    await page.waitForTimeout(waitMs);
    // screenshot first, then read the page: late widgets (a donate tab, chat bubble) that
    // appear in the screenshot are then in the data too, instead of showing in the picture
    // but being reported missing. Hidden elements are hidden for both.
    await page.evaluate((sels) => {
      const style = document.createElement('style');
      style.textContent = sels.map((s) => {
        try { document.querySelector(s); return `${s} { display: none !important; }`; } catch (e) { return ''; }
      }).join('\n');
      document.head.appendChild(style);
    }, hideSelectors).catch(() => {});
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => maxHeight);
    const png = await page.screenshot({
      fullPage: true,
      clip: {
        x: 0, y: 0, width, height: Math.max(1, Math.min(pageHeight, maxHeight)),
      },
      animations: 'disabled',
      timeout,
    });
    const data = await page.evaluate(extractPage, { hideSelectors });
    data.status = response ? response.status() : 0;
    data.consoleErrors = consoleErrors;
    data.failedRequests = failedRequests;
    data.truncated = data.height > maxHeight;
    return { data, png };
  } finally {
    await context.close();
  }
}
