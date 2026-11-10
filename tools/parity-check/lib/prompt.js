import { buildFixes } from './fixes.js';

/**
 * Turns a comparison into a self-contained prompt for AEM Coder (or any coding
 * agent working in the EDS repo): pages, breakpoints, how to work, the issues
 * grouped per file with Original vs Migrated values, and the suggested CSS.
 * Differences the reviewer approved are left out.
 */

const SEV = { high: 0, medium: 1, low: 2 };
const MAX_CSS = 60; // grouped CSS issues listed in full
const MAX_OTHER = 25;

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

/**
 * Same difference at several widths → one entry listing the widths. Styling
 * issues group by the fix they need, so one CSS change is one line.
 */
function group(issues) {
  const map = new Map();
  issues.forEach((i) => {
    const sel = i.fix?.selector || i.m?.selector || i.o?.selector || '';
    const what = i.fix?.decl?.length
      ? i.fix.decl.map((d) => `${d.prop}:${d.value}`).join(';')
      : `${i.property || ''}|${i.title.replace(/\d+(\.\d+)?/g, '#')}`;
    const key = [i.fix?.file || '', sel, what].join('|');
    if (!map.has(key)) map.set(key, { ...i, sel, widths: [], values: [] });
    const g = map.get(key);
    if (!g.widths.includes(i.width)) g.widths.push(i.width);
    if ((i.ov !== undefined || i.mv !== undefined) && !g.values.some((v) => v.ov === i.ov && v.mv === i.mv)) {
      g.values.push({ ov: i.ov, mv: i.mv, width: i.width });
    }
    if (SEV[i.severity] < SEV[g.severity]) g.severity = i.severity;
  });
  return [...map.values()]
    .map((g) => ({ ...g, widths: g.widths.sort((a, b) => a - b) }))
    .sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.widths.length - a.widths.length);
}

function line(g, allWidths) {
  const where = g.widths.length === allWidths.length ? 'all widths' : list(g.widths);
  const [v] = g.values;
  let values = '';
  if (v) {
    const at = g.values.length > 1 ? ` at ${v.width}px (differs per width)` : '';
    values = ` — ${g.property || 'value'}: original \`${v.ov ?? '–'}\`, migrated \`${v.mv ?? '–'}\`${at}`;
  }
  const sel = g.sel ? ` — \`${g.sel}\`` : '';
  const note = g.fix?.note ? ` → ${g.fix.note}` : '';
  const text = g.m?.text || g.o?.text;
  // the title often quotes the element text already
  return `- [${g.severity}] ${g.title}${text && !g.title.includes(text.slice(0, 20)) ? quote(text) : ''}${sel}${values} — at ${where}${note}`;
}

