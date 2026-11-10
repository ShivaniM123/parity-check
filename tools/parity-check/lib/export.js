import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';

/**
 * Builds a printable report of every issue: an annotated overview of each
 * breakpoint plus Original / Migrated close-ups with the problem outlined
 * (outlines are burned into the images, so they survive copy/paste).
 */

const SEV_RGB = { high: [229, 72, 77], medium: [240, 140, 0], low: [59, 130, 246] };
const SEV_ORDER = { high: 0, medium: 1, low: 2 };
const CATEGORY_LABEL = {
  layout: 'Layout', typography: 'Typography', color: 'Color', spacing: 'Spacing', content: 'Content', image: 'Image', responsive: 'Responsive', component: 'Component', page: 'Page',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const rectsFor = (issue, side) => {
  if (side === 'o') return (issue.oRects?.length ? issue.oRects : [issue.o?.rect]).filter(Boolean);
  return (issue.m?.rects?.length ? issue.m.rects : [issue.m?.rect]).filter(Boolean);
};

function crop(src, x, y, w, h) {
  const cx = Math.max(0, Math.min(src.width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(src.height - 1, Math.round(y)));
  const cw = Math.max(1, Math.min(src.width - cx, Math.round(w)));
  const ch = Math.max(1, Math.min(src.height - cy, Math.round(h)));
  const out = new PNG({ width: cw, height: ch });
  PNG.bitblt(src, out, cx, cy, cw, ch, 0, 0);
  return out;
}

/** Box-filter downscale by an integer factor. */
function downscale(src, f) {
  if (f <= 1) return src;
  const w = Math.floor(src.width / f);
  const h = Math.floor(src.height / f);
  const out = new PNG({ width: w, height: h });
  const n = f * f;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let dy = 0; dy < f; dy += 1) {
        let i = (((y * f + dy) * src.width) + x * f) * 4;
        for (let dx = 0; dx < f; dx += 1) {
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; a += src.data[i + 3];
          i += 4;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = r / n; out.data[o + 1] = g / n; out.data[o + 2] = b / n; out.data[o + 3] = a / n;
    }
  }
  return out;
}

/** Outlines a rectangle just outside its edges. */
function stroke(png, r, rgb, t = 3, dashed = false) {
  const set = (x, y) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
    if (dashed && Math.floor((x + y) / 10) % 2) return;
    const i = (y * png.width + x) * 4;
    [png.data[i], png.data[i + 1], png.data[i + 2]] = rgb;
    png.data[i + 3] = 255;
  };
  const x0 = Math.round(r.x) - 2;
  const y0 = Math.round(r.y) - 2;
  const x1 = Math.round(r.x + r.w) + 1;
  const y1 = Math.round(r.y + r.h) + 1;
  for (let k = 0; k < t; k += 1) {
    for (let x = x0 - k; x <= x1 + k; x += 1) { set(x, y0 - k); set(x, y1 + k); }
    for (let y = y0 - k; y <= y1 + k; y += 1) { set(x0 - k, y); set(x1 + k, y); }
  }
}

