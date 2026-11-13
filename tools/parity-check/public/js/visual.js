import {
  esc, copy, scoreClass, SEV_ORDER, CATEGORY_LABEL, getReview, saveReview,
} from './util.js';

/*
 * Visual parity viewer. UI patterns borrowed from free tools reviewers already know:
 * - Responsive Viewer / Polypane: every breakpoint side by side
 * - VisBug / DevTools: spacing measurement guides and a computed-style comparison
 * - Chromatic / Percy: review each change (needs fix / approve) with keyboard shortcuts
 */

const ICONS = {
  side: '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="5.5" height="11" rx="1"/><rect x="9" y="2.5" width="5.5" height="11" rx="1"/></svg>',
  strip: '<svg viewBox="0 0 16 16"><rect x="1" y="4" width="3" height="8" rx=".5"/><rect x="5.5" y="3" width="4" height="10" rx=".5"/><rect x="11" y="2" width="4" height="12" rx=".5"/></svg>',
};
const MODES = [['side', 'Side by side'], ['strip', 'Breakpoints']];
const SEV_RANK = { high: 3, medium: 2, low: 1 };

/** Maps a y on one page to the other through matched content positions [[from, to], …]. */
function mapY(pts, y) {
  if (y <= pts[0][0]) return pts[0][1] - (pts[0][0] - y);
  const last = pts[pts.length - 1];
  if (y >= last[0]) return last[1] + (y - last[0]);
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1; // eslint-disable-line no-bitwise
    if (pts[mid][0] <= y) lo = mid; else hi = mid;
  }
  const [a, b] = [pts[lo], pts[hi]];
  return b[0] === a[0] ? a[1] : a[1] + ((y - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
}

export function issueKey(i) {
  return [i.category, i.property, i.fix?.selector || i.m?.selector || i.o?.selector || '', i.title.replace(/\d+(\.\d+)?px/g, '#')].join('|');
}

export function rectsFor(issue, side) {
  if (side === 'o') return (issue.oRects?.length ? issue.oRects : [issue.o?.rect]).filter(Boolean);
  return (issue.m?.rects?.length ? issue.m.rects : [issue.m?.rect]).filter(Boolean);
}

/**
 * Close-up of one screenshot around the issue's element. Pure CSS cropping:
 * percentages for x/width, margin/padding percentages (relative to width) for y/height.
 */
export function cropHtml(report, result, issue, side) {
  const label = side === 'o' ? 'Original' : 'Migrated';
  const rects = rectsFor(issue, side);
  if (!rects.length) {
    return `<figure class="crop ${side}"><figcaption>${label}</figcaption>
      <div class="crop-empty">${side === 'o' ? 'Not on the original page' : 'Not on the migrated page'}</div></figure>`;
  }
  const W = result.width;
  const [r] = rects;
  const pad = 24;
  const minW = Math.min(W, 360);
  let cw = Math.min(W, Math.max(minW, r.w + pad * 2));
  let cx = Math.max(0, Math.min(W - cw, r.x + r.w / 2 - cw / 2));
  if (r.w + pad * 2 > W) { cx = 0; cw = W; }
  const cy = Math.max(0, r.y - pad);
  const ch = Math.max(80, Math.min(r.h + pad * 2, cw * 0.75)); // tall elements: show the top
  const pctW = (v) => `${(v / cw) * 100}%`;
  const boxes = rects.filter((q) => q.y < cy + ch && q.y + q.h > cy).slice(0, 6).map((q, k) => `<span class="crop-box ${k ? 'also' : ''} ${side === 'm' && issue.m?.expected ? 'expected' : ''}"
      style="left:${pctW(q.x - cx)};width:${pctW(q.w)};margin-top:${pctW(q.y - cy)};padding-bottom:${pctW(q.h)}"></span>`).join('');
  const src = `/reports/${report.id}/${result.shots[side]}`;
  return `<figure class="crop ${side}"><figcaption>${label}</figcaption>
    <div class="crop-view" style="aspect-ratio:${cw} / ${ch}">
      <div class="crop-inner" style="left:${pctW(-cx)};width:${pctW(W)};margin-top:${pctW(-cy)}"><img src="${src}" alt="" loading="lazy"></div>
      <div class="crop-boxes">${boxes}</div>
    </div></figure>`;
}

export function fixHtml(fix) {
  if (!fix) return '';
  const file = fix.file ? `<code class="file ${fix.exists === false ? 'new' : ''}">${esc(fix.file)}${fix.exists === false ? ' · new file' : ''}</code>` : '';
  const code = fix.css ? `<div class="code"><pre>${esc(fix.css)}</pre><button type="button" class="btn tiny copy" data-copy="${esc(fix.css)}">Copy</button></div>` : '';
  const note = fix.note ? `<p class="note">${esc(fix.note)}</p>` : '';
  if (!file && !code && !note) return '';
  return `<section class="fix"><h4>How to fix ${file}</h4>${code}${note}</section>`;
}

/** A wording snippet with the changed words highlighted. */
export const wordsHtml = (segs) => segs.map(([t, changed]) => (changed ? `<mark>${esc(t)}</mark>` : esc(t))).join('');

export function compareHtml(i) {
  if (!i.ov && !i.mv) return '';
  const cell = (v, sw, words) => {
    if (!v) return '<span class="muted">–</span>';
    return `${sw ? `<i class="sw" style="background:${esc(sw)}"></i>` : ''}<code>${words ? wordsHtml(words) : esc(v)}</code>`;
  };
  return `<div class="compare">
    <div class="cmp o"><span>Original</span>${cell(i.ov, i.swatch?.[0], i.words?.o)}</div>
    <div class="cmp-arrow" aria-hidden="true">→</div>
    <div class="cmp m"><span>Migrated</span>${cell(i.mv, i.swatch?.[1], i.words?.m)}</div>
  </div>`;
}

/** DevTools-style computed-style comparison; differing rows highlighted. */
export function stylesHtml(i) {
  const o = i.o?.st;
  const m = i.m?.st;
  if (!o || !m) return '';
  // text properties mean nothing on media elements
  const media = ['img', 'svg', 'video', 'iframe', 'picture'].includes(i.m?.tag);
  const TEXT = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'text-align', 'color'];
  const keys = Object.keys(o).filter((k) => (o[k] !== undefined || m[k] !== undefined) && !(media && TEXT.includes(k)));
  const norm = (k, v) => (k === 'font-family' ? String(v ?? '').toLowerCase() : String(v ?? ''));
  const differs = (k) => norm(k, o[k]) !== norm(k, m[k]);
  const n = keys.filter(differs).length;
  if (!keys.length) return '';
  const swatch = (k, v) => (['color', 'background'].includes(k) && /^#|^rgb/.test(v || '') ? `<i class="sw" style="background:${esc(v)}"></i>` : '');
  return `<details class="inspector" open>
    <summary>Computed styles <span class="muted">${n} differ${n === 1 ? 's' : ''}</span>
      <button type="button" class="btn tiny show-all" aria-pressed="false">Show all</button></summary>
    <table><thead><tr><th>Property</th><th class="o">Original</th><th class="m">Migrated</th></tr></thead><tbody>
    ${keys.map((k) => `<tr class="${differs(k) ? 'diff' : 'same'}"><td>${esc(k)}</td>
      <td>${swatch(k, o[k])}<code>${esc(o[k] ?? '–')}</code></td><td>${swatch(k, m[k])}<code>${esc(m[k] ?? '–')}</code></td></tr>`).join('')}
    </tbody></table></details>`;
}

const reviewBar = (status) => `<div class="review-actions" role="group" aria-label="Review">
  <button type="button" class="rv fix ${status === 'fix' ? 'on' : ''}" data-status="fix" title="Needs fix (F)"><span aria-hidden="true">⚑</span> Needs fix <kbd>F</kbd></button>
  <button type="button" class="rv ok ${status === 'ok' ? 'on' : ''}" data-status="ok" title="Approve as an intended difference (A)"><span aria-hidden="true">✓</span> Approve <kbd>A</kbd></button>
</div>`;

export function issueBody(report, result, i, status) {
  const hasRect = rectsFor(i, 'o').length || rectsFor(i, 'm').length;
  return `${status !== undefined ? reviewBar(status) : ''}
    <p class="detail">${esc(i.detail)}</p>
    ${hasRect ? `<div class="crops">${cropHtml(report, result, i, 'o')}${cropHtml(report, result, i, 'm')}</div>` : ''}
    ${compareHtml(i)}
    ${stylesHtml(i)}
    ${i.m?.selector ? `<p class="where"><span>Element</span><code>${esc(i.m.selector)}</code></p>` : ''}
    ${fixHtml(i.fix)}`;
}

const STATUS_ICON = { fix: '<span class="st fix" title="Needs fix">⚑</span>', ok: '<span class="st ok" title="Approved">✓</span>' };

export function issueRow(i, status) {
  return `<article class="issue sev-${i.severity} ${status ? `is-${status}` : ''}" data-id="${esc(i.id)}">
    <button type="button" class="issue-row" aria-expanded="false">
      <span class="pin-ref">${i.n}</span>
      <span class="issue-title">${esc(i.title)}</span>
      ${STATUS_ICON[status] || ''}
      <span class="cat-tag">${CATEGORY_LABEL[i.category] || i.category}${i.count > 1 ? ` · ${i.count}×` : ''}</span>
    </button>
    <div class="issue-body"></div>
  </article>`;
}

const shortTitle = (t, n = 46) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/*
 * A pin shared by several issues on one element lists their numbers ("1 · 4 · 7"),
 * the same numbers as in the issue list. Up to 4 are shown; more end with "…"
 * (the tooltip lists them all).
 */
const PIN_MAX = 4;
const pinNums = (issues) => {
  const ns = issues.map((i) => i.n);
  return ns.length > PIN_MAX ? [...ns.slice(0, PIN_MAX - 1), '…'] : ns;
};
const pinLabel = (issues) => pinNums(issues).join('<i class="pin-sep">·</i>');
const pinWidth = (issues) => Math.max(22, pinNums(issues).join('').length * 8 + (pinNums(issues).length - 1) * 10 + 16);

export class Viewer {
  constructor(root, report, result, onSelect, { onWidthChange } = {}) {
    this.root = root;
    this.report = report;
    this.result = result;
    this.onSelect = onSelect;
    this.onWidthChange = onWidthChange;
    this.mode = Viewer.prefs.mode;
    this.showPins = true;
    this.zoom = 'fit';
    this.selected = null;
    this.order = result.issues.map((i) => i.id);
    this.visibleIds = new Set(this.order);
    this.render();
  }

  src(kind, r = this.result) { return `/reports/${this.report.id}/${r.shots[kind]}`; }

  issue(id) { return this.result.issues.find((i) => i.id === id); }

  setMode(mode) {
    if (mode === 'strip' && !this.onWidthChange) return;
    this.mode = mode;
    Viewer.prefs.mode = mode;
    this.render();
    if (this.selected) setTimeout(() => this.select(this.selected), 50);
  }

  controlsHtml() {
    const p = Viewer.prefs;
    if (this.mode === 'strip') {
      return `<div class="seg mini" role="group" aria-label="Page">${['m', 'o'].map((s) => `<button type="button" data-strip="${s}" class="${p.stripSide === s ? 'on' : ''}">${s === 'o' ? 'Original' : 'Migrated'}</button>`).join('')}</div>`;
    }
    return '';
  }

  render() {
    const r = this.result;
    this.root.innerHTML = `
      <div class="viewer-bar">
        <div class="seg modes" role="tablist" aria-label="View mode">
          ${MODES.filter(([k]) => k !== 'strip' || this.onWidthChange).map(([k, l], n) => `<button type="button" role="tab" data-mode="${k}" class="${this.mode === k ? 'on' : ''}" title="${l} (${n + 1})" aria-selected="${this.mode === k}">${ICONS[k]}<span>${l}</span></button>`).join('')}
        </div>
        <div class="mode-ctl">${this.controlsHtml()}</div>
        <div class="nav-issues">
          <button type="button" class="icon-btn sm" id="prev" title="Previous issue (←)" aria-label="Previous issue">‹</button>
          <span id="nav-pos" class="muted"></span>
          <button type="button" class="icon-btn sm" id="next" title="Next issue (→)" aria-label="Next issue">›</button>
        </div>
        <label class="ctl chk"><input type="checkbox" id="pins" ${this.showPins ? 'checked' : ''}> Pins</label>
        ${this.mode !== 'strip' ? '<select id="zoom" class="ctl" aria-label="Zoom"><option value="fit">Fit</option><option value="1">100%</option><option value="0.5">50%</option></select>' : ''}
      </div>
      <div class="stage mode-${this.mode}">${this.stageHtml(r)}</div>`;
    this.bind();
  }

  stageHtml(r) {
    if (this.mode === 'side') {
      return ['o', 'm'].map((s) => `
        <div class="pane" data-side="${s}">
          <div class="pane-title ${s}"><b>${s === 'o' ? 'Original' : 'Migrated'}</b><span>${r.width}px${r.page[s].truncated ? ' · truncated' : ''}</span></div>
          <div class="scroller"><div class="canvas"><img src="${this.src(s)}" alt="${s === 'o' ? 'Original' : 'Migrated'} at ${r.width}px"><div class="marks"></div></div></div>
        </div>`).join('');
    }
    if (this.mode === 'strip') {
      const side = Viewer.prefs.stripSide;
      return `<div class="strip">${this.report.results.map((res) => `
        <button type="button" class="strip-col ${res.width === r.width ? 'on' : ''}" data-width="${res.width}" title="Open ${res.width}px">
          <span class="strip-head"><b>${res.width}px</b><span class="score-pill sm ${scoreClass(res.score)}">${res.score}</span>${res.stats.high ? `<span class="tc high">${res.stats.high}</span>` : ''}</span>
          <span class="strip-shot" style="--w:${res.width}"><img src="${this.src(side, res)}" alt="${side === 'o' ? 'Original' : 'Migrated'} at ${res.width}px" loading="lazy"><span class="strip-dots" data-width="${res.width}"></span></span>
        </button>`).join('')}</div>`;
    }
    return '';
  }

  bind() {
    const p = Viewer.prefs;
    this.root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
    this.root.querySelector('#pins').addEventListener('change', (e) => { this.showPins = e.target.checked; this.drawMarks(); });
    this.root.querySelector('#prev').addEventListener('click', () => this.step(-1));
    this.root.querySelector('#next').addEventListener('click', () => this.step(1));
    const zoom = this.root.querySelector('#zoom');
    if (zoom) {
      zoom.value = this.zoom;
      zoom.addEventListener('change', () => { this.zoom = zoom.value; this.applyZoom(); });
    }
    if (this.mode === 'strip') {
      this.root.querySelectorAll('[data-strip]').forEach((b) => b.addEventListener('click', () => { p.stripSide = b.dataset.strip; this.render(); }));
      this.root.querySelectorAll('.strip-col').forEach((c) => c.addEventListener('click', () => {
        const w = Number(c.dataset.width);
        Viewer.prefs.mode = 'side';
        this.onWidthChange(w);
      }));
      this.root.querySelectorAll('.strip-shot img').forEach((img) => img.addEventListener('load', () => this.drawStripDots(img)));
      this.fitStrip();
    }
    // scroll sync by content: the section in the middle of one pane is brought to the
    // middle of the other, even when sections above it differ in height. Reports without
    // matched positions fall back to proportional sync. Paused while jumping to an issue.
    const scrollers = [...this.root.querySelectorAll('.scroller')];
    if (scrollers.length === 2) {
      let lock = false;
      const anchors = this.result.anchors || [];
      scrollers.forEach((s, idx) => s.addEventListener('scroll', () => {
        if (lock || this.jumping) return;
        lock = true;
        const other = scrollers[1 - idx];
        const scaleOf = (sc) => { const img = sc.querySelector('img'); return img?.naturalWidth ? img.clientWidth / img.naturalWidth : 0; };
        const from = scaleOf(s);
        const to = scaleOf(other);
        if (anchors.length >= 2 && from && to) {
          const pts = idx === 0 ? anchors : anchors.map(([o, m]) => [m, o]).sort((a, b) => a[0] - b[0]);
          const y = (s.scrollTop + s.clientHeight / 2) / from; // page y at the pane's middle
          other.scrollTop = mapY(pts, y) * to - other.clientHeight / 2;
        } else {
          const ratio = s.scrollTop / Math.max(1, s.scrollHeight - s.clientHeight);
          other.scrollTop = ratio * (other.scrollHeight - other.clientHeight);
        }
        requestAnimationFrame(() => { lock = false; });
      }));
    }
    // clicking empty screenshot area clears the selection
    this.root.querySelectorAll('.canvas').forEach((c) => c.addEventListener('click', (e) => {
      if (!e.target.closest('.pin, .focus-label')) this.onSelect(null);
    }));
    this.root.querySelectorAll('.canvas img').forEach((img) => img.addEventListener('load', () => this.drawMarks()));
    if (!this.resizeObs) {
      this.resizeObs = new ResizeObserver(() => {
        if (this.mode === 'strip') this.fitStrip(); else this.drawMarks();
      });
    }
    this.resizeObs.disconnect();
    this.root.querySelectorAll('.canvas, .stage').forEach((c) => this.resizeObs.observe(c));
    this.applyZoom();
    this.updateNav();
  }

  /** Breakpoint strip: one scale for every width, so relative widths stay true. */
  fitStrip() {
    const strip = this.root.querySelector('.strip');
    if (!strip) return;
    const widths = this.report.results.map((r) => r.width);
    const avail = strip.clientWidth - 24 - widths.length * 18;
    const scale = Math.max(0.12, Math.min(0.42, avail / widths.reduce((a, b) => a + b, 0)));
    strip.style.setProperty('--scale', scale);
  }

  drawStripDots(img) {
    const holder = img.parentElement.querySelector('.strip-dots');
    const res = this.report.results.find((r) => r.width === Number(holder.dataset.width));
    const side = Viewer.prefs.stripSide;
    if (!this.showPins) { holder.innerHTML = ''; return; }
    holder.innerHTML = res.issues.map((i) => {
      const r = rectsFor(i, side)[0];
      if (!r || r.y > img.naturalHeight) return '';
      return `<i class="dot-pin sev-${i.severity}" style="left:${(r.x / res.width) * 100}%;top:${(r.y / img.naturalHeight) * 100}%" title="${esc(`${i.n}. ${i.title}`)}"></i>`;
    }).join('');
  }

  applyZoom() {
    this.root.querySelectorAll('.canvas').forEach((c) => {
      c.style.width = this.zoom === 'fit' ? '100%' : `${this.result.width * Number(this.zoom)}px`;
    });
    this.drawMarks();
  }

  visibleOrder() { return this.order.filter((id) => this.visibleIds.has(id)); }

  step(dir) {
    const list = this.visibleOrder();
    if (!list.length) return;
    const idx = list.indexOf(this.selected);
    let next = (idx + dir + list.length) % list.length;
    if (idx < 0) next = dir > 0 ? 0 : list.length - 1;
    this.onSelect(list[next], 'viewer');
  }

  updateNav() {
    const list = this.visibleOrder();
    const pos = this.root.querySelector('#nav-pos');
    if (!pos) return;
    const idx = list.indexOf(this.selected);
    pos.textContent = idx >= 0 ? `${idx + 1} / ${list.length}` : `${list.length} issues`;
  }

  // one pin per element: issues whose element sits at the same spot share a pin
  pinsFor(side) {
    const pins = [];
    this.visibleOrder().map((id) => this.issue(id)).forEach((i) => {
      const r = rectsFor(i, side)[0];
      if (!r) return;
      const near = pins.find((p) => Math.abs(p.x - r.x) < 16 && Math.abs(p.y - r.y) < 16);
      if (near) near.issues.push(i);
      else pins.push({ x: r.x, y: r.y, issues: [i] });
    });
    return pins;
  }

  /** VisBug-style measurement guide for spacing issues: the gap and its size. */
  // eslint-disable-next-line class-methods-use-this
  measureHtml(sel, side, scale) {
    if (sel.category !== 'spacing') return '';
    const gap = parseFloat(side === 'o' ? sel.ov : sel.mv);
    const r = rectsFor(sel, side)[0];
    if (!r || !Number.isFinite(gap) || gap <= 0) return '';
    const top = side === 'o' ? r.y - gap : r.y; // original rect is the element below the gap
    return `<div class="measure" style="left:${(r.x + Math.min(40, r.w / 2)) * scale}px;top:${top * scale}px;height:${gap * scale}px">
      <span>${Math.round(gap)}px</span></div>`;
  }

  drawMarks() {
    if (this.mode === 'strip') {
      this.root.querySelectorAll('.strip-shot img').forEach((img) => { if (img.naturalWidth) this.drawStripDots(img); });
      this.updateNav();
      return;
    }
    this.root.querySelectorAll('.pane').forEach((pane) => {
      const marks = pane.querySelector('.marks');
      const img = pane.querySelector('.canvas img');
      if (!img || !img.naturalWidth) return;
      const scale = img.clientWidth / img.naturalWidth;
      const side = this.mode === 'side' ? pane.dataset.side : 'm';
      const box = (r, cls) => `<div class="${cls}" style="left:${r.x * scale}px;top:${r.y * scale}px;width:${Math.max(4, r.w * scale)}px;height:${Math.max(4, r.h * scale)}px"></div>`;
      let html = '';
      const sel = this.selected && this.issue(this.selected);
      if (sel) {
        const rects = rectsFor(sel, side);
        if (rects.length) {
          const [first, ...rest] = rects;
          const expected = side === 'm' && sel.m?.expected;
          html += box(first, `focus sev-${sel.severity} ${expected ? 'expected' : ''}`);
          html += rest.map((r) => box(r, `also sev-${sel.severity}`)).join('');
          html += this.measureHtml(sel, side, scale);
          // the label shows this side's value, so both panes read like a before/after
          const value = side === 'o' ? sel.ov : sel.mv;
          const below = first.y * scale < 34;
          const labelX = Math.max(4, Math.min(first.x * scale, img.clientWidth - 370)); // keep it inside the pane (label max 360px)
          // wording: this side's text with the changed words highlighted says it all
          const words = sel.words?.[side];
          let labelBody = `${value ? `<code class="${side}">${esc(value)}</code>` : ''}<span>${esc(shortTitle(sel.title))}</span>`;
          if (words) labelBody = `<code class="${side}">${wordsHtml(words)}</code>`;
          if (expected) labelBody = '<span>Missing here</span>';
          html += `<div class="focus-label sev-${sel.severity} ${below ? 'below' : ''} ${words ? 'words' : ''}" style="left:${labelX}px;top:${(below ? first.y + first.h : first.y) * scale}px">
            <b>${sel.n}</b>${labelBody}</div>`;
        }
      }
      // shown on the pane itself (not the scrolling page) so it stays in view
      pane.querySelector('.pane-note')?.remove();
      if (sel && !rectsFor(sel, side).length) {
        pane.insertAdjacentHTML('beforeend', `<div class="pane-note">${side === 'o' ? 'Not on the original page' : 'Not on the migrated page'}</div>`);
      }
      if (this.showPins && !sel) {
        // keep pins inside the frame and nudge pins that would overlap
        const placed = [];
        html += this.pinsFor(side).map((raw) => {
          // pins are centred 40% from their left edge: keep the whole pin in the frame
          const w = pinWidth(raw.issues);
          const p = {
            ...raw, w, x: Math.min(img.clientWidth - w * 0.6 - 2, Math.max(w * 0.4 + 2, raw.x * scale)), y: Math.max(12, raw.y * scale),
          };
          // overlap is checked with each pin's own width (shared pins are wider)
          const left = (q) => q.x - q.w * 0.4;
          while (placed.some((q) => left(p) < left(q) + q.w + 4 && left(q) < left(p) + p.w + 4 && Math.abs(q.y - p.y) < 22)) p.x += 8;
          placed.push(p);
          return p;
        }).map((p) => {
          const worst = p.issues.reduce((a, b) => (SEV_RANK[b.severity] > SEV_RANK[a.severity] ? b : a));
          const reviewed = p.issues.every((i) => this.statuses?.[i.id] === 'ok');
          const title = `${p.issues.length > 1 ? `${p.issues.length} issues on this element. Click to go through them.\n` : ''}${p.issues.map((i) => `${i.n}. ${i.title}`).join('\n')}`;
          return `<button type="button" class="pin sev-${worst.severity} ${reviewed ? 'approved' : ''}" data-ids="${p.issues.map((i) => esc(i.id)).join(',')}"
            style="left:${p.x}px;top:${p.y}px" title="${esc(title)}">${pinLabel(p.issues)}</button>`;
        }).join('');
      }
      marks.innerHTML = html;
      // shared pins are wider than estimated at times: measure, and pull them back into the frame
      const frame = marks.getBoundingClientRect();
      marks.querySelectorAll('.pin').forEach((pin) => {
        const r = pin.getBoundingClientRect();
        let dx = 0;
        if (r.left < frame.left + 2) dx = frame.left + 2 - r.left;
        else if (r.right > frame.right - 2) dx = frame.right - 2 - r.right;
        if (dx) pin.style.left = `${parseFloat(pin.style.left) + dx}px`;
      });
      marks.querySelectorAll('.pin').forEach((pin) => {
        const ids = pin.dataset.ids.split(',');
        pin.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = ids.indexOf(this.selected); // a shared pin cycles through its issues
          this.onSelect(ids[(idx + 1) % ids.length], 'viewer');
        });
        pin.addEventListener('pointerdown', (e) => e.stopPropagation());
        pin.addEventListener('mouseenter', () => {
          const r = rectsFor(this.issue(ids[0]), side)[0];
          marks.insertAdjacentHTML('afterbegin', box(r, 'hover-box'));
        });
        pin.addEventListener('mouseleave', () => marks.querySelector('.hover-box')?.remove());
      });
    });
    this.updateNav();
  }

  select(id) {
    this.selected = id;
    this.drawMarks();
    const issue = id && this.issue(id);
    if (!issue || this.mode === 'strip') return;
    this.jumping = true;
    clearTimeout(this.jumpTimer);
    this.jumpTimer = setTimeout(() => { this.jumping = false; }, 700);
    this.root.querySelectorAll('.pane').forEach((pane) => {
      const side = this.mode === 'side' ? pane.dataset.side : 'm';
      const rc = rectsFor(issue, side)[0] || rectsFor(issue, side === 'm' ? 'o' : 'm')[0];
      const img = pane.querySelector('.canvas img');
      if (!rc || !img?.naturalWidth) return;
      const scale = img.clientWidth / img.naturalWidth;
      const scroller = pane.querySelector('.scroller');
      const h = rc.h * scale;
      const top = h < scroller.clientHeight - 120 ? rc.y * scale - (scroller.clientHeight - h) / 2 : rc.y * scale - 60;
      scroller.scrollTo({ top: Math.max(0, top), left: Math.max(0, rc.x * scale - 40), behavior: 'smooth' });
    });
  }
}

