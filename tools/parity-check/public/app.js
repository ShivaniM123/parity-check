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
          · <b class="sev-high">${r.summary?.high ?? 0}</b> / <b class="sev-medium">${r.summary?.medium ?? 0}</b> / <b class="sev-low">${r.summary?.low ?? 0}</b></span>
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

function fixHtml(fix) {
  if (!fix) return '';
  const file = fix.file ? `<span class="file ${fix.exists === false ? 'new' : ''}" title="${fix.exists === false ? 'File does not exist yet' : ''}">${esc(fix.file)}${fix.exists === false ? ' (new)' : ''}</span>` : '';
  const code = fix.css ? `<div class="code"><pre>${esc(fix.css)}</pre><button type="button" class="btn tiny copy" data-copy="${esc(fix.css)}">Copy</button></div>` : '';
  const note = fix.note ? `<p class="note">${esc(fix.note)}</p>` : '';
  if (!file && !code && !note) return '';
  return `<div class="fix"><div class="fix-head">Recommended fix ${file}</div>${code}${note}</div>`;
}

function valueHtml(v, swatch) {
  if (!v) return '<span class="muted">–</span>';
  return `${swatch ? `<i class="sw" style="background:${esc(swatch)}"></i>` : ''}<code>${esc(v)}</code>`;
}

function issueCard(i) {
  return `<article class="issue sev-${i.severity}" data-id="${esc(i.id)}" tabindex="0">
    <header>
      <span class="num">${i.n}</span>
      <span class="badge ${i.severity}">${i.severity}</span>
      <span class="cat">${CATEGORY_LABEL[i.category] || i.category}</span>
      ${i.count > 1 ? `<span class="count">×${i.count}</span>` : ''}
    </header>
    <h3>${esc(i.title)}</h3>
    <p class="detail">${esc(i.detail)}</p>
    <dl class="values">
      <dt>Original</dt><dd>${valueHtml(i.ov, i.swatch?.[0])}</dd>
      <dt>Migrated</dt><dd>${valueHtml(i.mv, i.swatch?.[1])}</dd>
      ${i.m?.selector ? `<dt>Element</dt><dd><code class="sel">${esc(i.m.selector)}</code></dd>` : ''}
    </dl>
    ${fixHtml(i.fix)}
  </article>`;
}

function rectsFor(issue, side) {
  if (side === 'o') return (issue.oRects?.length ? issue.oRects : [issue.o?.rect]).filter(Boolean);
  return (issue.m?.rects?.length ? issue.m.rects : [issue.m?.rect]).filter(Boolean);
}

class Viewer {
  constructor(root, report, result, onSelect) {
    this.root = root;
    this.report = report;
    this.result = result;
    this.onSelect = onSelect;
    this.mode = 'side';
    this.showMarkers = true;
    this.zoom = 'fit';
    this.selected = null;
    this.visibleIds = new Set(result.issues.map((i) => i.id));
    this.render();
  }

  src(kind) { return `/reports/${this.report.id}/${this.result.shots[kind]}`; }

