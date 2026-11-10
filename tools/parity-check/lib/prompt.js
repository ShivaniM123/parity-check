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

export function buildFixPrompt(report, statuses = {}) {
  const approved = new Set(Object.keys(statuses).filter((k) => statuses[k] === 'ok'));
  const all = report.results.flatMap((r) => r.issues).filter((i) => !approved.has(i.id));
  const widths = report.widths || report.results.map((r) => r.width);
  const styling = group(all.filter((i) => !CONTENT.has(i.category)));
  const content = group(all.filter((i) => CONTENT.has(i.category)));
  const count = (s) => all.filter((i) => i.severity === s).length;
  const mm = report.breakpointMismatch;
  const path = pathOf(report.migrated);

  const out = [];
  out.push('Fix the visual parity issues between the original page and its migrated AEM Edge Delivery Services page in this repository, so the migrated page looks like the original at every tested width. The original values below are the target.');
  out.push('');
  out.push(`- Original page: ${report.original}`);
  out.push(`- Migrated page: ${report.migrated}${path ? ` (local preview path \`${path}\`)` : ''}`);
  out.push(`- Original site breakpoints: ${report.breakpoints?.length ? list(report.breakpoints) : 'none detected'}`);
  out.push(`- Tested widths: ${list(widths)}`);
  out.push(`- Parity score: ${report.summary?.score ?? '–'}/100 · ${all.length} open issue${all.length === 1 ? '' : 's'} (${count('high')} high, ${count('medium')} medium, ${count('low')} low)${approved.size ? ` · ${approved.size} difference${approved.size === 1 ? '' : 's'} approved as intended and left out` : ''}`);
  if (mm && (mm.missingInMigrated?.length || mm.extraInMigrated?.length)) {
    out.push(`- Breakpoints: ${mm.missingInMigrated?.length ? `the migrated CSS has no media query at ${list(mm.missingInMigrated)}` : ''}${mm.missingInMigrated?.length && mm.extraInMigrated?.length ? '; ' : ''}${mm.extraInMigrated?.length ? `it changes layout at ${list(mm.extraInMigrated)}` : ''}.`);
  }
  out.push('');
  out.push('Rules:');
  out.push('- Start with high severity. Read the affected blocks and the page markup before you change anything.');
  out.push('- Keep CSS scoped to its block. Don\'t edit `scripts/aem.js`.');
  out.push('- Layout must change at the original site\'s breakpoints listed above.');
  out.push('- Check each change in the preview at the affected widths.');
  out.push('- When you are done, list what you changed and anything you couldn\'t fix, so I can re-run the parity check.');

  if (!all.length) {
    out.push('');
    out.push('There are no open issues: every difference was approved. Nothing to fix.');
    return `${out.join('\n')}\n`;
  }

  if (styling.length) {
    out.push('');
    out.push('## Styling and layout issues');
    // grouped by where the element lives on the migrated page
    const byBlock = new Map();
    styling.slice(0, MAX_STYLE).forEach((g) => {
      const where = g.m?.block ? `Block: ${g.m.block}` : 'Page and default content';
      if (!byBlock.has(where)) byBlock.set(where, []);
      byBlock.get(where).push(g);
    });
    byBlock.forEach((items, where) => {
      out.push('');
      out.push(`### ${where}`);
      items.forEach((g) => out.push(line(g, widths)));
    });
    if (styling.length > MAX_STYLE) out.push(`\n…and ${styling.length - MAX_STYLE} more low-impact issues (ask me for the full list).`);
  }

  if (content.length) {
    out.push('');
    out.push('## Content and page issues');
    content.slice(0, MAX_CONTENT).forEach((g) => out.push(line(g, widths)));
    if (content.length > MAX_CONTENT) out.push(`…and ${content.length - MAX_CONTENT} more (ask me for the full list).`);
  }

  return `${out.join('\n')}\n`;
}
