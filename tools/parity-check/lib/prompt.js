/**
 * Turns a comparison into a self-contained prompt for AEM Coder: the pages,
 * the original's breakpoints and the open issues as plain facts (element,
 * property, original vs migrated value, widths). It carries no suggested CSS
 * or fix advice: the generated rules are often too specific or wrong for the
 * codebase, and AEM Coder fixes better from the facts and its own reading of
 * the blocks. Differences the reviewer approved are left out.
 */

const SEV = { high: 0, medium: 1, low: 2 };
const MAX_STYLE = 60;
const MAX_CONTENT = 25;
const CONTENT = new Set(['content', 'page']); // not about styling one element

const quote = (t) => (t ? ` (“${String(t).replace(/\s+/g, ' ').trim().slice(0, 50)}”)` : '');
const list = (ws) => `${ws.join(', ')}px`;

function pathOf(u) {
  try {
    const { pathname } = new URL(u);
    return pathname.replace(/\.html$/, '') || '/';
  } catch (e) {
    return '';
  }
}

/** The same difference on the same element at several widths → one entry. */
function group(issues) {
  const map = new Map();
  issues.forEach((i) => {
    const sel = i.m?.selector || i.o?.selector || '';
    const key = [sel, i.property || '', i.title.replace(/\d+(\.\d+)?/g, '#')].join('|');
    if (!map.has(key)) map.set(key, { ...i, sel, widths: [], values: [] });
    const g = map.get(key);
    if (!g.widths.includes(i.width)) g.widths.push(i.width);
    if (i.ov !== undefined || i.mv !== undefined) {
      const same = g.values.find((v) => v.ov === i.ov && v.mv === i.mv);
      if (same) same.widths.push(i.width);
      else g.values.push({ ov: i.ov, mv: i.mv, widths: [i.width] });
    }
    if (SEV[i.severity] < SEV[g.severity]) g.severity = i.severity;
  });
  return [...map.values()]
    .map((g) => ({ ...g, widths: g.widths.sort((a, b) => a - b) }))
    .sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.widths.length - a.widths.length);
}

function line(g, allWidths) {
  const where = (ws) => (ws.length === allWidths.length ? 'all widths' : list([...ws].sort((a, b) => a - b)));
  const prop = g.property || 'value';
  let values = '';
  if (g.values.length === 1) {
    const [v] = g.values;
    values = ` — ${prop}: original \`${v.ov ?? '–'}\`, migrated \`${v.mv ?? '–'}\` — at ${where(g.widths)}`;
  } else if (g.values.length > 1) {
    values = ` — ${prop}: ${g.values.map((v) => `original \`${v.ov ?? '–'}\`, migrated \`${v.mv ?? '–'}\` at ${where(v.widths)}`).join('; ')}`;
  } else {
    values = ` — at ${where(g.widths)}`;
  }
  const sel = g.sel ? ` — element \`${g.sel}\`` : '';
  const text = g.m?.text || g.o?.text;
  // the title often quotes the element text already
  return `- [${g.severity}] ${g.title}${text && !g.title.includes(text.slice(0, 20)) ? quote(text) : ''}${sel}${values}`;
}

function counts(all) {
  const c = (s) => all.filter((i) => i.severity === s).length;
  return `${all.length} open issue${all.length === 1 ? '' : 's'} (${c('high')} high, ${c('medium')} medium, ${c('low')} low)`;
}

function mismatchLine(mm) {
  if (!mm || !(mm.missingInMigrated?.length || mm.extraInMigrated?.length)) return null;
  return `- Breakpoints: ${mm.missingInMigrated?.length ? `the migrated CSS has no media query at ${list(mm.missingInMigrated)}` : ''}${mm.missingInMigrated?.length && mm.extraInMigrated?.length ? '; ' : ''}${mm.extraInMigrated?.length ? `it changes layout at ${list(mm.extraInMigrated)}` : ''}.`;
}