export function buildFixPrompt(report, statuses = {}, repoRoot = null) {
  const approved = new Set(Object.keys(statuses).filter((k) => statuses[k] === 'ok'));
  // fresh copy: buildFixes annotates the issues it reads
  const results = JSON.parse(JSON.stringify(report.results)).map((r) => ({
    ...r, issues: r.issues.filter((i) => !approved.has(i.id)),
  }));
  const all = results.flatMap((r) => r.issues);
  const widths = report.widths || results.map((r) => r.width);
  const fixes = buildFixes(results, report.breakpoints || [], repoRoot);
  const cssIssues = group(all.filter((i) => i.fix?.file && i.fix?.decl?.length));
  const other = group(all.filter((i) => !(i.fix?.file && i.fix?.decl?.length)));
  const count = (s) => all.filter((i) => i.severity === s).length;
  const mm = report.breakpointMismatch;
  const path = pathOf(report.migrated);

  const out = [];
  out.push('Fix the visual parity issues between the original page and its migrated AEM Edge Delivery Services page in this repository. The migrated page must look like the original at every width listed below.');
  out.push('');
  out.push(`- Original page: ${report.original}`);
  out.push(`- Migrated page: ${report.migrated}${path ? ` (check it in the local preview at \`${path}\`)` : ''}`);
  out.push(`- Original site breakpoints: ${report.breakpoints?.length ? list(report.breakpoints) : 'none detected'}`);
  out.push(`- Tested widths: ${list(widths)}`);
  out.push(`- Parity score: ${report.summary?.score ?? '–'}/100 · ${all.length} open issue${all.length === 1 ? '' : 's'} (${count('high')} high, ${count('medium')} medium, ${count('low')} low)${approved.size ? ` · ${approved.size} difference${approved.size === 1 ? '' : 's'} approved by the reviewer and left out` : ''}`);
  if (mm && (mm.missingInMigrated?.length || mm.extraInMigrated?.length)) {
    out.push(`- Breakpoint mismatch: ${mm.missingInMigrated?.length ? `the migrated CSS has no media query at ${list(mm.missingInMigrated)}` : ''}${mm.missingInMigrated?.length && mm.extraInMigrated?.length ? '; ' : ''}${mm.extraInMigrated?.length ? `it switches layout at ${list(mm.extraInMigrated)} instead` : ''}. Move those media queries to the original's breakpoints.`);
  }
  out.push('');
  out.push('How to work:');
  out.push('1. Fix high severity first, then medium, then low. Read each block\'s JS and CSS, and the page markup, before you edit anything.');
  out.push('2. Fix styling in the file named for each issue (`blocks/<block>/<block>.css` or `styles/styles.css`). Scope selectors to the block. Never edit `scripts/aem.js`.');
  out.push('3. Write media queries with the original site\'s breakpoints above (mobile first, `min-width`), not generic ones.');
  out.push('4. If a CSS custom property in `styles/styles.css` already holds the original value, use it. Otherwise use the value given.');
  out.push('5. The suggested CSS was generated from computed styles, so its selectors can be longer than needed. Merge each rule into the existing rules of the file. Don\'t append duplicate rules.');
  out.push('6. Issues under "Content and other issues" are fixed in the page content or in the import parser/transformer, not in CSS. Fix them where that is safe; otherwise list them for me.');
  out.push('7. After each file, check the preview at the affected widths and confirm that the migrated computed value now equals the original value.');
  out.push('8. When you are done, list what you changed per file, plus anything you could not fix and why, so I can re-run the parity check.');

  if (!all.length) {
    out.push('');
    out.push('There are no open issues: every difference was approved. Nothing to fix.');
    return `${out.join('\n')}\n`;
  }

  if (cssIssues.length) {
    out.push('');
    out.push('## Styling issues');
    const byFile = new Map();
    cssIssues.slice(0, MAX_CSS).forEach((g) => {
      if (!byFile.has(g.fix.file)) byFile.set(g.fix.file, []);
      byFile.get(g.fix.file).push(g);
    });
    byFile.forEach((items, file) => {
      out.push('');
      out.push(`### ${file}`);
      items.forEach((g) => out.push(line(g, widths)));
    });
    if (cssIssues.length > MAX_CSS) out.push(`\n…and ${cssIssues.length - MAX_CSS} more low-impact styling issues (see the full report).`);
  }

  if (fixes.length) {
    out.push('');
    out.push('## Suggested CSS');
    fixes.forEach((f) => {
      out.push('');
      out.push(`${f.file}${f.exists === false ? ' (new file)' : ''}:`);
      out.push('```css');
      out.push(f.css);
      out.push('```');
    });
  }

  if (other.length) {
    out.push('');
    out.push('## Content and other issues');
    other.slice(0, MAX_OTHER).forEach((g) => out.push(line(g, widths)));
    if (other.length > MAX_OTHER) out.push(`…and ${other.length - MAX_OTHER} more (see the full report).`);
  }

  out.push('');
  out.push(`Full report with every issue: \`tools/parity-check/reports/${report.id}/report.json\`. Screenshots are in the same folder (\`<width>-original.png\`, \`<width>-migrated.png\`, \`<width>-diff.png\`).`);
  return `${out.join('\n')}\n`;
}
