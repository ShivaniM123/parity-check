const app = document.getElementById('app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const api = async (path, body) => {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
};
const hostOf = (u) => { try { return u ? new URL(u).host : ''; } catch (e) { return ''; } };
const SEV_ORDER = { high: 0, medium: 1, low: 2 };
const CATEGORY_LABEL = {
  layout: 'Layout', typography: 'Typography', color: 'Color', spacing: 'Spacing', content: 'Content', image: 'Image', responsive: 'Responsive', component: 'Component', page: 'Page',
};

function testWidths(bps, { base, edges, wide }, extra = []) {
  const set = new Set(extra);
  const sorted = [...bps].sort((a, b) => a - b);
  if (base) set.add(sorted.length && sorted[0] <= 375 ? 320 : 375);
  sorted.forEach((b) => { set.add(b); if (edges) set.add(b - 1); });
  if (wide && (!sorted.length || sorted[sorted.length - 1] < 1366)) set.add(1440);
  return [...set].filter((w) => w >= 280).sort((a, b) => a - b);
}

async function copy(text, btn) {
  await navigator.clipboard.writeText(text);
  const old = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = old; }, 1200);
}

function scoreClass(score) {
  if (score >= 85) return 'good';
  if (score >= 65) return 'fair';
  return 'poor';
}

function historyItems(list) {
  if (!list.length) return '<p class="muted">No comparisons yet.</p>';
  return list.map((r) => `
    <a class="history-item" href="#/report/${esc(r.id)}">
      <span class="score-pill ${scoreClass(r.summary?.score ?? 0)}">${r.summary?.score ?? '–'}</span>
      <span class="hi-main">
        <span class="hi-urls">${esc(r.original)}<br><span class="muted">→ ${esc(r.migrated)}</span></span>
        <span class="hi-meta">${new Date(r.created).toLocaleString()} · ${r.widths.join(', ')}px
          · <b class="txt-high">${r.summary?.high ?? 0}</b> / <b class="txt-medium">${r.summary?.medium ?? 0}</b> / <b class="txt-low">${r.summary?.low ?? 0}</b></span>
      </span>
    </a>`).join('');
}

/* ------------------------------------------------------------------ setup */