// view preferences survive switching widths / reopening the panel
Viewer.prefs = {
  mode: 'side', stripSide: 'm',
};

export function matrixHtml(report) {
  const rows = new Map();
  report.results.forEach((r) => r.issues.forEach((i) => {
    const k = issueKey(i);
    if (!rows.has(k)) rows.set(k, { title: i.title, category: i.category, cells: {} });
    rows.get(k).cells[r.width] = i;
  }));
  const sorted = [...rows.values()].sort((a, b) => Object.keys(b.cells).length - Object.keys(a.cells).length);
  return `<p class="muted">Each row is a problem; each column a tested width. Click a dot to open it.</p>
    <table class="matrix"><thead><tr><th>Issue</th>${report.results.map((r) => `<th>${r.width}px</th>`).join('')}</tr></thead><tbody>
    ${sorted.map((row) => `<tr><td><span class="cat-tag">${CATEGORY_LABEL[row.category] || row.category}</span> ${esc(row.title)}</td>
      ${report.results.map((r) => {
    const i = row.cells[r.width];
    return `<td>${i ? `<a class="dot ${i.severity}" href="#" data-goto="${esc(i.id)}" title="${esc(`${r.width}px · #${i.n}`)}">${i.n}</a>` : '<span class="ok-dot" title="OK at this width">✓</span>'}</td>`;
  }).join('')}</tr>`).join('')}
  </tbody></table>`;
}

