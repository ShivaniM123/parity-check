import { collectMediaFromCssom, autoScroll } from './extract.js';

const UNIT = { px: 1, em: 16, rem: 16 };

/**
 * Turns one media condition into the viewport widths at which styles change.
 * min-width: 768px -> 768, max-width: 767px -> 768, width >= 900px -> 900, width < 600px -> 600
 */
export function boundariesFromCondition(condition) {
  const out = [];
  const num = (v, u) => parseFloat(v) * (UNIT[u] || 1);
  const c = condition.toLowerCase();
  let m;
  const minRe = /min-width\s*:\s*([\d.]+)(px|em|rem)/g;
  const maxRe = /max-width\s*:\s*([\d.]+)(px|em|rem)/g;
  const rangeRe = /(?:^|[(\s])width\s*(>=|<=|>|<)\s*([\d.]+)(px|em|rem)/g;
  const revRe = /([\d.]+)(px|em|rem)\s*(>=|<=|>|<)\s*width/g;
  // eslint-disable-next-line no-cond-assign
  while ((m = minRe.exec(c))) out.push(Math.round(num(m[1], m[2])));
  // eslint-disable-next-line no-cond-assign
  while ((m = maxRe.exec(c))) out.push(Math.floor(num(m[1], m[2])) + 1);
  // eslint-disable-next-line no-cond-assign
  while ((m = rangeRe.exec(c))) {
    const v = num(m[2], m[3]);
    out.push(m[1] === '>=' || m[1] === '<' ? Math.round(v) : Math.floor(v) + 1);
  }
  // eslint-disable-next-line no-cond-assign
  while ((m = revRe.exec(c))) {
    const v = num(m[1], m[2]);
    // "600px <= width" == "width >= 600px"
    out.push(m[3] === '<=' || m[3] === '>' ? Math.round(v) : Math.floor(v) + 1);
  }
  return out.filter((v) => v >= 280 && v <= 2560);
}

/**
 * Counts boundaries and merges ones within 2px of each other (767/768 style off-by-ones).
 */
export function clusterBoundaries(values) {
  const counts = new Map();
  values.forEach((v) => counts.set(v, (counts.get(v) || 0) + 1));
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const clusters = [];
  sorted.forEach(([px, count]) => {
    const near = clusters.find((cl) => Math.abs(cl.px - px) <= 2);
    if (near) near.count += count;
    else clusters.push({ px, count });
  });
  return clusters.sort((a, b) => a.px - b.px);
}

/**
 * Picks the breakpoints that matter: the most used ones, capped at 6.
 */
export function suggestBreakpoints(clusters) {
  if (!clusters.length) return [];
  const total = clusters.reduce((s, c) => s + c.count, 0);
  const significant = clusters
    .filter((c) => c.count >= 2 || clusters.length <= 3)
    .filter((c) => c.count / total >= 0.03 || clusters.length <= 6)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  return significant.map((c) => c.px).sort((a, b) => a - b);
}

/**
 * Viewport widths to test: exactly the chosen breakpoints, nothing added.
 */
export function testWidths(breakpoints) {
  return [...new Set(breakpoints)].filter((w) => w >= 280).sort((a, b) => a - b);
}

/**
 * Loads a page and detects its breakpoints from every stylesheet it uses,
 * including cross-origin ones (parsed from the network response).
 */
export async function detectBreakpoints(browser, url, { timeout = 60000 } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  const cssText = new Map();
  page.on('response', async (res) => {
    try {
      if (res.request().resourceType() === 'stylesheet' && res.ok()) {
        cssText.set(res.url(), await res.text());
      }
    } catch (e) { /* body unavailable */ }
  });
  try {
    await page.goto(url, { waitUntil: 'load', timeout });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.evaluate(autoScroll, { maxHeight: 8000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const { conditions, unreadable, sheetCount } = await page.evaluate(collectMediaFromCssom);
    unreadable.forEach((href) => {
      const text = cssText.get(href);
      if (!text) return;
      const re = /@media([^{]+)\{/g;
      let m;
      // eslint-disable-next-line no-cond-assign
      while ((m = re.exec(text))) conditions.push(m[1]);
    });
    const values = conditions.flatMap(boundariesFromCondition);
    const clusters = clusterBoundaries(values);
    return {
      url,
      clusters,
      suggested: suggestBreakpoints(clusters),
      mediaRules: conditions.length,
      stylesheets: sheetCount,
    };
  } finally {
    await context.close();
  }
}