async function renderSetup(prefill = {}) {
  app.innerHTML = '';
  app.append(document.getElementById('tpl-setup').content.cloneNode(true));
  const form = document.getElementById('setup-form');
  const state = {
    breakpoints: [], clusters: [], extra: [], opts: { base: true, edges: false, wide: true },
  };
  let sites = {};
  try { sites = await api('/api/sites'); } catch (e) { /* none saved */ }

  const els = {
    chips: document.getElementById('bp-chips'),
    chart: document.getElementById('bp-chart'),
    widths: document.getElementById('width-chips'),
    status: document.getElementById('detect-status'),
    hint: document.getElementById('site-hint'),
  };

  const renderChart = () => {
    if (!state.clusters.length) { els.chart.hidden = true; return; }
    els.chart.hidden = false;
    const max = Math.max(...state.clusters.map((c) => c.count));
    els.chart.innerHTML = `<p class="muted">Media-query boundaries found in the original's CSS. Click a bar to include or exclude it.</p>
      <div class="bars">${state.clusters.map((c) => `
        <button type="button" class="bar ${state.breakpoints.includes(c.px) ? 'on' : ''}" data-px="${c.px}" title="${c.count} media rule(s) switch at ${c.px}px">
          <span class="bar-fill" style="height:${Math.max(8, (c.count / max) * 100)}%"></span>
          <span class="bar-label">${c.px}</span><span class="bar-count">${c.count}</span>
        </button>`).join('')}</div>`;
    els.chart.querySelectorAll('.bar').forEach((b) => b.addEventListener('click', () => {
      const v = Number(b.dataset.px);
      state.breakpoints = state.breakpoints.includes(v) ? state.breakpoints.filter((x) => x !== v) : [...state.breakpoints, v];
      render();
    }));
  };
  const renderChips = () => {
    const bps = [...state.breakpoints].sort((a, b) => a - b);
    els.chips.innerHTML = bps.length
      ? bps.map((b) => `<span class="chip">${b}px<button type="button" aria-label="Remove ${b}" data-bp="${b}">×</button></span>`).join('')
      : '<span class="muted">No breakpoints yet. Detect them from the original page or add them by hand.</span>';
    els.chips.querySelectorAll('[data-bp]').forEach((x) => x.addEventListener('click', () => {
      state.breakpoints = state.breakpoints.filter((b) => b !== Number(x.dataset.bp));
      render();
    }));
    const widths = testWidths(state.breakpoints, state.opts, state.extra);
    els.widths.innerHTML = widths.map((w) => `<span class="chip width ${state.extra.includes(w) ? 'extra' : ''}">${w}px${state.extra.includes(w) ? `<button type="button" data-w="${w}" aria-label="Remove ${w}">×</button>` : ''}</span>`).join('');
    els.widths.querySelectorAll('[data-w]').forEach((x) => x.addEventListener('click', () => {
      state.extra = state.extra.filter((w) => w !== Number(x.dataset.w));
      render();
    }));
  };
  function render() { renderChart(); renderChips(); }

  const applySite = () => {
    const host = hostOf(form.original.value);
    const saved = sites[host];
    if (saved && !state.touched) {
      state.breakpoints = saved.breakpoints || [];
      state.extra = saved.extraWidths || [];
      state.opts = { ...state.opts, ...(saved.widthOptions || {}) };
      ['base', 'edges', 'wide'].forEach((k) => { document.getElementById(`w-${k}`).checked = state.opts[k]; });
      if (saved.hideSelectors?.length) form.hide.value = saved.hideSelectors.join('\n');
      els.hint.innerHTML = `Loaded saved breakpoints for <b>${esc(host)}</b> (${new Date(saved.updated).toLocaleDateString()}).`;
      render();
    } else if (!saved) {
      els.hint.textContent = host ? `No saved breakpoints for ${host} yet.` : '';
    }
  };
  form.original.addEventListener('change', applySite);

  document.getElementById('detect').addEventListener('click', async () => {
    if (!form.original.value) { form.original.reportValidity(); return; }
    els.status.textContent = 'Reading stylesheets…';
    els.status.className = 'status busy';
    try {
      const det = await api('/api/breakpoints', { url: form.original.value });
      state.clusters = det.clusters;
      state.breakpoints = det.suggested;
      state.touched = true;
      els.status.textContent = `${det.mediaRules} media rules in ${det.stylesheets} stylesheets → ${det.suggested.length} breakpoints`;
      els.status.className = 'status ok';
      render();
    } catch (e) {
      els.status.textContent = e.message;
      els.status.className = 'status err';
    }
  });
  const addNum = (inputId, list) => {
    const input = document.getElementById(inputId);
    const v = Number(input.value);
    if (v >= 280 && v <= 3840 && !state[list].includes(v)) {
      state[list] = [...state[list], v];
      state.touched = true;
    }
    input.value = '';
    render();
  };
  document.getElementById('bp-add-btn').addEventListener('click', () => addNum('bp-add', 'breakpoints'));
  document.getElementById('w-add-btn').addEventListener('click', () => addNum('w-add', 'extra'));
  ['bp-add', 'w-add'].forEach((id) => document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addNum(id, id === 'bp-add' ? 'breakpoints' : 'extra'); }
  }));
  ['base', 'edges', 'wide'].forEach((k) => document.getElementById(`w-${k}`).addEventListener('change', (e) => {
    state.opts[k] = e.target.checked;
    render();
  }));

  const hideList = () => form.hide.value.split('\n').map((s) => s.trim()).filter(Boolean);
  document.getElementById('save-site').addEventListener('click', async () => {
    const host = hostOf(form.original.value);
    if (!host) { form.original.reportValidity(); return; }
    sites[host] = await api('/api/sites', {
      host, breakpoints: state.breakpoints, widthOptions: state.opts, extraWidths: state.extra, hideSelectors: hideList(),
    });
    els.hint.innerHTML = `Saved breakpoints for <b>${esc(host)}</b>. They load automatically next time.`;
  });
  document.getElementById('demo').addEventListener('click', () => {
    form.original.value = `${window.location.origin}/demo/original.html`;
    form.migrated.value = `${window.location.origin}/demo/migrated.html`;
    state.touched = false;
    els.hint.textContent = 'Demo: a legacy page and an EDS migration with deliberate differences. Click “Detect from original”.';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const widths = testWidths(state.breakpoints, state.opts, state.extra);
    if (!widths.length) { els.status.textContent = 'Add at least one breakpoint or width.'; return; }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const { id } = await api('/api/jobs', {
        original: form.original.value,
        migrated: form.migrated.value,
        breakpoints: state.breakpoints,
        widths,
        options: {
          hideSelectors: hideList(),
          maxHeight: Number(form.maxHeight.value),
          waitMs: Number(form.waitMs.value),
          pixelThreshold: Number(form.pixelThreshold.value),
        },
      });
      window.location.hash = `#/job/${id}`;
    } catch (err) {
      els.status.textContent = err.message;
      els.status.className = 'status err';
      btn.disabled = false;
    }
  });

  if (prefill.original) form.original.value = prefill.original;
  if (prefill.migrated) form.migrated.value = prefill.migrated;
  if (prefill.breakpoints) { state.breakpoints = prefill.breakpoints; state.touched = true; }
  if (prefill.extra) state.extra = prefill.extra;
  applySite();
  render();
  api('/api/reports').then((list) => {
    document.getElementById('recent-list').innerHTML = historyItems(list.slice(0, 8));
  });
}

