import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Site breakpoint range that contains a tested width: [lower, upper).
 */
function rangeOf(width, breakpoints) {
  const lower = Math.max(0, ...breakpoints.filter((b) => b <= width));
  const above = breakpoints.filter((b) => b > width);
  const upper = above.length ? Math.min(...above) : Infinity;
  return { lower, upper };
}

export function mediaFor(lower, upper) {
  if (lower <= 0 && upper === Infinity) return '';
  if (lower <= 0) return `@media (width < ${upper}px)`;
  if (upper === Infinity) return `@media (width >= ${lower}px)`;
  return `@media (${lower}px <= width < ${upper}px)`;
}

const line = (d) => `  ${d.prop}: ${d.value};${d.comment ? ` /* ${d.comment} */` : ''}`;

export function ruleCss(selector, decls, media) {
  const body = `${selector} {\n${decls.map(line).join('\n')}\n}`;
  if (!media) return body;
  return `${media} {\n${body.split('\n').map((l) => `  ${l}`).join('\n')}\n}`;
}

/**
 * Merges the per-width fixes into one CSS proposal per file. A fix only gets a
 * media query when it is not needed at every tested width, and the query uses
 * the site's own breakpoints.
 */
export function buildFixes(widthResults, breakpoints, repoRoot) {
  const widths = widthResults.map((w) => w.width).sort((a, b) => a - b);
  const bps = [...breakpoints].sort((a, b) => a - b);
  // file|selector|prop -> Map(width -> {decl, issueIds})
  const table = new Map();
  widthResults.forEach(({ width, issues }) => {
    issues.forEach((iss) => {
      const f = iss.fix;
      if (!f || !f.file || !f.selector || !f.decl?.length) return;
      f.decl.forEach((d) => {
        const key = `${f.file}|${f.selector}|${d.prop}`;
        if (!table.has(key)) table.set(key, new Map());
        const byWidth = table.get(key);
        if (!byWidth.has(width)) byWidth.set(width, { decl: d, ids: [] });
        byWidth.get(width).ids.push(iss.id);
      });
    });
  });

  // key -> list of { media, decl, ids, widths }
  const rules = [];
  const mediaByIssue = new Map();
  table.forEach((byWidth, key) => {
    const [file, selector] = key.split('|');
    // runs of consecutive tested widths with the same value
    const runs = [];
    widths.forEach((w, idx) => {
      const cell = byWidth.get(w);
      const last = runs[runs.length - 1];
      if (!cell) return;
      if (last && last.lastIdx === idx - 1 && last.decl.value === cell.decl.value) {
        last.widths.push(w);
        last.ids.push(...cell.ids);
        last.lastIdx = idx;
      } else {
        runs.push({
          decl: cell.decl, widths: [w], ids: [...cell.ids], lastIdx: idx,
        });
      }
    });
    runs.forEach((run) => {
      const first = run.widths[0];
      const last = run.widths[run.widths.length - 1];
      const coversAll = first === widths[0] && last === widths[widths.length - 1];
      const lower = coversAll || first === widths[0] ? 0 : rangeOf(first, bps).lower;
      const upper = coversAll || last === widths[widths.length - 1] ? Infinity : rangeOf(last, bps).upper;
      const media = mediaFor(lower, upper);
      rules.push({
        file, selector, media, lower, decl: run.decl, ids: run.ids, widths: run.widths,
      });
      run.ids.forEach((id) => {
        if (!mediaByIssue.has(id)) mediaByIssue.set(id, media);
      });
    });
  });

  // per issue: CSS snippet with the right media query
  widthResults.forEach(({ issues }) => {
    issues.forEach((iss) => {
      const f = iss.fix;
      if (!f) return;
      if (f.file && f.selector && f.decl?.length) {
        f.media = mediaByIssue.get(iss.id) || '';
        f.css = ruleCss(f.selector, f.decl, f.media);
      }
      if (f.file && repoRoot) f.exists = existsSync(join(repoRoot, f.file));
    });
  });

  // per file: base rules first, then media blocks in ascending order
  const files = new Map();
  rules.forEach((r) => {
    if (!files.has(r.file)) files.set(r.file, new Map());
    const byMedia = files.get(r.file);
    if (!byMedia.has(r.media)) byMedia.set(r.media, { lower: r.lower, selectors: new Map() });
    const sel = byMedia.get(r.media).selectors;
    if (!sel.has(r.selector)) sel.set(r.selector, { decls: new Map(), ids: new Set() });
    const entry = sel.get(r.selector);
    entry.decls.set(r.decl.prop, r.decl);
    r.ids.forEach((id) => entry.ids.add(id));
  });

  return [...files.entries()].map(([file, byMedia]) => {
    const blocks = [...byMedia.entries()]
      .sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[1].lower - b[1].lower)) // eslint-disable-line no-nested-ternary
      .map(([media, { selectors }]) => [...selectors.entries()]
        .map(([selector, { decls, ids }]) => `/* parity: ${[...ids].slice(0, 6).join(', ')}${ids.size > 6 ? ', …' : ''} */\n${ruleCss(selector, [...decls.values()], media)}`)
        .join('\n\n'));
    const issueIds = new Set(rules.filter((r) => r.file === file).flatMap((r) => r.ids));
    return {
      file,
      exists: repoRoot ? existsSync(join(repoRoot, file)) : null,
      issues: issueIds.size,
      css: blocks.join('\n\n'),
    };
  }).sort((a, b) => b.issues - a.issues);
}