/** Open (not approved) issues of a report, grouped into styling and content entries. */
function openIssues(report, statuses = {}) {
  const approved = new Set(Object.keys(statuses).filter((k) => statuses[k] === 'ok'));
  const all = report.results.flatMap((r) => r.issues).filter((i) => !approved.has(i.id));
  return {
    all,
    approved: approved.size,
    widths: report.widths || report.results.map((r) => r.width),
    styling: group(all.filter((i) => !CONTENT.has(i.category))),
    content: group(all.filter((i) => CONTENT.has(i.category))),
  };
}

/** Styling entries under "### Block: …" headings, then content entries. */
function issueSections(out, styling, content, widths, {
  maxStyle = MAX_STYLE, maxContent = MAX_CONTENT, level = '##', fmt = (g) => line(g, widths),
} = {}) {
  if (styling.length) {
    out.push('');
    out.push(`${level} Styling and layout issues`);
    // grouped by where the element lives on the migrated page
    const byBlock = new Map();
    styling.slice(0, maxStyle).forEach((g) => {
      const where = g.m?.block ? `Block: ${g.m.block}` : 'Page and default content';
      if (!byBlock.has(where)) byBlock.set(where, []);
      byBlock.get(where).push(g);
    });
    byBlock.forEach((items, where) => {
      out.push('');
      out.push(`${level}# ${where}`);
      items.forEach((g) => out.push(fmt(g)));
    });
    if (styling.length > maxStyle) out.push(`\n…and ${styling.length - maxStyle} more low-impact issues (ask me for the full list).`);
  }
  if (content.length) {
    out.push('');
    out.push(`${level} Content and page issues`);
    content.slice(0, maxContent).forEach((g) => out.push(fmt(g)));
    if (content.length > maxContent) out.push(`…and ${content.length - maxContent} more (ask me for the full list).`);
  }
}

const RULES = [
  '- Start with high severity. Read the affected blocks and the page markup before you change anything.',
  '- Keep CSS scoped to its block. Don\'t edit `scripts/aem.js`.',
  '- Layout must change at the original site\'s breakpoints listed above.',
];

