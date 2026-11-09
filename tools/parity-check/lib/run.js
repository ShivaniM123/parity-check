import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { capturePage } from './capture.js';
import { detectBreakpoints } from './breakpoints.js';
import { diffScreenshots } from './diff.js';
import { matchElements } from './match.js';
import { analyzeWidth } from './rules.js';
import { buildFixes } from './fixes.js';

const pageMeta = (d) => ({
  title: d.title,
  url: d.url,
  status: d.status,
  height: d.height,
  overflow: d.overflow,
  truncated: d.truncated,
  isEds: d.isEds,
  elements: d.elements.length,
  consoleErrors: d.consoleErrors.slice(0, 5),
});

/**
 * Runs a full comparison and writes reports/<id>/report.json plus screenshots.
 * `log(message, progress)` streams progress to the UI.
 */
export async function runComparison(job, { reportsDir, repoRoot, log }) {
  const {
    id, original, migrated, widths, breakpoints, options = {},
  } = job;
  const dir = join(reportsDir, id);
  await mkdir(dir, { recursive: true });
  const captureOpts = {
    maxHeight: options.maxHeight || 12000,
    hideSelectors: options.hideSelectors || [],
    waitMs: options.waitMs ?? 800,
  };
  const steps = widths.length * 3 + 2;
  let step = 0;
  const tick = (msg) => { step += 1; log(msg, Math.min(99, Math.round((step / steps) * 100))); };

  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--hide-scrollbars'] });
  const report = {
    id,
    created: new Date().toISOString(),
    original,
    migrated,
    widths,
    breakpoints,
    options: captureOpts,
    results: [],
  };
  try {
    tick('Detecting breakpoints on the migrated page');
    try {
      const det = await detectBreakpoints(browser, migrated);
      const near = (list, v) => list.some((x) => Math.abs(x - v) <= 2);
      const migBps = det.clusters.filter((c) => c.count >= 1).map((c) => c.px);
      report.migratedBreakpoints = det.suggested;
      report.breakpointMismatch = {
        missingInMigrated: breakpoints.filter((b) => !near(migBps, b)),
        extraInMigrated: det.suggested.filter((b) => !near(breakpoints, b)),
      };
    } catch (e) {
      log(`Could not read migrated breakpoints: ${e.message}`);
    }

    // one width at a time, one page at a time: keeps memory flat
    // eslint-disable-next-line no-restricted-syntax
    for (const width of widths) {
      tick(`${width}px · capturing original`);
      // eslint-disable-next-line no-await-in-loop
      const o = await capturePage(browser, original, { ...captureOpts, width });
      tick(`${width}px · capturing migrated`);
      // eslint-disable-next-line no-await-in-loop
      const m = await capturePage(browser, migrated, { ...captureOpts, width });
      tick(`${width}px · comparing`);
      const diff = diffScreenshots(o.png, m.png, { threshold: options.pixelThreshold ?? 0.1 });
      const match = matchElements(o.data.elements, m.data.elements, { origHeight: o.data.height, migHeight: m.data.height });
      const analysis = analyzeWidth({
        width, orig: o.data, mig: m.data, match, diff,
      });
      const shots = { o: `${width}-original.png`, m: `${width}-migrated.png`, d: `${width}-diff.png` };
      // eslint-disable-next-line no-await-in-loop
      await Promise.all([
        writeFile(join(dir, shots.o), o.png),
        writeFile(join(dir, shots.m), m.png),
        writeFile(join(dir, shots.d), diff.png),
      ]);
      report.results.push({
        width,
        score: analysis.score,
        stats: analysis.stats,
        issues: analysis.issues,
        regions: diff.regions,
        shots,
        page: { o: pageMeta(o.data), m: pageMeta(m.data) },
      });
      log(`${width}px · score ${analysis.score}, ${analysis.issues.length} issues`);
    }

    tick('Building fix recommendations');
    report.fixes = buildFixes(report.results, breakpoints, repoRoot);
    const all = report.results.flatMap((r) => r.issues);
    report.summary = {
      score: Math.round(report.results.reduce((s, r) => s + r.score, 0) / Math.max(1, report.results.length)),
      issues: all.length,
      high: all.filter((i) => i.severity === 'high').length,
      medium: all.filter((i) => i.severity === 'medium').length,
      low: all.filter((i) => i.severity === 'low').length,
    };
    await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 1));
    log('Done', 100);
    return report;
  } finally {
    await browser.close();
  }
}
