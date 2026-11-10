import {
  esc, api, hostOf, copy, scoreClass, testWidths, historyItems, loadReport, downloadReport, SEV_ORDER, CATEGORY_LABEL,
} from './util.js';
import { issueBody, mountWorkspace } from './visual.js';

/*
 * Chat front end. Requests are understood by simple local rules (no AI
 * service): URLs start a comparison, keywords filter the results.
 */

const STORE = 'parity-chat-v1';
// every comparison also covers the smallest phone and a wide desktop, besides the breakpoints
const WIDTH_OPTS = { base: true, edges: false, wide: true };
const DEFAULT_HIDE = ['#onetrust-consent-sdk', '#onetrust-banner-sdk', '.cookie-banner', '[id*="cookie" i][class*="banner" i]', '#usercentrics-root'];
const URL_RE = /\b(?:https?:\/\/|localhost:\d+)[^\s,<>"')]+/gi;

const state = {
  messages: [], reportId: null, visual: false, visualWidth: null, pending: {},
};
let root;
let workspace;
let seq = 0;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
    Object.assign(state, {
      messages: saved.messages || [], reportId: saved.reportId || null, visual: !!saved.visual, visualWidth: saved.visualWidth || null,
    });
    seq = state.messages.reduce((m, x) => Math.max(m, x.id), 0);
  } catch (e) { /* fresh start */ }
}

function save() {
  const { messages, reportId, visual, visualWidth } = state;
  localStorage.setItem(STORE, JSON.stringify({
    messages: messages.slice(-150), reportId, visual, visualWidth,
  }));
}

/* ------------------------------------------------------------ rendering */

const spinner = '<span class="spin" aria-hidden="true"></span>';

function urlsHtml(o, m) {
  return `<div class="urls-mini"><div><span class="lbl o">Original</span><a href="${esc(o)}" target="_blank" rel="noopener">${esc(o)}</a></div>
    <div><span class="lbl m">Migrated</span><a href="${esc(m)}" target="_blank" rel="noopener">${esc(m)}</a></div></div>`;
}

function setupHtml(msg) {
  const d = msg.data;
  if (d.status === 'detecting') return `<div class="card-msg">${urlsHtml(d.original, d.migrated)}<p class="status busy">${spinner}Reading the original page's stylesheets to find its breakpoints…</p></div>`;
  if (d.status === 'error') return `<div class="card-msg">${urlsHtml(d.original, d.migrated)}<p class="err">${esc(d.error)}</p></div>`;
  const widths = testWidths(d.breakpoints, WIDTH_OPTS, d.extra);
  if (d.status === 'started') {
    return `<div class="card-msg">${urlsHtml(d.original, d.migrated)}
      <p class="muted">Breakpoints <b>${d.breakpoints.join(', ') || '–'}</b> · testing <b>${widths.join(', ')}px</b></p></div>`;
  }
  const detected = d.clusters.filter((c) => c.count > 0);
  const max = Math.max(1, ...detected.map((c) => c.count));
  let intro = `I found <b>${d.mediaRules}</b> media rules. Click the bars to pick breakpoints (taller = used more), or type your own below.`;
  if (d.saved) intro = `Using the breakpoints you used last time for <b>${esc(d.saved)}</b>. Edit them if needed.`;
  if (d.manual) intro = 'Using <b>your breakpoints</b>.';
  return `<div class="card-msg setup-msg">
    ${urlsHtml(d.original, d.migrated)}
    <p>${intro}</p>
    ${detected.length ? `<div class="bars">${detected.map((c) => `
      <button type="button" class="bar ${d.breakpoints.includes(c.px) ? 'on' : ''}" data-action="bp" data-mid="${msg.id}" data-px="${c.px}" title="${c.count} media rule(s) at ${c.px}px">
        <span class="bar-fill" style="height:${Math.max(8, (c.count / max) * 100)}%"></span><span class="bar-label">${c.px}</span></button>`).join('')}</div>` : ''}
    <div class="field-row"><span class="field-label">Breakpoints</span>
      <div class="chips">${d.breakpoints.map((b) => `<span class="chip">${b}px<button type="button" data-action="bp-remove" data-mid="${msg.id}" data-px="${b}" aria-label="Remove ${b}">×</button></span>`).join('') || '<span class="muted">none</span>'}
        <span class="add-inline"><input type="number" min="280" max="3840" placeholder="+ breakpoint" data-mid="${msg.id}" data-list="breakpoints" aria-label="Add a breakpoint"></span>
        ${detected.length ? '' : `<button type="button" class="btn link" data-action="detect" data-mid="${msg.id}">Detect from original</button>`}</div></div>
    <div class="field-row"><span class="field-label">Test widths</span>
      <div class="chips">${widths.map((w) => `<span class="chip width">${w}px${d.extra.includes(w) ? `<button type="button" data-action="width-remove" data-mid="${msg.id}" data-px="${w}" aria-label="Remove ${w}">×</button>` : ''}</span>`).join('')}</div></div>
    <div class="actions">
      <button type="button" class="btn primary" data-action="run" data-mid="${msg.id}">Run comparison</button>
    </div></div>`;
}

const numList = (s) => [...new Set(String(s || '').split(/[^\d]+/).map(Number).filter((n) => n >= 280 && n <= 3840))].sort((a, b) => a - b);

function formWidths(d) {
  return testWidths(numList(d.breakpoints), WIDTH_OPTS);
}

// one-click breakpoints most sites use
const PRESETS = [480, 600, 768, 900, 1024, 1200, 1280, 1440];

/** The form's breakpoint block: chips, an add field, presets and detection. */
function bpBlockHtml(d, id) {
  const bps = numList(d.breakpoints);
  return `<fieldset class="bp-block">
    <legend>Breakpoints</legend>
    <div class="bp-chips" aria-live="polite">
      ${bps.length ? bps.map((b) => `<span class="bp-chip">${b}px<button type="button" data-action="form-bp-remove" data-mid="${id}" data-px="${b}" aria-label="Remove ${b}px">×</button></span>`).join('')
    : '<span class="bp-empty">No breakpoints yet. Add your own, pick common ones, or detect them from the original. Left empty, they\'re detected when you run.</span>'}
      ${bps.length > 1 ? `<button type="button" class="btn link bp-clear" data-action="form-bp-clear" data-mid="${id}">Clear all</button>` : ''}
    </div>
    <div class="bp-add">
      <input type="number" class="bp-add-input" min="280" max="3840" step="1" placeholder="e.g. 768" aria-label="Breakpoint in px" data-mid="${id}">
      <span class="bp-unit">px</span>
      <button type="button" class="btn secondary" data-action="form-bp-add" data-mid="${id}">+ Add breakpoint</button>
      <button type="button" class="btn ghost" data-action="form-detect" data-mid="${id}">Detect from original</button>
    </div>
    ${d.bpError ? `<p class="err bp-err">${esc(d.bpError)}</p>` : ''}
    <div class="bp-presets"><span class="muted">Common:</span>
      ${PRESETS.map((p) => `<button type="button" class="preset ${bps.includes(p) ? 'on' : ''}" data-action="form-bp-preset" data-mid="${id}" data-px="${p}" aria-pressed="${bps.includes(p)}">${p}</button>`).join('')}
    </div>
    ${d.note ? `<p class="f-note">${esc(d.note)}</p>` : ''}
  </fieldset>`;
}