export function fixesHtml(report) {
  if (!report.fixes?.length) return '<p class="muted">No CSS fixes. Remaining issues are about content.</p>';
  const all = report.fixes.map((f) => `/* ===== ${f.file} ===== */\n${f.css}`).join('\n\n');
  return `<div class="fixes-head"><p>Fixes from every breakpoint, merged per file. A media query is added only where a fix isn't needed at every width, and it uses the original site's breakpoints.</p>
    <button type="button" class="btn secondary copy" data-copy="${esc(all)}">Copy all</button></div>
    ${report.fixes.map((f) => `<section class="file-fix">
      <header><code>${esc(f.file)}</code>${f.exists === false ? '<span class="badge low">new file</span>' : ''}<span class="muted">${f.issues} issue${f.issues > 1 ? 's' : ''}</span>
      <button type="button" class="btn tiny copy" data-copy="${esc(f.css)}">Copy</button></header>
      <pre>${esc(f.css)}</pre></section>`).join('')}`;
}

/**
 * Viewer + review list for one width. Used by the chat's visual panel and the
 * full report page. Returns { select(id), destroy() }.
 */
export function mountWorkspace(container, report, result, { focusId, onWidthChange } = {}) {
  const cats = [...new Set(result.issues.map((i) => i.category))];
  container.innerHTML = `<div class="workspace">
    <div class="viewer card"></div>
    <aside class="issues card">
      <div class="issues-head">
        <div class="ih-top"><h2>${result.issues.length} issues at ${result.width}px</h2>
          <span class="muted" title="Pixel match · elements matched">${result.stats.similarity}% pixels · ${result.stats.matchRate}% elements</span></div>
        <div class="review-progress" aria-live="polite"></div>
        <div class="filters">
          ${['high', 'medium', 'low'].map((sv) => `<label class="fchip ${sv}"><input type="checkbox" value="${sv}" checked><span>${sv}</span><b>${result.stats[sv]}</b></label>`).join('')}
          <select class="cat-filter" aria-label="Category"><option value="">All types</option>${cats.map((c) => `<option value="${c}">${CATEGORY_LABEL[c] || c}</option>`).join('')}</select>
        </div>
      </div>
      <div class="issue-list"></div>
      <p class="kbd-hint muted"><kbd>←</kbd><kbd>→</kbd> navigate · <kbd>F</kbd> needs fix · <kbd>A</kbd> approve · <kbd>N</kbd> next unreviewed · <kbd>1</kbd> <kbd>2</kbd> views · <kbd>Esc</kbd> clear</p>
    </aside>
  </div>`;
  const list = container.querySelector('.issue-list');
  let statuses = {};
  let viewer;

  const renderProgress = () => {
    const total = result.issues.length;
    const done = result.issues.filter((i) => statuses[i.id]).length;
    const fix = result.issues.filter((i) => statuses[i.id] === 'fix').length;
    const ok = done - fix;
    container.querySelector('.review-progress').innerHTML = `
      <div class="rp-bar" title="${done} of ${total} reviewed"><span class="rp-fix" style="width:${(fix / Math.max(1, total)) * 100}%"></span><span class="rp-ok" style="width:${(ok / Math.max(1, total)) * 100}%"></span></div>
      <div class="rp-text"><span><b>${done}</b> of ${total} reviewed${fix ? ` · <span class="t-fix">${fix} to fix</span>` : ''}${ok ? ` · <span class="t-ok">${ok} approved</span>` : ''}${done === total && total ? ' · <b>done</b> ✓' : ''}</span>
        ${done < total ? `<button type="button" class="btn tiny rp-next" title="Jump to the next issue nobody has reviewed (N)">${done ? 'Next unreviewed' : 'Start review'} →</button>` : ''}</div>`;
    container.querySelector('.rp-next')?.addEventListener('click', nextUnreviewed); // eslint-disable-line no-use-before-define
  };

  // first issue (in list order) without a decision, starting after the selected one
  function nextUnreviewed() {
    const order = viewer.visibleOrder();
    const from = order.indexOf(viewer.selected);
    const next = [...order.slice(from + 1), ...order.slice(0, from + 1)].find((id) => !statuses[id]);
    if (next) select(next, 'viewer'); // eslint-disable-line no-use-before-define
  }

  const openBody = (el, iid) => {
    const bodyEl = el.querySelector('.issue-body');
    bodyEl.innerHTML = issueBody(report, result, result.issues.find((i) => i.id === iid), statuses[iid] || null);
    bodyEl.querySelectorAll('.copy').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy, b)));
    bodyEl.querySelectorAll('.rv').forEach((b) => b.addEventListener('click', () => setStatus(iid, b.dataset.status))); // eslint-disable-line no-use-before-define
    bodyEl.querySelector('.show-all')?.addEventListener('click', (e) => {
      e.preventDefault();
      const insp = bodyEl.querySelector('.inspector');
      insp.classList.toggle('all');
      e.target.textContent = insp.classList.contains('all') ? 'Only differences' : 'Show all';
    });
  };

  const select = (iid, from) => {
    list.querySelectorAll('.issue').forEach((el) => {
      const open = el.dataset.id === iid;
      el.classList.toggle('open', open);
      el.querySelector('.issue-row').setAttribute('aria-expanded', String(open));
      if (open) openBody(el, iid);
    });
    viewer.select(iid);
    if (iid && from !== 'list') list.querySelector(`[data-id="${CSS.escape(iid)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  viewer = new Viewer(container.querySelector('.viewer'), report, result, select, { onWidthChange });

  const applyFilters = () => {
    const sev = [...container.querySelectorAll('.filters input[type=checkbox][value]:checked')].map((x) => x.value);
    const cat = container.querySelector('.cat-filter').value;
    const shown = result.issues
      .filter((i) => sev.includes(i.severity) && (!cat || i.category === cat))
      .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.n - b.n);
    viewer.order = shown.map((i) => i.id);
    viewer.visibleIds = new Set(viewer.order);
    viewer.statuses = statuses;
    list.innerHTML = shown.length
      ? ['high', 'medium', 'low'].map((sv) => {
        const group = shown.filter((i) => i.severity === sv);
        return group.length ? `<h3 class="group ${sv}">${sv} <span>${group.length}</span></h3>${group.map((i) => issueRow(i, statuses[i.id])).join('')}` : '';
      }).join('')
      : '<p class="muted pad">No issues match the filters.</p>';
    list.querySelectorAll('.issue-row').forEach((row) => row.addEventListener('click', () => {
      const iid = row.closest('.issue').dataset.id;
      select(viewer.selected === iid ? null : iid, 'list');
    }));
    if (viewer.selected && viewer.visibleIds.has(viewer.selected)) {
      const el = list.querySelector(`[data-id="${CSS.escape(viewer.selected)}"]`);
      el.classList.add('open');
      openBody(el, viewer.selected);
      viewer.drawMarks();
    } else if (viewer.selected) select(null);
    else viewer.drawMarks();
    renderProgress();
  };

  // Chromatic-style: decide, then move on to the next issue nobody has reviewed yet
  function setStatus(iid, status) {
    if (!iid) return;
    if (statuses[iid] === status) delete statuses[iid]; else statuses[iid] = status;
    saveReview(report.id, statuses);
    const order = viewer.visibleOrder();
    const from = order.indexOf(iid);
    const next = statuses[iid] ? [...order.slice(from + 1), ...order.slice(0, from)].find((id) => !statuses[id]) : iid;
    applyFilters();
    if (next && next !== iid) select(next, 'viewer');
    else select(iid, 'viewer');
  }

  container.querySelectorAll('.filters input, .filters select').forEach((x) => x.addEventListener('input', applyFilters));
  applyFilters();
  getReview(report.id).then((s) => { statuses = s; applyFilters(); });

  const keyHandler = (e) => {
    if (e.target.closest?.('input, select, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!container.isConnected) return;
    const k = e.key.toLowerCase();
    if (k === 'arrowright' || k === 'arrowdown' || k === 'j') { e.preventDefault(); viewer.step(1); }
    if (k === 'arrowleft' || k === 'arrowup' || k === 'k') { e.preventDefault(); viewer.step(-1); }
    if (k === 'escape') select(null);
    if (k === 'f') setStatus(viewer.selected, 'fix');
    if (k === 'a') setStatus(viewer.selected, 'ok');
    if (k === 'n') nextUnreviewed();
    const modes = MODES.map(([m]) => m).filter((m) => m !== 'strip' || onWidthChange);
    if (/^[1-2]$/.test(k) && modes[Number(k) - 1]) viewer.setMode(modes[Number(k) - 1]);
  };
  document.addEventListener('keydown', keyHandler);
  if (focusId) setTimeout(() => select(focusId, 'viewer'), 300);
  return {
    select: (id) => select(id, 'viewer'),
    destroy: () => {
      document.removeEventListener('keydown', keyHandler);
      viewer.resizeObs?.disconnect();
    },
  };
}