/* ---------------------------------------------------------------- progress */

function renderJob(id) {
  app.innerHTML = `<section class="card progress-card">
    <h1>Comparing…</h1>
    <div class="progress"><span id="bar"></span></div>
    <ol class="log" id="log"></ol>
  </section>`;
  const bar = document.getElementById('bar');
  const log = document.getElementById('log');
  const es = new EventSource(`/api/jobs/${id}/events`);
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'log') {
      bar.style.width = `${msg.progress}%`;
      log.insertAdjacentHTML('beforeend', `<li>${esc(msg.message)}</li>`);
      log.scrollTop = log.scrollHeight;
    }
    if (msg.type === 'status') {
      es.close();
      if (msg.status === 'done') window.location.hash = `#/report/${id}`;
      else log.insertAdjacentHTML('beforeend', `<li class="err">Failed: ${esc(msg.error)}</li>`);
    }
  };
  es.onerror = () => {
    es.close();
    log.insertAdjacentHTML('beforeend', '<li class="err">Lost connection to the server.</li>');
  };
}

/* ------------------------------------------------------------------ report */

function issueKey(i) {
  return [i.category, i.property, i.fix?.selector || i.m?.selector || i.o?.selector || '', i.title.replace(/\d+(\.\d+)?px/g, '#')].join('|');
}

function rectsFor(issue, side) {
  if (side === 'o') return (issue.oRects?.length ? issue.oRects : [issue.o?.rect]).filter(Boolean);
  return (issue.m?.rects?.length ? issue.m.rects : [issue.m?.rect]).filter(Boolean);
}

/**
 * Close-up of one screenshot around the issue's element. Pure CSS cropping:
 * percentages for x/width, margin/padding percentages (relative to width) for y/height.
 */