/** Structured "new comparison" form, as a chat card. */
function formHtml(msg) {
  const d = msg.data;
  if (d.status === 'submitted') {
    return `<div class="card-msg">${urlsHtml(d.original, d.migrated)}
      <p class="muted">${numList(d.breakpoints).length ? `Breakpoints <b>${numList(d.breakpoints).join(', ')}</b>` : 'Breakpoints detected from the original'} · testing <b>${formWidths(d).join(', ') || '…'}px</b></p></div>`;
  }
  const { id } = msg;
  return `<form class="card-msg form-msg" data-mid="${id}" novalidate>
    <h3>New comparison</h3>
    <label class="f"><span class="lbl o">Original page</span>
      <input type="url" name="original" required list="recent-original" autocomplete="off" placeholder="https://www.example.com/products/widget" value="${esc(d.original)}">
      <span class="f-err" aria-live="polite"></span></label>
    <label class="f"><span class="lbl m">Migrated page</span>
      <input type="url" name="migrated" required list="recent-migrated" autocomplete="off" placeholder="https://main--site--org.aem.page/products/widget" value="${esc(d.migrated)}">
      <span class="f-err" aria-live="polite"></span></label>
    ${bpBlockHtml(d, id)}
    <details class="f-more" ${d.ignore ? 'open' : ''}><summary>Ignore elements <span class="muted">optional: chat widgets, ads, live feeds</span></summary>
      <textarea name="ignore" rows="2" placeholder=".chat-widget&#10;#promo-banner">${esc(d.ignore)}</textarea></details>
    <p class="f-preview">Will test <b class="f-widths">${formWidths(d).length ? `${formWidths(d).join(', ')}px` : '…'}</b></p>
    ${d.error ? `<p class="err">${esc(d.error)}</p>` : ''}
    <div class="actions">
      <button type="submit" class="btn primary">Run comparison</button>
      <button type="button" class="btn link" data-action="form-demo" data-mid="${id}">Use the demo pages</button>
    </div>
  </form>`;
}

function progressHtml(msg) {
  const d = msg.data;
  if (d.status === 'error') return `<div class="card-msg"><p class="err">The comparison failed: ${esc(d.error)}</p></div>`;
  if (d.status === 'lost') return '<div class="card-msg"><p class="muted">This comparison was interrupted (the tool was restarted).</p></div>';
  const done = d.status === 'done';
  const widths = d.widths || [];
  // finished: one quiet line, the summary below has the per-width scores
  if (done) {
    const secs = d.ended && d.started ? Math.round((d.ended - d.started) / 1000) : null;
    return `<p class="done-line">✓ Compared ${widths.length || ''} width${widths.length === 1 ? '' : 's'}${secs ? ` in ${secs < 60 ? `${secs}s` : `${Math.round(secs / 60)} min`}` : ''}.</p>`;
  }
  const finished = Object.keys(d.done || {}).length;
  // after the first width, estimate the rest from the average time per width
  let eta = '';
  if (!done && finished && finished < widths.length) {
    const left = Math.round((((Date.now() - d.started) / finished) * (widths.length - finished)) / 1000);
    eta = left > 5 ? ` · about ${left < 60 ? `${left}s` : `${Math.round(left / 60)} min`} left` : ' · almost done';
  }
  const STAGE = { 'capturing original': 'original', 'capturing migrated': 'migrated', comparing: 'comparing' };
  const steps = widths.map((w) => {
    const r = d.done?.[w];
    if (r) return `<li class="step ok" title="${r.issues} issues"><b>${w}px</b><span class="score-pill sm ${scoreClass(r.score)}">${r.score}</span></li>`;
    if (!done && d.current === w) return `<li class="step now">${spinner}<b>${w}px</b><span class="muted">${STAGE[d.stage] || ''}</span></li>`;
    return `<li class="step"><b>${w}px</b></li>`;
  }).join('');
  return `<div class="card-msg progress-msg">
    <div class="progress-top"><b>${done ? 'Comparison finished' : 'Comparing…'}</b>
      <span class="muted">${widths.length ? `${finished} of ${widths.length} widths${eta}` : ''}</span></div>
    <div class="progress"><span style="width:${done ? 100 : d.progress || 2}%"></span></div>
    ${steps ? `<ol class="steps">${steps}</ol>` : `<p class="status busy">${spinner}${esc(d.last || 'Starting…')}</p>`}
  </div>`;
}

/* tab title shows progress, so the comparison can run in the background */
const BASE_TITLE = 'Parity Check';
function setTitle(text) {
  document.title = text ? `${text} · ${BASE_TITLE}` : BASE_TITLE;
}
window.addEventListener('focus', () => { if (!document.title.startsWith('(')) setTitle(''); });

function issueLine(i) {
  return `<button type="button" class="issue-line sev-${i.severity}" data-action="issue" data-id="${esc(i.id)}" data-report="${esc(i.reportId)}">
    <span class="pin-ref">${i.n}</span><span class="il-title">${esc(i.title)}</span>
    <span class="cat-tag">${i.width}px · ${CATEGORY_LABEL[i.category] || i.category}</span></button>`;
}