  render() {
    const r = this.result;
    this.root.innerHTML = `
      <div class="viewer-bar">
        <div class="seg" role="tablist">
          ${[['side', 'Side by side'], ['overlay', 'Overlay'], ['swipe', 'Swipe'], ['diff', 'Pixel diff']].map(([k, l]) => `<button type="button" data-mode="${k}" class="${this.mode === k ? 'on' : ''}">${l}</button>`).join('')}
        </div>
        <label class="ctl" data-for="overlay">Opacity <input type="range" id="opacity" min="0" max="100" value="50"></label>
        <label class="ctl" data-for="swipe">Position <input type="range" id="swipe" min="0" max="100" value="50"></label>
        <label class="ctl"><input type="checkbox" id="markers" ${this.showMarkers ? 'checked' : ''}> Markers</label>
        <label class="ctl" data-for="side"><input type="checkbox" id="sync" checked> Sync scroll</label>
        <select id="zoom" class="ctl"><option value="fit">Fit width</option><option value="1">100%</option><option value="0.5">50%</option></select>
      </div>
      <div class="stage mode-${this.mode}">
        ${this.mode === 'side' ? `
          <div class="pane" data-side="o"><div class="pane-title">Original · ${r.width}px${r.page.o.truncated ? ' · truncated' : ''}</div><div class="scroller"><div class="canvas"><img src="${this.src('o')}" alt="Original at ${r.width}px"><div class="marks"></div></div></div></div>
          <div class="pane" data-side="m"><div class="pane-title">Migrated · ${r.width}px${r.page.m.truncated ? ' · truncated' : ''}</div><div class="scroller"><div class="canvas"><img src="${this.src('m')}" alt="Migrated at ${r.width}px"><div class="marks"></div></div></div></div>`
    : `
          <div class="pane single" data-side="m"><div class="pane-title">${{ overlay: 'Migrated over original', swipe: 'Original | Migrated', diff: 'Changed pixels (red), with hotspots' }[this.mode]}</div><div class="scroller"><div class="canvas">
            ${this.mode === 'diff' ? `<img src="${this.src('d')}" alt="Pixel diff">` : `<img src="${this.src('o')}" alt="Original"><img class="top" src="${this.src('m')}" alt="Migrated">`}
            ${this.mode === 'swipe' ? '<div class="swipe-line"></div>' : ''}
            <div class="marks"></div></div></div></div>`}
      </div>`;
    this.root.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { this.mode = b.dataset.mode; this.render(); }));
    this.root.querySelectorAll('.ctl[data-for]').forEach((c) => { c.hidden = c.dataset.for !== this.mode; });
    this.root.querySelector('#markers').addEventListener('change', (e) => { this.showMarkers = e.target.checked; this.drawMarks(); });
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
    // synced scrolling (proportional, pages can differ in height)
    const scrollers = [...this.root.querySelectorAll('.scroller')];
    if (scrollers.length === 2) {
      let lock = false;
      scrollers.forEach((s, idx) => s.addEventListener('scroll', () => {
        if (lock || !this.root.querySelector('#sync').checked) return;
        lock = true;
        const other = scrollers[1 - idx];
        const ratio = s.scrollTop / Math.max(1, s.scrollHeight - s.clientHeight);
        other.scrollTop = ratio * (other.scrollHeight - other.clientHeight);
        requestAnimationFrame(() => { lock = false; });
      }));
    }
    this.root.querySelectorAll('img').forEach((img) => img.addEventListener('load', () => this.drawMarks()));
    this.applyZoom();
    if (!this.resizeObs) {
      this.resizeObs = new ResizeObserver(() => this.drawMarks());
    }
    this.resizeObs.disconnect();
    this.root.querySelectorAll('.canvas').forEach((c) => this.resizeObs.observe(c));
  }

  applyZoom() {
    this.root.querySelectorAll('.canvas').forEach((c) => {
      c.style.width = this.zoom === 'fit' ? '100%' : `${this.result.width * Number(this.zoom)}px`;
    });
    this.drawMarks();
  }

  drawMarks() {
    const panes = [...this.root.querySelectorAll('.pane')];
    panes.forEach((pane) => {
      const marks = pane.querySelector('.marks');
      const img = pane.querySelector('img');
      if (!img || !img.naturalWidth) return;
      const scale = img.clientWidth / img.naturalWidth;
      const side = this.mode === 'side' ? pane.dataset.side : 'm';
      let html = '';
      if (this.mode === 'diff') {
        html += this.result.regions.map((g) => `<div class="hotspot" style="left:${g.x * scale}px;top:${g.y * scale}px;width:${g.w * scale}px;height:${g.h * scale}px"></div>`).join('');
      }
      if (this.showMarkers) {
        this.result.issues.filter((i) => this.visibleIds.has(i.id)).forEach((i) => {
          rectsFor(i, side).forEach((rc, k) => {
            const expected = side === 'm' && i.m?.expected;
            html += `<div class="mark ${i.severity} ${this.selected === i.id ? 'sel' : ''} ${expected ? 'expected' : ''}" data-id="${esc(i.id)}"
              style="left:${rc.x * scale}px;top:${rc.y * scale}px;width:${Math.max(6, rc.w * scale)}px;height:${Math.max(6, rc.h * scale)}px"
              title="${esc(`${i.n}. ${i.title}`)}">${k === 0 ? `<span>${i.n}</span>` : ''}</div>`;
          });
        });
      }
      marks.innerHTML = html;
      marks.querySelectorAll('.mark').forEach((mk) => mk.addEventListener('click', () => this.onSelect(mk.dataset.id, 'viewer')));
    });
  }

  select(id) {
    this.selected = id;
    this.drawMarks();
    const issue = this.result.issues.find((i) => i.id === id);
    if (!issue) return;
    this.root.querySelectorAll('.pane').forEach((pane) => {
      const side = this.mode === 'side' ? pane.dataset.side : 'm';
      const rc = rectsFor(issue, side)[0] || rectsFor(issue, side === 'm' ? 'o' : 'm')[0];
      const img = pane.querySelector('img');
      if (!rc || !img?.naturalWidth) return;
      const scale = img.clientWidth / img.naturalWidth;
      const scroller = pane.querySelector('.scroller');
      scroller.scrollTo({ top: Math.max(0, rc.y * scale - 80), left: Math.max(0, rc.x * scale - 40), behavior: 'smooth' });
    });
    const sync = this.root.querySelector('#sync');
    if (sync && sync.checked) {
      sync.checked = false; // independent jump to each side's element
      setTimeout(() => { sync.checked = true; }, 900);
    }
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
  return `<table class="matrix"><thead><tr><th>Issue</th>${report.results.map((r) => `<th>${r.width}</th>`).join('')}</tr></thead><tbody>
    ${sorted.map((row) => `<tr><td><span class="cat">${CATEGORY_LABEL[row.category] || row.category}</span> ${esc(row.title)}</td>
      ${report.results.map((r) => {
    const i = row.cells[r.width];
    return `<td>${i ? `<a class="dot ${i.severity}" href="#" data-goto="${esc(i.id)}" title="${esc(`${r.width}px · #${i.n}`)}">${i.n}</a>` : ''}</td>`;
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
          <div><span class="lbl">Original</span><a href="${esc(report.original)}" target="_blank" rel="noopener">${esc(report.original)}</a></div>
          <div><span class="lbl">Migrated</span><a href="${esc(report.migrated)}" target="_blank" rel="noopener">${esc(report.migrated)}</a></div>
        </div>
        <div class="rh-stats">
          <span><b class="sev-high">${s.high}</b> high</span><span><b class="sev-medium">${s.medium}</b> medium</span><span><b class="sev-low">${s.low}</b> low</span>
          <span class="muted">Breakpoints ${report.breakpoints.join(', ') || '–'} · tested ${report.widths.join(', ')}px · ${new Date(report.created).toLocaleString()}</span>
        </div>
        ${showMismatch ? `<div class="banner">
          <b>Breakpoint mismatch.</b>
          ${mismatch.missingInMigrated.length ? `The original switches layout at <b>${mismatch.missingInMigrated.join(', ')}px</b>, but the migrated CSS has no media query there.` : ''}
          ${mismatch.extraInMigrated.length ? `The migrated CSS switches at <b>${mismatch.extraInMigrated.join(', ')}px</b>, which the original doesn't use.` : ''}
          Issues usually show up between these widths. Use the original's values in the block CSS media queries.
          <button type="button" class="btn tiny" id="rerun-edges">Re-run including these widths</button>
        </div>` : ''}
      </div>
      <div class="rh-actions">
        <a class="btn ghost" href="/reports/${esc(report.id)}/report.json" download>Download JSON</a>
        <button type="button" class="btn secondary" id="rerun">Re-run</button>
      </div>
    </section>
    <nav class="tabs">${tabs.map((t) => (t.r
    ? `<button type="button" data-tab="${t.key}"><b>${t.r.width}px</b><span class="score-pill sm ${scoreClass(t.r.score)}">${t.r.score}</span><span class="tc"><i class="sev-high">${t.r.stats.high}</i><i class="sev-medium">${t.r.stats.medium}</i><i class="sev-low">${t.r.stats.low}</i></span></button>`
    : `<button type="button" data-tab="${t.key}"><b>${t.key === 'matrix' ? 'Across breakpoints' : 'All fixes'}</b></button>`)).join('')}</nav>
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
  const showTab = (key, focusId) => {
    current = key;
    app.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === key));
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams({ tab: key });
    url.hash = `#/report/${id}?${hashParams}`;
    window.history.replaceState(null, '', url);
    if (key === 'matrix') {
      body.innerHTML = `<div class="card">${matrixHtml(report)}</div>`;
      body.querySelectorAll('[data-goto]').forEach((a) => a.addEventListener('click', (e) => {
        e.preventDefault();
        const [w] = a.dataset.goto.split('-');
        showTab(w, a.dataset.goto);
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
          <h2>${result.issues.length} issues at ${result.width}px</h2>
          <p class="muted">${result.stats.similarity}% pixel match · ${result.stats.matchRate}% of elements matched · ${result.page.o.height}px vs ${result.page.m.height}px tall</p>
          <div class="filters">
            ${['high', 'medium', 'low'].map((sv) => `<label class="fchip ${sv}"><input type="checkbox" value="${sv}" checked> ${sv}</label>`).join('')}
            <select id="cat"><option value="">All categories</option>${cats.map((c) => `<option value="${c}">${CATEGORY_LABEL[c] || c}</option>`).join('')}</select>
            <input type="search" id="q" placeholder="Filter…">
          </div>
        </div>
        <div class="issue-list" id="issue-list"></div>
      </aside>
    </div>`;
    const list = document.getElementById('issue-list');
    const select = (iid, from) => {
      list.querySelectorAll('.issue').forEach((el) => el.classList.toggle('sel', el.dataset.id === iid));
      viewer.select(iid);
      if (from === 'viewer') list.querySelector(`[data-id="${CSS.escape(iid)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    viewer = new Viewer(document.getElementById('viewer'), report, result, select);
    const applyFilters = () => {
      const sev = [...body.querySelectorAll('.filters input[type=checkbox]:checked')].map((x) => x.value);
      const cat = body.querySelector('#cat').value;
      const q = body.querySelector('#q').value.toLowerCase();
      const shown = result.issues
        .filter((i) => sev.includes(i.severity) && (!cat || i.category === cat))
        .filter((i) => !q || `${i.title} ${i.detail} ${i.m?.selector || ''} ${i.fix?.file || ''}`.toLowerCase().includes(q))
        .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.n - b.n);
      viewer.visibleIds = new Set(shown.map((i) => i.id));
      viewer.drawMarks();
      list.innerHTML = shown.length ? shown.map(issueCard).join('') : '<p class="muted pad">No issues match the filters. Nice.</p>';
      list.querySelectorAll('.issue').forEach((el) => {
        el.addEventListener('click', (e) => { if (!e.target.closest('.copy')) select(el.dataset.id, 'list'); });
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') select(el.dataset.id, 'list'); });
      });
      list.querySelectorAll('.copy').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy, b)));
    };
    body.querySelectorAll('.filters input, .filters select').forEach((x) => x.addEventListener('input', applyFilters));
    applyFilters();
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