export function buildFixPrompt(report, statuses = {}) {
  const {
    all, approved, widths, styling, content,
  } = openIssues(report, statuses);
  const path = pathOf(report.migrated);

  const out = [];
  out.push('Fix the visual parity issues between the original page and its migrated AEM Edge Delivery Services page in this repository, so the migrated page looks like the original at every tested width. The original values below are the target.');
  out.push('');
  out.push(`- Original page: ${report.original}`);
  out.push(`- Migrated page: ${report.migrated}${path ? ` (local preview path \`${path}\`)` : ''}`);
  out.push(`- Original site breakpoints: ${report.breakpoints?.length ? list(report.breakpoints) : 'none detected'}`);
  out.push(`- Tested widths: ${list(widths)}`);
  out.push(`- Parity score: ${report.summary?.score ?? '–'}/100 · ${counts(all)}${approved ? ` · ${approved} difference${approved === 1 ? '' : 's'} approved as intended and left out` : ''}`);
  const mm = mismatchLine(report.breakpointMismatch);
  if (mm) out.push(mm);
  out.push('');
  out.push('Rules:');
  out.push(...RULES);
  out.push('- Check each change in the preview at the affected widths.');
  out.push('- When you are done, list what you changed and anything you couldn\'t fix, so I can re-run the parity check.');

  if (!all.length) {
    out.push('');
    out.push('There are no open issues: every difference was approved. Nothing to fix.');
    return `${out.join('\n')}\n`;
  }
  issueSections(out, styling, content, widths);
  return `${out.join('\n')}\n`;
}

const MAX_SHARED = 40;
const pagesList = (paths) => (paths.length > 6 ? `${paths.slice(0, 6).join(', ')} and ${paths.length - 6} more` : paths.join(', '));

/**
 * One prompt for several compared pages. A styling difference that shows up
 * the same way on several pages (same block, property and values) is listed
 * once under "Shared by several pages", with the pages it is on; everything
 * else is listed per page.
 */
export function buildBatchPrompt(entries) {
  const pages = entries.map(({ report, statuses }, idx) => ({
    report, idx, path: pathOf(report.migrated) || report.migrated, ...openIssues(report, statuses),
  }));
  const sig = (g) => [g.m?.block || '', g.property || '', g.title.replace(/\d+(\.\d+)?/g, '#'), JSON.stringify(g.values.map((v) => [v.ov, v.mv]))].join('|');
  const seen = new Map();
  pages.forEach((p) => p.styling.forEach((g) => {
    const k = sig(g);
    if (!seen.has(k)) seen.set(k, { g, pages: [] });
    if (!seen.get(k).pages.includes(p)) seen.get(k).pages.push(p);
  }));
  const shared = [...seen.values()].filter((s) => s.pages.length > 1)
    .sort((a, b) => b.pages.length - a.pages.length || SEV[a.g.severity] - SEV[b.g.severity]);
  const sharedKeys = new Set(shared.map((s) => sig(s.g)));
  const all = pages.flatMap((p) => p.all);
  const bps = [...new Set(pages.map((p) => list(p.report.breakpoints || [])))];
  const allWidths = [...new Set(pages.flatMap((p) => p.widths))].sort((a, b) => a - b);

  const out = [];
  out.push(`Fix the visual parity issues between ${pages.length} original pages and their migrated AEM Edge Delivery Services pages in this repository, so each migrated page looks like its original at every tested width. The original values below are the target.`);
  out.push('');
  out.push(`- Pages: ${pages.length} · ${counts(all)}`);
  if (bps.length === 1) out.push(`- Original site breakpoints: ${pages[0].report.breakpoints?.length ? bps[0] : 'none detected'}`);
  else out.push('- Original site breakpoints: listed per page below');
  out.push(`- Tested widths: ${list(allWidths)}`);
  out.push('');
  out.push('Rules:');
  out.push(...RULES);
  out.push('- Issues under "Shared by several pages" look the same on every page listed, so they likely come from one block or a global style.');
  out.push('- Check each change in the preview on the pages listed, at the affected widths.');
  out.push('- When you are done, list what you changed and anything you couldn\'t fix, per page, so I can re-run the parity check.');

  if (!all.length) {
    out.push('');
    out.push('There are no open issues on any page: every difference was approved. Nothing to fix.');
    return `${out.join('\n')}\n`;
  }

  if (shared.length) {
    out.push('');
    out.push('## Shared by several pages');
    const byBlock = new Map();
    shared.slice(0, MAX_SHARED).forEach((s) => {
      const where = s.g.m?.block ? `Block: ${s.g.m.block}` : 'Page and default content';
      if (!byBlock.has(where)) byBlock.set(where, []);
      byBlock.get(where).push(s);
    });
    byBlock.forEach((items, where) => {
      out.push('');
      out.push(`### ${where}`);
      items.forEach((s) => out.push(`${line(s.g, allWidths)} — on ${s.pages.length} pages: ${pagesList(s.pages.map((p) => `\`${p.path}\``))}`));
    });
    if (shared.length > MAX_SHARED) out.push(`\n…and ${shared.length - MAX_SHARED} more shared issues (ask me for the full list).`);
  }

  pages.forEach((p) => {
    const own = p.styling.filter((g) => !sharedKeys.has(sig(g)));
    out.push('');
    out.push(`## Page ${p.idx + 1}: \`${p.path}\``);
    out.push('');
    out.push(`- Original page: ${p.report.original}`);
    out.push(`- Migrated page: ${p.report.migrated}`);
    if (bps.length > 1) out.push(`- Original site breakpoints: ${p.report.breakpoints?.length ? list(p.report.breakpoints) : 'none detected'}`);
    out.push(`- Parity score: ${p.report.summary?.score ?? '–'}/100 · ${counts(p.all)}${p.approved ? ` · ${p.approved} approved and left out` : ''}`);
    const mm = mismatchLine(p.report.breakpointMismatch);
    if (mm) out.push(mm);
    if (!own.length && !p.content.length) {
      out.push(p.all.length ? '- Only shared issues (listed above).' : '- No open issues.');
      return;
    }
    issueSections(out, own, p.content, p.widths, { maxStyle: 30, maxContent: 15, level: '###' });
  });

  return `${out.join('\n')}\n`;
}