function cropHtml(report, result, issue, side) {
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

function fixHtml(fix) {
  if (!fix) return '';
  const file = fix.file ? `<code class="file ${fix.exists === false ? 'new' : ''}">${esc(fix.file)}${fix.exists === false ? ' · new file' : ''}</code>` : '';
  const code = fix.css ? `<div class="code"><pre>${esc(fix.css)}</pre><button type="button" class="btn tiny copy" data-copy="${esc(fix.css)}">Copy</button></div>` : '';
  const note = fix.note ? `<p class="note">${esc(fix.note)}</p>` : '';
  if (!file && !code && !note) return '';
  return `<section class="fix"><h4>How to fix ${file}</h4>${code}${note}</section>`;
}

function compareHtml(i) {
  if (!i.ov && !i.mv) return '';
  const cell = (v, sw) => (v ? `${sw ? `<i class="sw" style="background:${esc(sw)}"></i>` : ''}<code>${esc(v)}</code>` : '<span class="muted">–</span>');
  return `<div class="compare">
    <div class="cmp o"><span>Original</span>${cell(i.ov, i.swatch?.[0])}</div>
    <div class="cmp-arrow" aria-hidden="true">→</div>
    <div class="cmp m"><span>Migrated</span>${cell(i.mv, i.swatch?.[1])}</div>
  </div>`;
}

function issueBody(report, result, i) {
  const hasRect = rectsFor(i, 'o').length || rectsFor(i, 'm').length;
  return `<p class="detail">${esc(i.detail)}</p>
    ${hasRect ? `<div class="crops">${cropHtml(report, result, i, 'o')}${cropHtml(report, result, i, 'm')}</div>` : ''}
    ${compareHtml(i)}
    ${i.m?.selector ? `<p class="where"><span>Element</span><code>${esc(i.m.selector)}</code></p>` : ''}
    ${fixHtml(i.fix)}`;
}

function issueRow(i) {
  return `<article class="issue sev-${i.severity}" data-id="${esc(i.id)}">
    <button type="button" class="issue-row" aria-expanded="false">
      <span class="pin-ref">${i.n}</span>
      <span class="issue-title">${esc(i.title)}</span>
      <span class="cat-tag">${CATEGORY_LABEL[i.category] || i.category}${i.count > 1 ? ` · ${i.count}×` : ''}</span>
    </button>
    <div class="issue-body"></div>
  </article>`;
}

const SEV_RANK = { high: 3, medium: 2, low: 1 };

class Viewer {
  constructor(root, report, result, onSelect) {
    this.root = root;
    this.report = report;
    this.result = result;
    this.onSelect = onSelect;
    this.mode = 'side';
    this.showPins = true;
    this.zoom = 'fit';
    this.selected = null;
    this.order = result.issues.map((i) => i.id);
    this.visibleIds = new Set(this.order);
    this.render();
  }

  src(kind) { return `/reports/${this.report.id}/${this.result.shots[kind]}`; }

  issue(id) { return this.result.issues.find((i) => i.id === id); }

  render() {
    const r = this.result;
    const titles = {
      overlay: 'Migrated on top of original', swipe: 'Original ◀ drag ▶ Migrated', diff: 'Pixels that differ are red',
    };
    this.root.innerHTML = `
      <div class="viewer-bar">
        <div class="seg" role="tablist" aria-label="View mode">
          ${[['side', 'Side by side'], ['overlay', 'Overlay'], ['swipe', 'Swipe'], ['diff', 'Pixel diff']].map(([k, l]) => `<button type="button" data-mode="${k}" class="${this.mode === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>
        <label class="ctl" data-for="overlay">Opacity <input type="range" id="opacity" min="0" max="100" value="50"></label>
        <label class="ctl" data-for="swipe">Position <input type="range" id="swipe" min="0" max="100" value="50"></label>
        <div class="nav-issues">
          <button type="button" class="btn tiny" id="prev" title="Previous issue (←)">‹ Prev</button>
          <span id="nav-pos" class="muted"></span>
          <button type="button" class="btn tiny" id="next" title="Next issue (→)">Next ›</button>
        </div>
        <label class="ctl"><input type="checkbox" id="pins" ${this.showPins ? 'checked' : ''}> Pins</label>
        <select id="zoom" class="ctl" aria-label="Zoom"><option value="fit">Fit</option><option value="1">100%</option><option value="0.5">50%</option></select>
      </div>
      <div class="stage mode-${this.mode}">
        ${this.mode === 'side' ? ['o', 'm'].map((s) => `
          <div class="pane" data-side="${s}">
            <div class="pane-title ${s}"><b>${s === 'o' ? 'Original' : 'Migrated'}</b><span>${r.width}px${r.page[s].truncated ? ' · truncated' : ''}</span></div>
            <div class="scroller"><div class="canvas"><img src="${this.src(s)}" alt="${s === 'o' ? 'Original' : 'Migrated'} at ${r.width}px"><div class="marks"></div></div></div>
          </div>`).join('') : `
          <div class="pane single" data-side="m">
            <div class="pane-title"><b>${titles[this.mode]}</b><span>${r.width}px</span></div>
            <div class="scroller"><div class="canvas">
              ${this.mode === 'diff' ? `<img src="${this.src('d')}" alt="Pixel diff">` : `<img src="${this.src('o')}" alt="Original"><img class="top" src="${this.src('m')}" alt="Migrated">`}
              ${this.mode === 'swipe' ? '<div class="swipe-line"></div>' : ''}
              <div class="marks"></div></div></div>
          </div>`}
      </div>`;
    this.root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      this.mode = b.dataset.mode;
      this.render();
      if (this.selected) setTimeout(() => this.select(this.selected), 50);
    }));
    this.root.querySelectorAll('.ctl[data-for]').forEach((c) => { c.hidden = c.dataset.for !== this.mode; });
    this.root.querySelector('#pins').addEventListener('change', (e) => { this.showPins = e.target.checked; this.drawMarks(); });
    this.root.querySelector('#prev').addEventListener('click', () => this.step(-1));
    this.root.querySelector('#next').addEventListener('click', () => this.step(1));
    const zoom = this.root.querySelector('#zoom');
    zoom.value = this.zoom;
    zoom.addEventListener('change', () => { this.zoom = zoom.value; this.applyZoom(); });
    const top = this.root.querySelector('img.top');
    const opacity = this.root.querySelector('#opacity');
    const swipe = this.root.querySelector('#swipe');
    if (this.mode === 'overlay' && top) {
      top.style.opacity = opacity.value / 100;
      opacity.addEventListener('input', () => { top.style.opacity = opacity.value / 100; });
    }
    if (this.mode === 'swipe' && top) {
      const line = this.root.querySelector('.swipe-line');
      const apply = () => {
        top.style.clipPath = `inset(0 0 0 ${swipe.value}%)`;
        line.style.left = `${swipe.value}%`;
      };
      apply();
      swipe.addEventListener('input', apply);
    }
    // proportional scroll sync (pages can differ in height); paused while jumping to an issue
    const scrollers = [...this.root.querySelectorAll('.scroller')];
    if (scrollers.length === 2) {
      let lock = false;
      scrollers.forEach((s, idx) => s.addEventListener('scroll', () => {
        if (lock || this.jumping) return;
        lock = true;
        const other = scrollers[1 - idx];
        const ratio = s.scrollTop / Math.max(1, s.scrollHeight - s.clientHeight);
        other.scrollTop = ratio * (other.scrollHeight - other.clientHeight);
        requestAnimationFrame(() => { lock = false; });
      }));
    }
    // clicking empty screenshot area clears the selection
    this.root.querySelectorAll('.canvas').forEach((c) => c.addEventListener('click', (e) => {
      if (!e.target.closest('.pin, .focus-label')) this.onSelect(null);
    }));
    this.root.querySelectorAll('img').forEach((img) => img.addEventListener('load', () => this.drawMarks()));
    if (!this.resizeObs) this.resizeObs = new ResizeObserver(() => this.drawMarks());
    this.resizeObs.disconnect();
    this.root.querySelectorAll('.canvas').forEach((c) => this.resizeObs.observe(c));
    this.applyZoom();
    this.updateNav();
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

  drawMarks() {
    this.root.querySelectorAll('.pane').forEach((pane) => {
      const marks = pane.querySelector('.marks');
      const img = pane.querySelector('img');
      if (!img || !img.naturalWidth) return;
      const scale = img.clientWidth / img.naturalWidth;
      const side = this.mode === 'side' ? pane.dataset.side : 'm';
      const box = (r, cls, extra = '') => `<div class="${cls}" ${extra} style="left:${r.x * scale}px;top:${r.y * scale}px;width:${Math.max(4, r.w * scale)}px;height:${Math.max(4, r.h * scale)}px"></div>`;
      let html = '';
      const sel = this.selected && this.issue(this.selected);
      if (this.mode === 'diff' && !sel) {
        html += this.result.regions.map((g) => box(g, 'hotspot')).join('');
      }
      if (sel) {
        const rects = rectsFor(sel, side);
        if (rects.length) {
          const [first, ...rest] = rects;
          const expected = side === 'm' && sel.m?.expected;
          html += box(first, `focus sev-${sel.severity} ${expected ? 'expected' : ''}`);
          html += rest.map((r) => box(r, `also sev-${sel.severity}`)).join('');
          const below = first.y * scale < 34;
          html += `<div class="focus-label sev-${sel.severity} ${below ? 'below' : ''}" style="left:${first.x * scale}px;top:${(below ? first.y + first.h : first.y) * scale}px">
            <b>${sel.n}</b>${esc(expected ? 'Missing here' : sel.title)}</div>`;
        } else {
          html += `<div class="pane-note">${side === 'o' ? 'Not on the original page' : 'Not on the migrated page'}</div>`;
        }
      }
      if (this.showPins && !sel) { // focus mode shows the label instead of pins
        // keep pins inside the frame and nudge pins that would overlap
        const placed = [];
        const maxX = img.clientWidth - 14;
        html += this.pinsFor(side).map((raw) => {
          const p = { ...raw, x: Math.min(maxX, Math.max(12, raw.x * scale)), y: Math.max(12, raw.y * scale) };
          while (placed.some((q) => Math.abs(q.x - p.x) < 26 && Math.abs(q.y - p.y) < 22)) p.x += 28;
          placed.push(p);
          return p;
        }).map((p) => {
          const worst = p.issues.reduce((a, b) => (SEV_RANK[b.severity] > SEV_RANK[a.severity] ? b : a));
          const isOn = sel && p.issues.includes(sel);
          if (sel && !isOn) return ''; // focus mode: only the selected pin
          const title = p.issues.map((i) => `${i.n}. ${i.title}`).join('\n');
          return `<button type="button" class="pin sev-${worst.severity} ${isOn ? 'on' : ''}" data-ids="${p.issues.map((i) => esc(i.id)).join(',')}"
            style="left:${p.x}px;top:${p.y}px" title="${esc(title)}">${isOn ? sel.n : p.issues[0].n}${p.issues.length > 1 ? `<small>+${p.issues.length - 1}</small>` : ''}</button>`;
        }).join('');
      }
      marks.innerHTML = html;
      marks.querySelectorAll('.pin').forEach((pin) => {
        const ids = pin.dataset.ids.split(',');
        pin.addEventListener('click', (e) => {
          e.stopPropagation();
          // clicking a shared pin again cycles through its issues
          const idx = ids.indexOf(this.selected);
          this.onSelect(ids[(idx + 1) % ids.length], 'viewer');
        });
        pin.addEventListener('mouseenter', () => {
          if (this.selected) return;
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
    if (!issue) return;
    this.jumping = true;
    clearTimeout(this.jumpTimer);
    this.jumpTimer = setTimeout(() => { this.jumping = false; }, 700);
    this.root.querySelectorAll('.pane').forEach((pane) => {
      const side = this.mode === 'side' ? pane.dataset.side : 'm';
      const rc = rectsFor(issue, side)[0] || rectsFor(issue, side === 'm' ? 'o' : 'm')[0];
      const img = pane.querySelector('img');
      if (!rc || !img?.naturalWidth) return;
      const scale = img.clientWidth / img.naturalWidth;
      const scroller = pane.querySelector('.scroller');
      const h = rc.h * scale;
      const top = h < scroller.clientHeight - 120 ? rc.y * scale - (scroller.clientHeight - h) / 2 : rc.y * scale - 60;
      scroller.scrollTo({ top: Math.max(0, top), left: Math.max(0, rc.x * scale - 40), behavior: 'smooth' });
    });
  }
}

function matrixHtml(report) {
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

function fixesHtml(report) {
  if (!report.fixes?.length) return '<p class="muted">No CSS fixes. Remaining issues are about content.</p>';
  const all = report.fixes.map((f) => `/* ===== ${f.file} ===== */\n${f.css}`).join('\n\n');
  return `<div class="fixes-head"><p>Fixes from every breakpoint, merged per file. A media query is added only where a fix isn't needed at every width, and it uses the original site's breakpoints.</p>
    <button type="button" class="btn secondary copy" data-copy="${esc(all)}">Copy all</button></div>
    ${report.fixes.map((f) => `<section class="file-fix">
      <header><code>${esc(f.file)}</code>${f.exists === false ? '<span class="badge low">new file</span>' : ''}<span class="muted">${f.issues} issue${f.issues > 1 ? 's' : ''}</span>
      <button type="button" class="btn tiny copy" data-copy="${esc(f.css)}">Copy</button></header>
      <pre>${esc(f.css)}</pre></section>`).join('')}`;
}

async function renderReport(id, params) {
  app.innerHTML = '<p class="loading">Loading report…</p>';
  let report;
  try {
    report = await (await fetch(`/reports/${id}/report.json`)).json();
  } catch (e) {
    app.innerHTML = '<p class="err">Report not found.</p>';
    return;
  }
  const s = report.summary;
  const mismatch = report.breakpointMismatch;
  const showMismatch = mismatch && (mismatch.missingInMigrated.length || mismatch.extraInMigrated.length);
  const tabs = [...report.results.map((r) => ({ key: String(r.width), r })), { key: 'matrix' }, { key: 'fixes' }];
  let current = params.get('tab') || String(report.results[0]?.width);

  app.innerHTML = `
    <section class="report-head card">
      <div class="score-ring ${scoreClass(s.score)}" style="--v:${s.score}"><b>${s.score}</b><span>parity</span></div>
      <div class="rh-main">
        <div class="rh-urls">
          <div><span class="lbl o">Original</span><a href="${esc(report.original)}" target="_blank" rel="noopener">${esc(report.original)}</a></div>
          <div><span class="lbl m">Migrated</span><a href="${esc(report.migrated)}" target="_blank" rel="noopener">${esc(report.migrated)}</a></div>
        </div>
        <div class="rh-stats">
          <span class="stat high"><b>${s.high}</b> high</span><span class="stat medium"><b>${s.medium}</b> medium</span><span class="stat low"><b>${s.low}</b> low</span>
          <span class="muted">Breakpoints ${report.breakpoints.join(', ') || '–'} · tested ${report.widths.join(', ')}px</span>
        </div>
      </div>
      <div class="rh-actions">
        <a class="btn ghost" href="/reports/${esc(report.id)}/report.json" download>Download JSON</a>
        <button type="button" class="btn secondary" id="rerun">Re-run</button>
      </div>
    </section>
    ${showMismatch ? `<div class="banner"><b>Breakpoints don't match.</b>
      ${mismatch.missingInMigrated.length ? `Original changes layout at <b>${mismatch.missingInMigrated.join(', ')}px</b>, but migrated doesn't.` : ''}
      ${mismatch.extraInMigrated.length ? `Migrated changes layout at <b>${mismatch.extraInMigrated.join(', ')}px</b>, but original doesn't.` : ''}
      <button type="button" class="btn tiny" id="rerun-edges">Re-run at these widths</button></div>` : ''}
    <nav class="tabs">${tabs.map((t) => (t.r
    ? `<button type="button" data-tab="${t.key}"><b>${t.r.width}px</b><span class="score-pill sm ${scoreClass(t.r.score)}">${t.r.score}</span>${t.r.stats.high ? `<span class="tc high">${t.r.stats.high}</span>` : ''}</button>`
    : `<button type="button" data-tab="${t.key}" class="aux"><b>${t.key === 'matrix' ? 'Across breakpoints' : 'All fixes'}</b></button>`)).join('')}</nav>
    <section id="tab-body"></section>`;

  const body = document.getElementById('tab-body');
  const rerun = (extra = []) => {
    const q = new URLSearchParams({ original: report.original, migrated: report.migrated, bps: report.breakpoints.join(','), extra: extra.join(',') });
    window.location.hash = `#/new?${q}`;
  };
  document.getElementById('rerun').addEventListener('click', () => rerun());
  document.getElementById('rerun-edges')?.addEventListener('click', () => {
    const extra = new Set();
    [...mismatch.missingInMigrated, ...mismatch.extraInMigrated].forEach((b) => { extra.add(b - 1); extra.add(b); });
    rerun([...extra]);
  });

  let viewer;
  let keyHandler;
  const showTab = (key, focusId) => {
    current = key;
    app.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === key));
    const url = new URL(window.location.href);
    url.hash = `#/report/${id}?${new URLSearchParams({ tab: key })}`;
    window.history.replaceState(null, '', url);
    if (keyHandler) document.removeEventListener('keydown', keyHandler);
    if (key === 'matrix') {
      body.innerHTML = `<div class="card">${matrixHtml(report)}</div>`;
      body.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        showTab(a.dataset.goto.split('-')[0], a.dataset.goto);
      }));
      return;
    }
    if (key === 'fixes') {
      body.innerHTML = `<div class="card fixes">${fixesHtml(report)}</div>`;
      body.querySelectorAll('.copy').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy, b)));
      return;
    }
    const result = report.results.find((r) => String(r.width) === key);
    if (!result) return;
    const cats = [...new Set(result.issues.map((i) => i.category))];
    body.innerHTML = `<div class="workspace">
      <div class="viewer card" id="viewer"></div>
      <aside class="issues card">
        <div class="issues-head">
          <div class="ih-top"><h2>${result.issues.length} issues at ${result.width}px</h2>
            <span class="muted" title="Pixel match · elements matched">${result.stats.similarity}% pixels · ${result.stats.matchRate}% elements</span></div>
          <div class="filters">
            ${['high', 'medium', 'low'].map((sv) => `<label class="fchip ${sv}"><input type="checkbox" value="${sv}" checked><span>${sv}</span><b>${result.stats[sv]}</b></label>`).join('')}
            <select id="cat" aria-label="Category"><option value="">All types</option>${cats.map((c) => `<option value="${c}">${CATEGORY_LABEL[c] || c}</option>`).join('')}</select>
          </div>
        </div>
        <div class="issue-list" id="issue-list"></div>
        <p class="kbd-hint muted">← → step through issues · Esc to clear</p>
      </aside>
    </div>`;
    const list = document.getElementById('issue-list');
    const select = (iid, from) => {
      list.querySelectorAll('.issue').forEach((el) => {
        const open = el.dataset.id === iid;
        el.classList.toggle('open', open);
        el.querySelector('.issue-row').setAttribute('aria-expanded', String(open));
        const bodyEl = el.querySelector('.issue-body');
        if (open && !bodyEl.innerHTML) {
          bodyEl.innerHTML = issueBody(report, result, result.issues.find((i) => i.id === iid));
          bodyEl.querySelectorAll('.copy').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy, b)));
        }
      });
      viewer.select(iid);
      if (iid && from !== 'list') list.querySelector(`[data-id="${CSS.escape(iid)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    viewer = new Viewer(document.getElementById('viewer'), report, result, select);
    const applyFilters = () => {
      const sev = [...body.querySelectorAll('.filters input[type=checkbox]:checked')].map((x) => x.value);
      const cat = body.querySelector('#cat').value;
      const shown = result.issues
        .filter((i) => sev.includes(i.severity) && (!cat || i.category === cat))
        .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.n - b.n);
      viewer.order = shown.map((i) => i.id);
      viewer.visibleIds = new Set(viewer.order);
      list.innerHTML = shown.length
        ? ['high', 'medium', 'low'].map((sv) => {
          const group = shown.filter((i) => i.severity === sv);
          return group.length ? `<h3 class="group ${sv}">${sv} <span>${group.length}</span></h3>${group.map(issueRow).join('')}` : '';
        }).join('')
        : '<p class="muted pad">No issues match the filters.</p>';
      list.querySelectorAll('.issue-row').forEach((row) => row.addEventListener('click', () => {
        const iid = row.closest('.issue').dataset.id;
        select(viewer.selected === iid ? null : iid, 'list');
      }));
      if (viewer.selected && !viewer.visibleIds.has(viewer.selected)) select(null);
      else viewer.drawMarks();
    };
    body.querySelectorAll('.filters input, .filters select').forEach((x) => x.addEventListener('input', applyFilters));
    applyFilters();
    keyHandler = (e) => {
      if (e.target.closest?.('input, select, textarea')) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); viewer.step(1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); viewer.step(-1); }
      if (e.key === 'Escape') select(null);
    };
    document.addEventListener('keydown', keyHandler);
    if (focusId) setTimeout(() => select(focusId, 'viewer'), 300);
  };
  app.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  if (!tabs.some((t) => t.key === current)) current = tabs[0].key;
  showTab(current, params.get('issue'));
}

async function renderHistory() {
  app.innerHTML = '<section class="card"><h1>History</h1><div class="history-list" id="hl"><p class="muted">Loading…</p></div></section>';
  document.getElementById('hl').innerHTML = historyItems(await api('/api/reports'));
}

/* ------------------------------------------------------------------ router */

function route() {
  const [path, query] = window.location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query || '');
  const parts = (path || '/').split('/').filter(Boolean);
  if (parts[0] === 'job' && parts[1]) renderJob(parts[1]);
  else if (parts[0] === 'report' && parts[1]) renderReport(parts[1], params);
  else if (parts[0] === 'history') renderHistory();
  else {
    const num = (k) => (params.get(k) || '').split(',').map(Number).filter(Boolean);
    renderSetup({
      original: params.get('original'), migrated: params.get('migrated'), breakpoints: params.get('bps') ? num('bps') : null, extra: num('extra'),
    });
  }
}
let lastPath = null;
window.addEventListener('hashchange', () => {
  // tab switches only replace the query part of a report URL: don't re-render for those
  const path = window.location.hash.split('?')[0];
  if (path === lastPath && path.startsWith('#/report/')) return;
  lastPath = path;
  route();
});
[lastPath] = window.location.hash.split('?');
route();