const toUri = (png) => `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;

/** Close-up around an issue on one side, with the element(s) outlined. */
function issueCrop(src, issue, side, width) {
  const rects = rectsFor(issue, side);
  if (!rects.length) return null;
  const [r] = rects;
  const pad = 32;
  const minW = Math.min(width, 480);
  let cw = Math.min(width, Math.max(minW, r.w + pad * 2));
  let cx = Math.max(0, Math.min(width - cw, r.x + r.w / 2 - cw / 2));
  if (r.w + pad * 2 > width) { cx = 0; cw = width; }
  const cy = Math.max(0, r.y - pad);
  const ch = Math.max(120, Math.min(r.h + pad * 2, cw * 0.7));
  if (cy >= src.height) return null;
  const png = crop(src, cx, cy, cw, ch);
  const f = png.width > 760 ? 2 : 1;
  const rgb = SEV_RGB[issue.severity];
  const expected = side === 'm' && issue.m?.expected;
  rects.slice(0, 8).forEach((q, k) => stroke(png, { x: q.x - cx, y: q.y - cy, w: q.w, h: q.h }, rgb, (k ? 2 : 4) * f, expected));
  return downscale(png, f);
}

/** Small full-page view of one side with every issue outlined. */
function overview(src, issues, side, width) {
  const f = Math.max(1, Math.round(width / 360));
  const maxSrcH = 2400 * f;
  const png = downscale(crop(src, 0, 0, src.width, Math.min(src.height, maxSrcH)), f);
  const pins = [];
  issues.forEach((i) => {
    const r = rectsFor(i, side)[0];
    if (!r || r.y >= png.height * f) return;
    stroke(png, { x: r.x / f, y: r.y / f, w: r.w / f, h: r.h / f }, SEV_RGB[i.severity], 2, side === 'm' && i.m?.expected);
    pins.push({
      n: i.n, severity: i.severity, x: (r.x / width) * 100, y: ((r.y / f) / png.height) * 100,
    });
  });
  return { png, pins, truncated: src.height > maxSrcH };
}

const STYLE = `
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { font: 12.5px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #101828; margin: 0 auto; max-width: 1100px; padding: 24px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print { body { padding: 0; max-width: none; } .width { break-before: page; } }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 18px; margin: 0 0 12px; }
h3 { font-size: 14px; margin: 0; }
code, pre { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; }
.muted { color: #667085; }
.cover { display: flex; gap: 20px; align-items: center; border-bottom: 2px solid #eaecf0; padding-bottom: 16px; margin-bottom: 16px; }
.score { width: 84px; height: 84px; border-radius: 50%; display: grid; place-content: center; text-align: center; color: #fff; flex: none; }
.score b { font-size: 28px; line-height: 1; } .score span { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
.good { background: #12b76a; } .fair { background: #f08c00; } .poor { background: #e5484d; }
.urls div { margin: 2px 0; word-break: break-all; }
.lbl { display: inline-block; width: 74px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #475467; }
.lbl.m { color: #4353ff; }
.counts { display: flex; gap: 16px; margin-top: 6px; }
.counts b { font-size: 16px; }
.c-high { color: #e5484d; } .c-medium { color: #f08c00; } .c-low { color: #3b82f6; }
.banner { background: #fff8eb; border: 1px solid #fbd38d; border-radius: 8px; padding: 8px 12px; margin: 12px 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; }
th, td { border-bottom: 1px solid #eaecf0; padding: 5px 6px; text-align: center; font-size: 11.5px; }
th:first-child, td:first-child { text-align: left; }
.dot { display: inline-block; min-width: 20px; height: 20px; line-height: 20px; border-radius: 10px; color: #fff; font-weight: 700; font-size: 10px; text-align: center; padding: 0 4px; }
.dot.high { background: #e5484d; } .dot.medium { background: #f08c00; } .dot.low { background: #3b82f6; }
.ok { color: #9ad3b6; }
.width-head { display: flex; align-items: baseline; gap: 12px; border-bottom: 2px solid #eaecf0; padding-bottom: 6px; margin: 24px 0 12px; }
.width-head h2 { margin: 0; }
.overview { display: flex; gap: 16px; justify-content: center; margin-bottom: 16px; break-inside: avoid; }
.overview figure { margin: 0; text-align: center; }
.overview figcaption, .crop figcaption { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #475467; margin-bottom: 4px; text-align: left; }
.overview figure.m figcaption, .crop.m figcaption { color: #4353ff; }
.shot { position: relative; display: inline-block; border: 1px solid #eaecf0; }
.shot img { display: block; max-height: 230mm; max-width: 100%; }
.pin { position: absolute; transform: translate(-40%, -50%); min-width: 16px; height: 16px; line-height: 13px; border-radius: 8px; border: 1.5px solid #fff; color: #fff; font-size: 9px; font-weight: 700; text-align: center; padding: 0 3px; }
.pin.high { background: #e5484d; } .pin.medium { background: #f08c00; } .pin.low { background: #3b82f6; }
.issue { border: 1px solid #eaecf0; border-left: 4px solid var(--c); border-radius: 8px; padding: 10px 12px; margin: 0 0 10px; break-inside: avoid; }
.issue.high { --c: #e5484d; } .issue.medium { --c: #f08c00; } .issue.low { --c: #3b82f6; }
.issue-head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
.num { background: var(--c); color: #fff; border-radius: 10px; min-width: 22px; height: 20px; line-height: 20px; text-align: center; font-weight: 700; font-size: 11px; padding: 0 5px; }
.tag { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; font-weight: 700; color: var(--c); }
.cat { font-size: 10.5px; color: #667085; background: #f2f4f7; border-radius: 5px; padding: 0 6px; }
.detail { margin: 2px 0 8px; color: #475467; white-space: pre-line; }
.crops { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px; }
.crop { margin: 0; }
.crop img { display: block; max-width: 100%; max-height: 70mm; border: 1px solid #eaecf0; border-radius: 4px; }
.crop .none { border: 1px dashed #d0d5dd; border-radius: 4px; padding: 24px 8px; text-align: center; color: #667085; }
.cmp { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
.cmp span.v { border: 1px solid #eaecf0; border-radius: 6px; padding: 2px 8px; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; border: 1px solid rgba(0,0,0,.2); margin-right: 4px; vertical-align: -1px; }
pre { background: #f8f9fc; border: 1px solid #eaecf0; border-radius: 6px; padding: 8px 10px; margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; }
.file { color: #4353ff; font-weight: 600; }
.fixes { break-before: page; }
.fixfile { margin-bottom: 14px; break-inside: avoid; }
table.styles { width: auto; margin: 0 0 8px; }
table.styles th, table.styles td { text-align: left; padding: 3px 10px 3px 0; font-size: 11px; }
table.styles td:first-child { color: #667085; }
table.styles td:nth-child(3) code { color: #c4320a; }
.needs-fix { font-size: 10px; font-weight: 700; color: #fff; background: #e5484d; border-radius: 4px; padding: 1px 6px; }
.approved { border: 1px dashed #d0d5dd; border-radius: 8px; padding: 8px 12px; color: #475467; break-inside: avoid; }
.approved ul { margin: 6px 0 0; padding: 0; list-style: none; }
.approved li { margin: 3px 0; }
.num.ok { background: #12b76a; display: inline-block; line-height: 18px; height: 18px; min-width: 18px; font-size: 10px; }
footer { margin-top: 24px; color: #98a2b3; font-size: 10.5px; text-align: center; }
`;

/** Computed styles that differ between the two elements (DevTools-style). */
function styleTable(i) {
  const o = i.o?.st;
  const m = i.m?.st;
  if (!o || !m) return '';
  const media = ['img', 'svg', 'video', 'iframe', 'picture'].includes(i.m?.tag);
  const TEXT = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'text-align', 'color'];
  const norm = (k, v) => (k === 'font-family' ? String(v).toLowerCase() : String(v));
  const rows = Object.keys(o)
    .filter((k) => o[k] !== undefined && m[k] !== undefined && norm(k, o[k]) !== norm(k, m[k]) && !(media && TEXT.includes(k)))
    .slice(0, 8);
  if (!rows.length) return '';
  return `<table class="styles"><thead><tr><th>Computed style</th><th>Original</th><th>Migrated</th></tr></thead>
    <tbody>${rows.map((k) => `<tr><td>${esc(k)}</td><td><code>${esc(o[k])}</code></td><td><code>${esc(m[k])}</code></td></tr>`).join('')}</tbody></table>`;
}

export function exportName(report) {
  let host = 'page';
  try { host = new URL(report.migrated).host.replace(/[^\w.-]/g, '_'); } catch (e) { /* keep default */ }
  return `parity-report-${host}-${report.created.slice(0, 10)}`;
}

function scoreClass(s) {
  if (s >= 85) return 'good';
  if (s >= 65) return 'fair';
  return 'poor';
}

function matrix(report) {
  const rows = new Map();
  report.results.forEach((r) => r.issues.forEach((i) => {
    const k = [i.category, i.property, i.fix?.selector || i.m?.selector || '', i.title.replace(/\d+(\.\d+)?px/g, '#')].join('|');
    if (!rows.has(k)) rows.set(k, { title: i.title, category: i.category, cells: {} });
    rows.get(k).cells[r.width] = i;
  }));
  const sorted = [...rows.values()].sort((a, b) => Object.keys(b.cells).length - Object.keys(a.cells).length);
  return `<table><thead><tr><th>Issue</th>${report.results.map((r) => `<th>${r.width}px</th>`).join('')}</tr></thead><tbody>
    ${sorted.map((row) => `<tr><td>${esc(row.title)} <span class="cat">${CATEGORY_LABEL[row.category] || row.category}</span></td>
    ${report.results.map((r) => {
    const i = row.cells[r.width];
    return `<td>${i ? `<span class="dot ${i.severity}">${i.n}</span>` : '<span class="ok">✓</span>'}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table>`;
}

/**
 * Returns the report HTML. With `inline` the images are embedded (single-file
 * download); otherwise they are written next to the report and referenced.
 */
export async function buildExport(report, dir, { inline = true } = {}) {
  let fileN = 0;
  const img = async (png) => {
    if (inline) return toUri(png);
    fileN += 1;
    const name = `export-${fileN}.png`;
    await writeFile(join(dir, name), PNG.sync.write(png));
    return name;
  };
  const s = report.summary;
  const mm = report.breakpointMismatch;
  const parts = [];
  const statuses = Object.values(report.review || {});
  const reviewLine = statuses.length
    ? `<div class="muted">Review: <b>${statuses.filter((v) => v === 'fix').length}</b> need fixing · <b>${statuses.filter((v) => v === 'ok').length}</b> approved as intended · <b>${s.issues - statuses.length}</b> not reviewed yet</div>`
    : '';
  parts.push(`<header class="cover">
    <div class="score ${scoreClass(s.score)}"><b>${s.score}</b><span>parity</span></div>
    <div><h1>Visual parity report</h1>
      <div class="urls"><div><span class="lbl">Original</span>${esc(report.original)}</div><div><span class="lbl m">Migrated</span>${esc(report.migrated)}</div></div>
      <div class="counts"><span><b class="c-high">${s.high}</b> high</span><span><b class="c-medium">${s.medium}</b> medium</span><span><b class="c-low">${s.low}</b> low</span>
      <span class="muted">${new Date(report.created).toLocaleString('en-GB')} · breakpoints ${report.breakpoints.join(', ') || '–'} · tested ${report.widths.join(', ')}px</span></div>
      ${reviewLine}
    </div></header>`);
  if (mm && (mm.missingInMigrated.length || mm.extraInMigrated.length)) {
    parts.push(`<div class="banner"><b>Breakpoints don't match.</b>
      ${mm.missingInMigrated.length ? `The migrated CSS has no media query at <b>${mm.missingInMigrated.join(', ')}px</b>.` : ''}
      ${mm.extraInMigrated.length ? `It switches layout at <b>${mm.extraInMigrated.join(', ')}px</b> instead.` : ''}</div>`);
  }
  parts.push(`<h2>Issues across breakpoints</h2><p class="muted">Each row is a problem; numbers refer to the issue at that width.</p>${matrix(report)}`);

  // eslint-disable-next-line no-restricted-syntax
  for (const r of report.results) {
    // one width at a time: decode, annotate, release
    // eslint-disable-next-line no-await-in-loop
    const [oBuf, mBuf] = await Promise.all([readFile(join(dir, r.shots.o)), readFile(join(dir, r.shots.m))]);
    const src = { o: PNG.sync.read(oBuf), m: PNG.sync.read(mBuf) };
    const review = report.review || {};
    const sorted = [...r.issues].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.n - b.n);
    // approved differences (intended) get a one-line mention instead of a full block
    const issues = sorted.filter((i) => review[i.id] !== 'ok');
    const approved = sorted.filter((i) => review[i.id] === 'ok');
    const ov = { o: overview(src.o, issues, 'o', r.width), m: overview(src.m, issues, 'm', r.width) };
    const pinHtml = (pins) => pins.map((p) => `<span class="pin ${p.severity}" style="left:${p.x}%;top:${p.y}%">${p.n}</span>`).join('');
    // eslint-disable-next-line no-await-in-loop
    const [ovO, ovM] = await Promise.all([img(ov.o.png), img(ov.m.png)]);
    const blocks = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const i of issues) {
      const co = issueCrop(src.o, i, 'o', r.width);
      const cm = issueCrop(src.m, i, 'm', r.width);
      const hasAny = rectsFor(i, 'o').length || rectsFor(i, 'm').length;
      const fig = async (png, side) => {
        const label = side === 'o' ? 'Original' : 'Migrated';
        if (!png) return `<figure class="crop ${side}"><figcaption>${label}</figcaption><div class="none">Not on the ${side === 'o' ? 'original' : 'migrated'} page</div></figure>`;
        return `<figure class="crop ${side}"><figcaption>${label}</figcaption><img src="${await img(png)}" alt="${label} close-up of issue ${i.n}"></figure>`;
      };
      // eslint-disable-next-line no-await-in-loop
      const crops = hasAny ? `<div class="crops">${await fig(co, 'o')}${await fig(cm, 'm')}</div>` : '';
      const sw = (c) => (c ? `<i class="sw" style="background:${esc(c)}"></i>` : '');
      blocks.push(`<article class="issue ${i.severity}">
        <div class="issue-head"><span class="num">${i.n}</span><span class="tag">${i.severity}</span><span class="cat">${CATEGORY_LABEL[i.category] || i.category}${i.count > 1 ? ` · ${i.count}×` : ''}</span>${review[i.id] === 'fix' ? '<span class="needs-fix">Needs fix</span>' : ''}</div>
        <h3>${esc(i.title)}</h3>
        <p class="detail">${esc(i.detail)}</p>
        ${crops}
        ${styleTable(i)}
        ${i.ov || i.mv ? `<div class="cmp"><span class="lbl">Original</span><span class="v">${sw(i.swatch?.[0])}<code>${esc(i.ov || '–')}</code></span>→<span class="lbl m">Migrated</span><span class="v">${sw(i.swatch?.[1])}<code>${esc(i.mv || '–')}</code></span></div>` : ''}
        ${i.m?.selector ? `<div class="muted">Element: <code>${esc(i.m.selector)}</code></div>` : ''}
        ${i.fix?.css ? `<div><b>Fix</b> in <span class="file">${esc(i.fix.file)}</span><pre>${esc(i.fix.css)}</pre></div>` : ''}
        ${i.fix?.note ? `<div><b>How to fix:</b> ${esc(i.fix.note)}</div>` : ''}
      </article>`);
    }
    parts.push(`<section class="width">
      <div class="width-head"><h2>${r.width}px</h2><span>score <b>${r.score}</b></span>
        <span><b class="c-high">${r.stats.high}</b> high · <b class="c-medium">${r.stats.medium}</b> medium · <b class="c-low">${r.stats.low}</b> low</span>
        <span class="muted">${r.stats.similarity}% pixels match · ${r.stats.matchRate}% elements matched</span></div>
      <div class="overview">
        <figure class="o"><figcaption>Original</figcaption><div class="shot"><img src="${ovO}" alt="Original at ${r.width}px">${pinHtml(ov.o.pins)}</div>${ov.o.truncated ? '<div class="muted">(top of page shown)</div>' : ''}</figure>
        <figure class="m"><figcaption>Migrated</figcaption><div class="shot"><img src="${ovM}" alt="Migrated at ${r.width}px">${pinHtml(ov.m.pins)}</div>${ov.m.truncated ? '<div class="muted">(top of page shown)</div>' : ''}</figure>
      </div>
      ${blocks.join('\n') || '<p class="muted">No open issues at this width.</p>'}
      ${approved.length ? `<div class="approved"><b>Approved differences (intended)</b><ul>${approved.map((i) => `<li><span class="num ok">${i.n}</span> ${esc(i.title)}</li>`).join('')}</ul></div>` : ''}
    </section>`);
  }

  if (report.fixes?.length) {
    parts.push(`<section class="fixes"><h2>All recommended CSS fixes</h2>
      <p class="muted">Merged per file across breakpoints. Media queries use the original site's breakpoints.</p>
      ${report.fixes.map((f) => `<div class="fixfile"><span class="file">${esc(f.file)}</span>${f.exists === false ? ' <span class="muted">(new file)</span>' : ''} <span class="muted">· ${f.issues} issue${f.issues > 1 ? 's' : ''}</span><pre>${esc(f.css)}</pre></div>`).join('')}
    </section>`);
  }
  parts.push(`<footer>Generated by Parity Check · report ${esc(report.id)}</footer>`);
  return {
    filename: exportName(report),
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Parity report – ${esc(report.migrated)}</title><style>${STYLE}</style></head><body>${parts.join('\n')}</body></html>`,
  };
}