function summaryHtml(report) {
  const s = report.summary;
  const mm = report.breakpointMismatch;
  const top = report.results.flatMap((r) => r.issues.map((i) => ({ ...i, reportId: report.id })))
    .filter((i) => i.severity === 'high');
  const seen = new Set();
  const unique = top.filter((i) => {
    const k = `${i.category}|${i.property}|${i.title.replace(/\d+/g, '#')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5);
  return `<div class="card-msg summary">
    <div class="sum-head">
      <div class="score-ring ${scoreClass(s.score)}" style="--v:${s.score}"><b>${s.score}</b><span>parity</span></div>
      <div>${urlsHtml(report.original, report.migrated)}
        <div class="rh-stats"><span class="stat high"><b>${s.high}</b> high</span><span class="stat medium"><b>${s.medium}</b> medium</span><span class="stat low"><b>${s.low}</b> low</span></div></div>
    </div>
    <div class="width-chips">${report.results.map((r) => `<button type="button" class="wchip" data-action="visual" data-report="${esc(report.id)}" data-width="${r.width}">
      <b>${r.width}px</b><span class="score-pill sm ${scoreClass(r.score)}">${r.score}</span>${r.stats.high ? `<span class="tc high">${r.stats.high}</span>` : ''}</button>`).join('')}</div>
    ${mm && (mm.missingInMigrated.length || mm.extraInMigrated.length) ? `<p class="note-warn"><b>Breakpoints don't match.</b>
      ${mm.missingInMigrated.length ? `The migrated CSS has no media query at ${mm.missingInMigrated.join(', ')}px.` : ''}
      ${mm.extraInMigrated.length ? `It switches layout at ${mm.extraInMigrated.join(', ')}px instead.` : ''}</p>` : ''}
    ${unique.length ? `<h4>Most important</h4><div class="issue-lines">${unique.map(issueLine).join('')}</div>` : '<p>No high-severity issues. 🎉</p>'}
    <div class="actions">
      <button type="button" class="btn primary" data-action="visual" data-report="${esc(report.id)}">Show visual parity</button>
      <button type="button" class="btn secondary" data-action="fix-prompt" data-report="${esc(report.id)}" title="Copy a prompt that tells AEM Coder how to fix these issues. Paste it into the AEM Coder chat.">Copy prompt for AEM Coder</button>
      <button type="button" class="btn ghost" data-action="download" data-format="pdf" data-report="${esc(report.id)}">PDF report</button>
      <button type="button" class="btn ghost" data-action="download" data-format="html" data-report="${esc(report.id)}">HTML report</button>
      <button type="button" class="btn ghost" data-action="say" data-text="Show all fixes">All fixes</button>
    </div></div>`;
}

function issuesHtml(report, f) {
  let { results } = report;
  if (f.widths?.length) results = results.filter((r) => f.widths.includes(r.width));
  const groups = results.map((r) => ({
    width: r.width,
    issues: r.issues
      .filter((i) => (!f.severity || f.severity.includes(i.severity)) && (!f.category || f.category.includes(i.category)))
      .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.n - b.n)
      .map((i) => ({ ...i, reportId: report.id })),
  })).filter((g) => g.issues.length);
  const total = groups.reduce((n, g) => n + g.issues.length, 0);
  const label = [f.severity?.join('/'), f.category?.map((c) => CATEGORY_LABEL[c]).join('/')].filter(Boolean).join(' ');
  if (!total) return `<div class="card-msg"><p>No ${esc(label)} issues${f.widths?.length ? ` at ${f.widths.join(', ')}px` : ''}. 🎉</p></div>`;
  let budget = 30;
  return `<div class="card-msg">
    <p><b>${total}</b> ${esc(label)} issue${total > 1 ? 's' : ''}${f.widths?.length ? ` at ${f.widths.join(', ')}px` : ' across all widths'}. Click one to see it on the page.</p>
    ${groups.map((g) => {
    const shown = g.issues.slice(0, Math.max(0, budget));
    budget -= shown.length;
    if (!shown.length) return '';
    return `<h4 class="wgroup">${g.width}px <span class="muted">${g.issues.length}</span></h4>
      <div class="issue-lines">${shown.map(issueLine).join('')}</div>
      ${g.issues.length > shown.length ? `<button type="button" class="btn link" data-action="visual" data-report="${esc(report.id)}" data-width="${g.width}">+ ${g.issues.length - shown.length} more at ${g.width}px</button>` : ''}`;
  }).join('')}</div>`;
}

function fixesHtml(report, file) {
  const files = (report.fixes || []).filter((f) => !file || f.file === file);
  if (!files.length) return '<div class="card-msg"><p>No CSS fixes for this comparison. What\'s left is about content.</p></div>';
  return `<div class="card-msg">
    <p>${file ? `Fixes for <code>${esc(file)}</code>.` : `Fixes merged per file (${files.length} file${files.length > 1 ? 's' : ''}).`} Media queries use the original site's breakpoints.</p>
    ${files.map((f) => `<div class="fix-file"><div class="ff-head"><code class="file">${esc(f.file)}</code>${f.exists === false ? '<span class="muted">new file</span>' : ''}
      <span class="muted">${f.issues} issue${f.issues > 1 ? 's' : ''}</span><button type="button" class="btn tiny copy" data-copy="${esc(f.css)}">Copy</button></div>
      <pre>${esc(f.css)}</pre></div>`).join('')}</div>`;
}

const fixPrompt = async (id) => {
  const res = await fetch(`/api/reports/${id}/fix-prompt`);
  if (!res.ok) throw new Error('Could not build the prompt');
  return res.text();
};

async function promptHtml(reportId) {
  const text = await fixPrompt(reportId);
  return `<div class="card-msg">
    <p>Here's a prompt for <b>AEM Coder</b>. Copy it and paste it into the AEM Coder chat. It lists every open issue with the original and migrated values, the files to change and the suggested CSS. Differences you approved are left out.</p>
    <div class="actions"><button type="button" class="btn primary copy" data-copy="${esc(text)}">Copy prompt</button></div>
    <details class="prompt-preview"><summary>Preview the prompt</summary><pre>${esc(text)}</pre></details></div>`;
}

function breakpointsHtml(report) {
  const mm = report.breakpointMismatch || { missingInMigrated: [], extraInMigrated: [] };
  return `<div class="card-msg"><dl class="kv">
    <dt>Original</dt><dd>${report.breakpoints.join(', ') || '–'}px</dd>
    <dt>Migrated</dt><dd>${(report.migratedBreakpoints || []).join(', ') || '–'}px</dd>
    <dt>Tested</dt><dd>${report.widths.join(', ')}px</dd></dl>
    ${mm.missingInMigrated.length || mm.extraInMigrated.length ? `<p class="note-warn">Layout changes at different widths. Use the original's values in the block CSS media queries.
      <button type="button" class="btn tiny" data-action="say" data-text="Re-run and also test ${[...mm.missingInMigrated, ...mm.extraInMigrated].flatMap((b) => [b - 1, b]).join(', ')}">Re-run at these widths</button></p>` : '<p>Breakpoints match. 👍</p>'}</div>`;
}

const HELP = `<p>I compare an original page with its migrated page at the <b>original site's own breakpoints</b>, mark every difference and suggest CSS fixes.</p>
  <p><b>To start</b>, use the <b>Form</b> button (original URL, migrated URL, breakpoints), or type it:</p><ul>
  <li><code>compare https://www.example.com/about with https://main--site--org.aem.page/about</code>: I detect the breakpoints from the original</li>
  <li><code>… breakpoints 768, 1024, 1280</code>: use your breakpoints and run right away</li>
  <li>Before running: <code>add breakpoint 1280</code> · <code>remove 640</code> · <code>breakpoints 600, 900</code></li></ul>
  <p><b>Then ask:</b></p><ul>
  <li><code>show high issues</code> · <code>what's wrong on mobile?</code> · <code>typography issues at 1024</code></li>
  <li><code>issue #3 at 375</code> · <code>show all fixes</code> · <code>fixes for cards</code></li>
  <li><code>prompt for AEM Coder</code>: a prompt you paste into AEM Coder so it fixes the open issues</li>
  <li><code>download the PDF report</code> · <code>breakpoints</code> · <code>re-run</code> · <code>history</code></li></ul>
  <p>Switch on <b>Visual parity</b> (top right) to see both pages side by side with every issue marked.</p>`;

async function bodyFor(msg) {
  const d = msg.data;
  switch (msg.type) {
    case 'text': return msg.role === 'user' ? `<p>${esc(d.text)}</p>` : d.html;
    case 'setup': return setupHtml(msg);
    case 'form': return formHtml(msg);
    case 'progress': return progressHtml(msg);
    case 'summary': return summaryHtml(await loadReport(d.reportId));
    case 'issues': return issuesHtml(await loadReport(d.reportId), d.filter);
    case 'issue': {
      const report = await loadReport(d.reportId);
      const result = report.results.find((r) => r.issues.some((i) => i.id === d.id));
      const issue = result.issues.find((i) => i.id === d.id);
      return `<div class="card-msg issue-msg sev-${issue.severity}">
        <div class="im-head"><span class="pin-ref">${issue.n}</span><b>${esc(issue.title)}</b></div>
        <p class="muted">${result.width}px · ${issue.severity} · ${CATEGORY_LABEL[issue.category] || issue.category}</p>
        ${issueBody(report, result, issue)}
        <button type="button" class="btn secondary" data-action="issue" data-id="${esc(issue.id)}" data-report="${esc(report.id)}">Show on the page</button></div>`;
    }
    case 'fixes': return fixesHtml(await loadReport(d.reportId), d.file);
    case 'breakpoints': return breakpointsHtml(await loadReport(d.reportId));
    case 'prompt': return promptHtml(d.reportId);
    case 'history': return `<div class="card-msg">${d.list.length ? '<p>Recent comparisons. Click one to open it here.</p>' : ''}<div class="history-list">${historyItems(d.list.slice(0, 10))}</div></div>`;
    default: return '';
  }
}

async function paint(msg, el) {
  const target = el || root.querySelector(`[data-mid="${msg.id}"] .msg-body`);
  if (!target) return;
  try {
    target.innerHTML = await bodyFor(msg);
  } catch (e) {
    target.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}

function mountMessage(msg) {
  const list = root.querySelector('.messages');
  const el = document.createElement('div');
  el.className = `msg ${msg.role}`;
  el.dataset.mid = msg.id;
  el.innerHTML = `${msg.role === 'bot' ? '<span class="avatar" aria-hidden="true"></span>' : ''}<div class="msg-body">${msg.type === 'text' ? '' : `<p class="muted">${spinner}Loading…</p>`}</div>`;
  list.append(el);
  return paint(msg, el.querySelector('.msg-body'));
}

function scrollDown() {
  const list = root.querySelector('.messages');
  requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

function add(role, type, data) {
  seq += 1;
  const msg = {
    id: seq, role, type, data,
  };
  state.messages.push(msg);
  save();
  mountMessage(msg).then(scrollDown);
  scrollDown();
  renderSuggestions();
  return msg;
}

const say = (html) => add('bot', 'text', { html });

function update(msg) {
  save();
  renderSuggestions();
  return paint(msg);
}

/* ------------------------------------------------------------ actions */

/**
 * Sets up a comparison. With `breakpoints` the user's own values are used as-is;
 * otherwise saved values for the site, otherwise they're detected from the original.
 */
async function startComparison(original, migrated, {
  widths = [], breakpoints = [], ignore = [], autoRun = false,
} = {}) {
  state.pending = {};
  const msg = add('bot', 'setup', {
    original,
    migrated,
    status: 'detecting',
    clusters: [],
    breakpoints: [],
    extra: widths,
    ignore,
  });
  const d = msg.data;
  try {
    const sites = await api('/api/sites').catch(() => ({}));
    const saved = sites[hostOf(original)];
    if (breakpoints.length) {
      Object.assign(d, { breakpoints, manual: true, status: 'ready' });
    } else if (saved?.breakpoints?.length) {
      Object.assign(d, {
        breakpoints: saved.breakpoints,
        clusters: saved.breakpoints.map((px) => ({ px, count: 1 })),
        extra: [...new Set([...(saved.extraWidths || []), ...widths])],
        saved: hostOf(original),
        status: 'ready',
      });
    } else {
      const det = await api('/api/breakpoints', { url: original });
      Object.assign(d, {
        clusters: det.clusters, breakpoints: det.suggested, mediaRules: det.mediaRules, status: 'ready',
      });
    }
  } catch (e) {
    Object.assign(d, { status: 'error', error: `I couldn't load the original page: ${e.message}` });
  }
  update(msg);
  if (d.status === 'ready' && (autoRun || widths.length || breakpoints.length)) run(msg); // eslint-disable-line no-use-before-define
}

/** Detects breakpoints for a setup card that started with the user's own. */
async function detectInto(msg) {
  const d = msg.data;
  try {
    const det = await api('/api/breakpoints', { url: d.original });
    d.clusters = det.clusters;
    d.mediaRules = det.mediaRules;
    const extra = det.suggested.filter((b) => !d.breakpoints.includes(b));
    update(msg);
    say(`<p>The original's CSS switches layout at <b>${det.suggested.join(', ') || 'no common widths'}</b>px.${extra.length ? ` Click a bar to add ${extra.join(', ')}px.` : ' Your breakpoints already cover them. 👍'}</p>`);
  } catch (e) {
    say(`<p class="err">I couldn't read the original page: ${esc(e.message)}</p>`);
  }
}

function watchJob(msg) {
  const d = msg.data;
  const es = new EventSource(`/api/jobs/${d.jobId}/events`);
  let timer;
  es.onmessage = (ev) => {
    const e = JSON.parse(ev.data);
    if (e.type === 'log') {
      d.progress = e.progress;
      d.last = e.message;
      // "375px · capturing original" / "375px · score 68, 10 issues"
      const stage = e.message.match(/^(\d+)px · (capturing original|capturing migrated|comparing)$/);
      const result = e.message.match(/^(\d+)px · score (\d+), (\d+) issues/);
      if (stage) Object.assign(d, { current: Number(stage[1]), stage: stage[2] });
      if (result) {
        d.done = { ...(d.done || {}), [result[1]]: { score: Number(result[2]), issues: Number(result[3]) } };
      }
      if (d.widths?.length) setTitle(`(${Object.keys(d.done || {}).length}/${d.widths.length}) Comparing…`);
      clearTimeout(timer);
      timer = setTimeout(() => update(msg), 80);
    }
    if (e.type === 'status') {
      es.close();
      clearTimeout(timer);
      d.status = e.status;
      d.error = e.error;
      d.ended = Date.now();
      update(msg);
      setTitle(e.status === 'done' ? '✓ Comparison done' : '✕ Comparison failed');
      if (document.hasFocus()) setTimeout(() => setTitle(''), 4000);
      if (e.status === 'done') {
        state.reportId = d.jobId;
        state.visualWidth = null;
        add('bot', 'summary', { reportId: d.jobId });
        refreshRecent();
        if (state.visual) renderVisual(); // eslint-disable-line no-use-before-define
      }
    }
  };
  es.onerror = () => {
    es.close();
    if (d.status !== 'done' && d.status !== 'error') {
      d.status = 'lost';
      update(msg);
    }
  };
}

async function run(setupMsg) {
  const d = setupMsg.data;
  if (d.status !== 'ready') return;
  const widths = testWidths(d.breakpoints, WIDTH_OPTS, d.extra);
  if (!widths.length) { say('<p>Add at least one breakpoint or width first.</p>'); return; }
  d.status = 'started';
  update(setupMsg);
  try {
    const { id } = await api('/api/jobs', {
      original: d.original,
      migrated: d.migrated,
      breakpoints: d.breakpoints,
      widths,
      options: { hideSelectors: [...DEFAULT_HIDE, ...(d.ignore || [])] },
    });
    // remember this site's breakpoints (and ignored elements) for next time: no "save" step
    if (d.breakpoints.length) {
      api('/api/sites', {
        host: hostOf(d.original), breakpoints: d.breakpoints, hideSelectors: [...DEFAULT_HIDE, ...(d.ignore || [])],
      }).catch(() => {});
    }
    const msg = add('bot', 'progress', {
      jobId: id, progress: 2, status: 'running', widths, done: {}, started: Date.now(),
    });
    watchJob(msg);
  } catch (e) {
    d.status = 'ready';
    update(setupMsg);
    say(`<p class="err">${esc(e.message)}</p>`);
  }
}

const lastSetup = () => [...state.messages].reverse().find((m) => m.type === 'setup');
const pendingSetup = () => {
  const s = lastSetup();
  return s && s.data.status === 'ready' ? s : null;
};

async function rerun(extraWidths = []) {
  const report = await loadReport(state.reportId);
  const extra = [...new Set([...report.widths.filter((w) => !report.breakpoints.includes(w)), ...extraWidths])];
  const ignore = (report.options?.hideSelectors || []).filter((s) => !DEFAULT_HIDE.includes(s));
  await startComparison(report.original, report.migrated, {
    widths: extra, breakpoints: report.breakpoints, ignore, autoRun: true,
  });
}

/** "www.site.com/x" -> "https://www.site.com/x"; "localhost:3000/x" -> "http://localhost:3000/x". */
function normalizeUrl(raw) {
  const u = String(raw || '').trim();
  if (!u || /^https?:\/\//i.test(u)) return u;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(u)) return `http://${u}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(u)) return `https://${u}`;
  return u;
}

function isPageUrl(u) {
  try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch (e) { return false; }
}

/** Adds the value of the form's "add breakpoint" field, with inline validation. */
function addFormBreakpoint(msg) {
  const input = root.querySelector(`.form-msg[data-mid="${msg.id}"] .bp-add-input`);
  const raw = input?.value.trim();
  const v = Number(raw);
  const d = msg.data;
  const bps = numList(d.breakpoints);
  if (!raw) d.bpError = 'Type a width in px, e.g. 768.';
  else if (!Number.isInteger(v) || v < 280 || v > 3840) d.bpError = `${raw} isn't a valid breakpoint. Use a whole number from 280 to 3840.`;
  else if (bps.includes(v)) d.bpError = `${v}px is already in the list.`;
  else {
    d.breakpoints = numList([...bps, v].join(','));
    d.bpError = '';
  }
  update(msg).then(() => root.querySelector(`.form-msg[data-mid="${msg.id}"] .bp-add-input`)?.focus());
}

/** Recently used pages, offered as suggestions in the form's URL fields. */
async function refreshRecent() {
  const list = await api('/api/reports').catch(() => []);
  const fill = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = [...new Set(list.map((r) => r[key]))].slice(0, 10).map((u) => `<option value="${esc(u)}"></option>`).join('');
  };
  fill('recent-original', 'original');
  fill('recent-migrated', 'migrated');
}

function addForm(prefill = {}) {
  // one draft at a time: an open form moves down to the bottom with what's typed in it
  const draft = state.messages.find((m) => m.type === 'form' && m.data.status === 'editing');
  if (draft) {
    state.messages = state.messages.filter((m) => m !== draft);
    root.querySelector(`.msg[data-mid="${draft.id}"]`)?.remove();
    const moved = add('bot', 'form', { ...draft.data, ...prefill, error: '' });
    setTimeout(() => root.querySelector(`.form-msg[data-mid="${moved.id}"] input[name="original"]`)?.focus(), 100);
    return moved;
  }
  return add('bot', 'form', {
    original: '',
    migrated: '',
    breakpoints: [],
    ignore: '',
    status: 'editing',
    ...prefill,
  });
}

async function submitForm(msg) {
  const d = msg.data;
  d.original = normalizeUrl(d.original);
  d.migrated = normalizeUrl(d.migrated);
  if (!isPageUrl(d.original) || !isPageUrl(d.migrated)) {
    d.error = !d.original || !d.migrated ? 'Enter both page URLs.' : 'Both fields need a page URL, e.g. https://www.example.com/about';
    update(msg).then(() => root.querySelector(`.form-msg[data-mid="${msg.id}"] input[name="${isPageUrl(d.original) ? 'migrated' : 'original'}"]`)?.focus());
    return;
  }
  if (d.original === d.migrated) {
    d.error = 'The original and migrated URLs are the same. Enter two different pages.';
    update(msg);
    return;
  }
  // a value typed in the add field but not added yet still counts
  const pending = Number(root.querySelector(`.form-msg[data-mid="${msg.id}"] .bp-add-input`)?.value);
  const breakpoints = numList([...numList(d.breakpoints), pending].join(','));
  // the submitted form becomes the user's message (the setup card below repeats the details)
  state.messages = state.messages.filter((m) => m !== msg);
  root.querySelector(`.msg[data-mid="${msg.id}"]`)?.remove();
  add('user', 'text', { text: `Compare ${d.original} with ${d.migrated}${breakpoints.length ? `, breakpoints ${breakpoints.join(', ')}` : ''}` });
  await startComparison(d.original, d.migrated, {
    breakpoints,
    ignore: String(d.ignore || '').split('\n').map((s) => s.trim()).filter(Boolean),
    autoRun: true,
  });
}

/* ------------------------------------------------------------ visual panel */

async function renderVisual(focus = {}) {
  const panel = root.querySelector('.visual-col');
  root.classList.toggle('with-visual', state.visual);
  const toggle = document.getElementById('visual-toggle');
  if (toggle) toggle.checked = state.visual;
  workspace?.destroy();
  workspace = null;
  if (!state.visual) { panel.innerHTML = ''; return; }
  if (!state.reportId) {
    panel.innerHTML = `<div class="visual-empty card"><h2>Visual parity</h2>
      <p class="muted">No comparison yet. Run one in the chat and both pages appear here side by side, with every issue marked.</p>
      <button type="button" class="btn primary" data-action="close-visual">← Back to chat</button></div>`;
    return;
  }
  let report;
  try {
    report = await loadReport(state.reportId);
  } catch (e) {
    panel.innerHTML = `<div class="visual-empty card"><p class="err">${esc(e.message)}</p></div>`;
    return;
  }
  const width = focus.width || state.visualWidth || report.results[0].width;
  state.visualWidth = width;
  save();
  const result = report.results.find((r) => r.width === width) || report.results[0];
  panel.innerHTML = `<div class="visual-head">
      <div class="vh-urls" title="${esc(report.original)} → ${esc(report.migrated)}"><span class="score-pill sm ${scoreClass(report.summary.score)}">${report.summary.score}</span>
        <span>${esc(hostOf(report.original))} → ${esc(hostOf(report.migrated))}</span></div>
      <nav class="tabs">${report.results.map((r) => `<button type="button" data-vwidth="${r.width}" class="${r.width === result.width ? 'on' : ''}"><b>${r.width}px</b>
        <span class="score-pill sm ${scoreClass(r.score)}">${r.score}</span></button>`).join('')}</nav>
      <a class="btn tiny" href="#/report/${esc(report.id)}" title="Open the full report page">Full page ↗</a>
      <button type="button" class="btn tiny" data-action="download" data-format="pdf" data-report="${esc(report.id)}">PDF</button>
      <button type="button" class="btn tiny back-chat" data-action="close-visual" title="Hide visual parity and return to the chat">← Back to chat</button>
    </div>
    <div class="visual-body"></div>`;
  panel.querySelectorAll('[data-vwidth]').forEach((b) => b.addEventListener('click', () => renderVisual({ width: Number(b.dataset.vwidth) })));
  workspace = mountWorkspace(panel.querySelector('.visual-body'), report, result, {
    focusId: focus.issueId, onWidthChange: (w) => renderVisual({ width: w }),
  });
}

function setVisual(on, focus) {
  state.visual = on;
  save();
  renderVisual(focus);
  renderSuggestions(); // eslint-disable-line no-use-before-define
  if (!on) scrollDown(); // back in the chat: show the latest message
}

/* ------------------------------------------------------------ understanding */

const CATEGORY_WORDS = [
  [/typograph|font|text size|heading|letter|line.?height/, 'typography'],
  [/colou?r|background/, 'color'],
  [/spacing|gap|margin|padding|whitespace/, 'spacing'],
  [/layout|column|grid|container|wrap/, 'layout'],
  [/image|img|photo|picture|crop/, 'image'],
  [/content|missing|extra|heading level/, 'content'],
  [/responsive|hidden|overflow|scroll|visib/, 'responsive'],
  [/button|component|cta/, 'component'],
];

function parse(text) {
  const urls = (text.match(URL_RE) || []).map((u) => (u.startsWith('http') ? u : `http://${u}`).replace(/[.,;:]+$/, ''));
  let rest = text.replace(URL_RE, ' ');
  // "breakpoints 768, 1024 and 1280px" -> breakpoints; any other numbers are test widths
  const NUMS = '((?:\\d{3,4}\\s*(?:px)?\\s*(?:,|and|&|\\s)\\s*)*\\d{3,4})';
  const bpMatch = rest.match(new RegExp(`\\b(?:breakpoints?|bps?)\\b\\s*(?:are|is|of|at|=|:)?\\s*${NUMS}`, 'i'));
  const breakpoints = bpMatch ? numList(bpMatch[1]) : [];
  if (bpMatch) rest = rest.replace(bpMatch[0], ' breakpoints ');
  const nums = [...rest.matchAll(/\b(\d{3,4})\s*(?:px)?\b/g)].map((m) => Number(m[1])).filter((n) => n >= 280 && n <= 3840);
  const issueNum = rest.match(/(?:#|\bissue\s*#?|\bnumber\s*)(\d{1,3})\b/i)?.[1];
  return {
    urls, nums, breakpoints, issueNum: issueNum ? Number(issueNum) : null, t: rest.toLowerCase(),
  };
}

function widthsFor(report, t, nums) {
  if (nums.length) return nums;
  const ws = report.widths;
  if (/\bmobile|phone|small/.test(t)) return [ws[0]];
  if (/\btablet|medium screen|ipad/.test(t)) return [ws.reduce((a, b) => (Math.abs(b - 820) < Math.abs(a - 820) ? b : a))];
  if (/\bdesktop|large|wide/.test(t)) return [ws[ws.length - 1]];
  return [];
}

async function handle(text) {
  const {
    urls, nums, breakpoints, issueNum, t,
  } = parse(text);
  const given = { widths: nums, breakpoints: breakpoints.length ? breakpoints : state.pending.breakpoints || [] };

  if (urls.length >= 2) { await startComparison(urls[0], urls[1], given); return; }
  if (urls.length === 1) {
    const [url] = urls;
    if (state.pending.original) { await startComparison(state.pending.original, url, given); return; }
    if (state.pending.migrated) { await startComparison(url, state.pending.migrated, given); return; }
    if (/migrat|new page|eds|aem\.(page|live)/.test(t) || /aem\.(page|live)|localhost:3000/.test(url)) {
      state.pending = { migrated: url, breakpoints };
      say('<p>Got the <b>migrated</b> page. What\'s the <b>original</b> page URL?</p>');
    } else {
      state.pending = { original: url, breakpoints };
      say('<p>Got the <b>original</b> page. What\'s the <b>migrated</b> page URL?</p>');
    }
    return;
  }
  if (/\bdemo\b|example|sample/.test(t)) {
    say('<p>Running the demo: a legacy page and its EDS migration with a few deliberate differences.</p>');
    await startComparison(`${window.location.origin}/demo/original.html`, `${window.location.origin}/demo/migrated.html`);
    return;
  }
  if (/^\s*(help|\?)\s*$|how (does|do|to)|what can|commands/.test(t)) { say(HELP); return; }
  if (/\bform\b|new comparison|^\s*new\s*$|start over|compare (two|pages)/.test(t)) { addForm(); return; } // eslint-disable-line no-use-before-define
  if (/histor|previous|past|recent|earlier/.test(t)) { add('bot', 'history', { list: await api('/api/reports') }); return; }

  const setup = pendingSetup();
  if (setup) {
    const sd = setup.data;
    if (breakpoints.length && !/\b(add|also|include|plus|remove|drop|delete|without|exclude)\b/.test(t)) {
      Object.assign(sd, { breakpoints, manual: true });
      update(setup);
      say(`<p>Breakpoints set to <b>${breakpoints.join(', ')}</b>px. Say <code>run</code> when ready.</p>`);
      return;
    }
    const removeNums = /\b(remove|drop|delete|without|exclude)\b/.test(t) ? [...breakpoints, ...nums] : [];
    if (removeNums.length) {
      sd.breakpoints = sd.breakpoints.filter((b) => !removeNums.includes(b));
      sd.extra = sd.extra.filter((w) => !removeNums.includes(w));
      update(setup);
      say(`<p>Removed ${removeNums.join(', ')}px.</p>`);
      return;
    }
    if (/\bbreakpoints?\b/.test(t) && (breakpoints.length || nums.length)) {
      sd.breakpoints = numList([...sd.breakpoints, ...breakpoints, ...nums].join(','));
      update(setup);
      say(`<p>Breakpoints are now <b>${sd.breakpoints.join(', ')}</b>px.</p>`);
      return;
    }
    if (nums.length && /\b(add|also|include|test|plus)\b/.test(t)) {
      setup.data.extra = [...new Set([...setup.data.extra, ...nums])];
      update(setup);
      say(`<p>Added ${nums.join(', ')}px.</p>`);
      return;
    }
    if (/\b(run|go|start|yes|ok|okay|compare)\b/.test(t)) { await run(setup); return; }
  }

  if (!state.reportId) {
    say('<p>There\'s no comparison yet. Paste the <b>original</b> and <b>migrated</b> URLs, or type <code>demo</code> to try it.</p>');
    return;
  }
  const report = await loadReport(state.reportId);

  if (/download|export|pdf|save report|share/.test(t)) {
    const format = /html/.test(t) && !/pdf/.test(t) ? 'html' : 'pdf';
    say(`<p>Preparing the ${format.toUpperCase()} report: every issue with annotated Original/Migrated screenshots, plus all fixes.</p>
      <div class="actions"><button type="button" class="btn secondary" data-action="download" data-format="pdf" data-report="${esc(report.id)}">Download PDF</button>
      <button type="button" class="btn ghost" data-action="download" data-format="html" data-report="${esc(report.id)}">Download HTML</button></div>`);
    downloadReport(report.id, format).catch((e) => say(`<p class="err">${esc(e.message)}</p>`));
    return;
  }
  if (/\b(hide|close|turn off|off)\b.*visual|visual.*\b(off|hide|close)\b/.test(t)) { setVisual(false); say('<p>Visual parity hidden.</p>'); return; }
  if (/visual|side.by.side|screenshot|show (it |me )?(on|the) page|viewer|open/.test(t) && !issueNum) {
    const [w] = widthsFor(report, t, nums);
    setVisual(true, { width: w });
    say(`<p>Showing visual parity${w ? ` at ${w}px` : ''}. Click a pin or an issue to spotlight it.</p>`);
    return;
  }
  if (/re-?run|again|retest|refresh/.test(t) || (nums.length && /\b(add|also|include)\b/.test(t))) {
    say(`<p>Re-running the comparison${nums.length ? `, also testing ${nums.join(', ')}px` : ''}.</p>`);
    await rerun(nums);
    return;
  }
  if (/breakpoint/.test(t)) { add('bot', 'breakpoints', { reportId: report.id }); return; }
  if (/prompt|coder|agent/.test(t)) { add('bot', 'prompt', { reportId: report.id }); return; }
  if (issueNum) {
    const ws = widthsFor(report, t, nums);
    const order = ws.length ? ws : [state.visualWidth, ...report.widths].filter(Boolean);
    const hit = order.map((w) => report.results.find((r) => r.width === w)?.issues.find((i) => i.n === issueNum)).find(Boolean);
    if (!hit) { say(`<p>I couldn't find issue #${issueNum}${ws.length ? ` at ${ws.join(', ')}px` : ''}.</p>`); return; }
    add('bot', 'issue', { reportId: report.id, id: hit.id });
    if (state.visual) renderVisual({ width: hit.width, issueId: hit.id });
    return;
  }
  if (/\bfix|css|code|stylesheet/.test(t)) {
    const file = (report.fixes || []).find((f) => f.file.split(/[/.]/).some((p) => p.length > 2 && new RegExp(`\\b${p}\\b`).test(t) && !['css', 'blocks', 'styles'].includes(p)));
    add('bot', 'fixes', { reportId: report.id, file: file?.file });
    return;
  }
  if (/summary|score|overview|result|status|how did|how bad/.test(t)) { add('bot', 'summary', { reportId: report.id }); return; }

  const severity = ['high', 'medium', 'low'].filter((s) => t.includes(s));
  if (/critical|important|severe|major/.test(t)) severity.push('high');
  const category = CATEGORY_WORDS.filter(([re]) => re.test(t)).map(([, c]) => c);
  const widths = widthsFor(report, t, nums);
  if (severity.length || category.length || widths.length || /issue|problem|wrong|differ|bug|error|all/.test(t)) {
    add('bot', 'issues', {
      reportId: report.id,
      filter: { severity: severity.length ? [...new Set(severity)] : null, category: category.length ? category : null, widths },
    });
    return;
  }
  say('<p>I didn\'t catch that. Try <code>show high issues</code>, <code>issues on mobile</code>, <code>issue #2</code>, <code>show fixes</code> or <code>download PDF</code>. Type <code>help</code> for more.</p>');
}

async function send(text) {
  const clean = text.trim();
  if (!clean) return;
  add('user', 'text', { text: clean });
  try {
    await handle(clean);
  } catch (e) {
    say(`<p class="err">Something went wrong: ${esc(e.message)}</p>`);
  }
}

/* ------------------------------------------------------------ suggestions */

function renderSuggestions() {
  const box = root?.querySelector('.suggestions');
  if (!box) return;
  let items;
  const running = state.messages.some((m) => m.type === 'progress' && m.data.status === 'running');
  if (running) items = ['How does it work?'];
  else if (pendingSetup()) items = ['Run comparison', 'Add breakpoint 1280'];
  else if (state.reportId) {
    items = ['Show high issues', 'What\'s wrong on mobile?', 'Show all fixes', 'New comparison']; // the summary card has the download and visual buttons
  } else items = ['New comparison', 'Try the demo', 'How does it work?', 'Show history'];
  box.innerHTML = items.map((s) => `<button type="button" class="sugg" data-action="say" data-text="${esc(s)}">${esc(s)}</button>`).join('');
}

/* ------------------------------------------------------------ mount */

function onAction(e) {
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el)) return;
  const { action } = el.dataset;
  const msg = el.dataset.mid ? state.messages.find((m) => m.id === Number(el.dataset.mid)) : null;
  if (action === 'say') send(el.dataset.text);
  if (action === 'bp' && msg?.data.status === 'ready') {
    const v = Number(el.dataset.px);
    const bps = msg.data.breakpoints;
    msg.data.breakpoints = bps.includes(v) ? bps.filter((x) => x !== v) : [...bps, v].sort((a, b) => a - b);
    update(msg);
  }
  if (action === 'run' && msg) run(msg);
  if (action === 'bp-remove' && msg?.data.status === 'ready') {
    msg.data.breakpoints = msg.data.breakpoints.filter((b) => b !== Number(el.dataset.px));
    update(msg);
  }
  if (action === 'width-remove' && msg?.data.status === 'ready') {
    msg.data.extra = msg.data.extra.filter((w) => w !== Number(el.dataset.px));
    update(msg);
  }
  if (action === 'detect' && msg) detectInto(msg);
  if (action === 'form') addForm(); // eslint-disable-line no-use-before-define
  if (action === 'form-demo' && msg) {
    Object.assign(msg.data, {
      original: `${window.location.origin}/demo/original.html`, migrated: `${window.location.origin}/demo/migrated.html`, breakpoints: [640, 1024],
    });
    update(msg);
  }
  if (action === 'form-bp-add' && msg) addFormBreakpoint(msg); // eslint-disable-line no-use-before-define
  if (action === 'form-bp-remove' && msg) {
    msg.data.breakpoints = numList(msg.data.breakpoints).filter((b) => b !== Number(el.dataset.px));
    msg.data.bpError = '';
    update(msg);
  }
  if (action === 'form-bp-preset' && msg) {
    const v = Number(el.dataset.px);
    const bps = numList(msg.data.breakpoints);
    msg.data.breakpoints = bps.includes(v) ? bps.filter((b) => b !== v) : numList([...bps, v].join(','));
    msg.data.bpError = '';
    update(msg);
  }
  if (action === 'form-bp-clear' && msg) {
    Object.assign(msg.data, { breakpoints: [], note: '', bpError: '' });
    update(msg);
  }
  if (action === 'form-detect' && msg) {
    const d = msg.data;
    if (!/^https?:\/\//.test(d.original)) {
      d.bpError = 'Enter the original page URL first, then detect.';
      update(msg).then(() => root.querySelector(`.form-msg[data-mid="${msg.id}"] input[name="original"]`)?.focus());
      return;
    }
    el.disabled = true;
    el.textContent = 'Detecting…';
    api('/api/breakpoints', { url: d.original }).then((det) => {
      const added = det.suggested.filter((b) => !numList(d.breakpoints).includes(b));
      Object.assign(d, {
        breakpoints: numList([...numList(d.breakpoints), ...det.suggested].join(',')),
        note: det.suggested.length
          ? `Detected ${det.suggested.join(', ')}px from ${det.mediaRules} media rules on the original${added.length ? '' : ' (already in your list)'}. Remove any you don't need.`
          : 'No media-query breakpoints found on the original. Add your own.',
        bpError: '',
      });
    }).catch((err) => { d.bpError = `Couldn't read the original: ${err.message}`; }).finally(() => update(msg));
  }
  if (action === 'visual') {
    state.reportId = el.dataset.report || state.reportId;
    setVisual(true, { width: el.dataset.width ? Number(el.dataset.width) : undefined });
  }
  if (action === 'issue') {
    state.reportId = el.dataset.report || state.reportId;
    const width = Number(el.dataset.id.split('-')[0]);
    setVisual(true, { width, issueId: el.dataset.id });
  }
  if (action === 'close-visual') setVisual(false);
  if (action === 'download') {
    downloadReport(el.dataset.report, el.dataset.format, el).catch((err) => say(`<p class="err">${esc(err.message)}</p>`));
  }
  if (action === 'fix-prompt') {
    // fetch first, then copy: the click still counts as the user gesture for the clipboard
    fixPrompt(el.dataset.report).then((text) => copy(text, el, 'Copied: paste it into AEM Coder'))
      .catch((err) => say(`<p class="err">${esc(err.message)}</p>`));
  }
  if (el.classList.contains('copy')) copy(el.dataset.copy, el);
}

export function mountChat(app, params) {
  load();
  // chat controls live in the top bar, next to Chat / History
  const actions = document.getElementById('topbar-actions');
  actions.innerHTML = `<label class="switch" title="Show both pages side by side with issues marked">
      <input type="checkbox" id="visual-toggle"><span class="track"><span class="thumb"></span></span><span>Visual parity</span></label>
    <button type="button" class="btn tiny" id="new-chat">New chat</button>`;
  app.innerHTML = `<div class="chat-app">
    <section class="chat-col">
      <div class="messages" aria-live="polite"></div>
      <div class="composer">
        <div class="suggestions"></div>
        <form class="composer-form">
          <button type="button" class="form-btn" data-action="form" title="Open the comparison form (URLs and breakpoints)" aria-label="Open the comparison form">
            <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 5.5h6M5 8h6M5 10.5h3.5"/></svg>Form</button>
          <textarea rows="1" placeholder="Paste two URLs, or ask about the results…" aria-label="Message"></textarea>
          <button type="submit" class="btn primary" aria-label="Send">Send</button>
        </form>
      </div>
    </section>
    <section class="visual-col"></section>
    <datalist id="recent-original"></datalist><datalist id="recent-migrated"></datalist>
  </div>`;
  root = app.querySelector('.chat-app');
  root.addEventListener('click', onAction);
  actions.querySelector('#visual-toggle').addEventListener('change', (e) => setVisual(e.target.checked));
  root.addEventListener('keydown', (e) => {
    const el = e.target;
    if (el.matches('.bp-add-input') && e.key === 'Enter') {
      e.preventDefault(); // add the breakpoint, don't submit the form
      const msg = state.messages.find((m) => m.id === Number(el.dataset.mid));
      if (msg) addFormBreakpoint(msg);
      return;
    }
    if (el.matches('.add-inline input') && e.key === 'Enter') {
      e.preventDefault();
      const v = Number(el.value);
      const msg = state.messages.find((m) => m.id === Number(el.dataset.mid));
      const list = el.dataset.list === 'breakpoints' ? 'breakpoints' : 'extra';
      if (msg && v >= 280 && v <= 3840) {
        msg.data[list] = [...new Set([...msg.data[list], v])].sort((a, b) => a - b);
        if (list === 'breakpoints') msg.data.manual = true;
        update(msg);
      }
    }
  });
  // form card: keep its values in the message (so a reload restores them) and the preview live
  root.addEventListener('input', (e) => {
    const card = e.target.closest('.form-msg');
    if (!card) return;
    const msg = state.messages.find((m) => m.id === Number(card.dataset.mid));
    if (!msg) return;
    const { name, value } = e.target;
    if (name) msg.data[name] = value;
    const ws = formWidths(msg.data);
    card.querySelector('.f-widths').textContent = ws.length ? `${ws.join(', ')}px` : '…';
    save();
  });
  // URL fields: fix up a missing https://, check as you leave the field, and recall
  // what was used last time for this site (breakpoints, ignored elements, paired page)
  root.addEventListener('change', async (e) => {
    const card = e.target.closest('.form-msg');
    const { name } = e.target;
    if (!card || !['original', 'migrated'].includes(name)) return;
    const msg = state.messages.find((m) => m.id === Number(card.dataset.mid));
    if (!msg) return;
    const url = normalizeUrl(e.target.value); // eslint-disable-line no-use-before-define
    e.target.value = url;
    msg.data[name] = url;
    const errEl = e.target.parentElement.querySelector('.f-err');
    const bad = url && !isPageUrl(url); // eslint-disable-line no-use-before-define
    errEl.textContent = bad ? 'That doesn\'t look like a page URL, e.g. https://www.example.com/about' : '';
    e.target.setAttribute('aria-invalid', String(!!bad));
    save();
    if (bad || name !== 'original' || !url) return;
    const d = msg.data;
    const [sites, reports] = await Promise.all([api('/api/sites').catch(() => ({})), api('/api/reports').catch(() => [])]);
    const saved = sites[hostOf(url)];
    let changed = false;
    if (saved?.breakpoints?.length && !numList(d.breakpoints).length) {
      const custom = (saved.hideSelectors || []).filter((s) => !DEFAULT_HIDE.includes(s));
      Object.assign(d, {
        breakpoints: saved.breakpoints,
        note: `Using the breakpoints you used last time for ${hostOf(url)}. Edit them if needed.`,
        ignore: d.ignore || custom.join('\n'),
      });
      changed = true;
    }
    const last = reports.find((r) => r.original === url);
    if (last && !d.migrated) {
      d.migrated = last.migrated; // the page it was compared with last time
      changed = true;
    }
    if (changed) update(msg);
  });
  root.addEventListener('submit', (e) => {
    const card = e.target.closest('.form-msg');
    if (!card) return;
    e.preventDefault();
    const msg = state.messages.find((m) => m.id === Number(card.dataset.mid));
    if (msg) submitForm(msg); // eslint-disable-line no-use-before-define
  });
  const form = root.querySelector('.composer-form');
  const input = form.querySelector('textarea');
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(160, input.scrollHeight)}px`; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    grow();
    send(text);
  });
  actions.querySelector('#new-chat').addEventListener('click', () => {
    Object.assign(state, {
      messages: [], reportId: null, visualWidth: null, pending: {},
    });
    save();
    mountChat(app, new URLSearchParams());
  });

  if (!state.messages.length) {
    say(`<p>Hi! I check the <b>visual parity</b> between an original page and its migrated page, at the breakpoints you choose.</p>
      <p>Fill in the form below, or just type it, e.g. <code>compare https://www.example.com/about with https://main--site--org.aem.page/about breakpoints 768, 1024</code>.</p>`);
    addForm();
  } else {
    // replay the conversation; reconnect to comparisons that were still running
    Promise.all(state.messages.map(mountMessage)).then(scrollDown);
    state.messages.filter((m) => m.type === 'progress' && m.data.status === 'running').forEach(watchJob);
  }
  renderSuggestions();
  renderVisual();
  refreshRecent();

  const open = params.get('open');
  const again = params.get('rerun');
  if (open || again) {
    window.history.replaceState(null, '', '#/');
    state.reportId = open || again;
    if (open) add('bot', 'summary', { reportId: open });
    else { add('user', 'text', { text: 'Re-run this comparison' }); rerun().catch((e) => say(`<p class="err">${esc(e.message)}</p>`)); }
    if (state.visual) renderVisual();
  }
  setTimeout(() => input.focus(), 50);
  return () => workspace?.destroy();
}
