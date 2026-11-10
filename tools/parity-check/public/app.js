import {
  esc, api, copy, scoreClass, historyItems, loadReport, downloadReport,
} from './js/util.js';
import { matrixHtml, fixesHtml, mountWorkspace } from './js/visual.js';
import { mountChat } from './js/chat.js';

const app = document.getElementById('app');
let teardown = null;

/* ------------------------------------------------------------ full report page */

async function renderReport(id, params) {
  app.innerHTML = '<p class="loading">Loading report…</p>';
  let report;
  try {
    report = await loadReport(id);
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
        <a class="btn ghost" href="#/?open=${esc(report.id)}">Open in chat</a>
        <button type="button" class="btn ghost" data-dl="html">HTML report</button>
        <button type="button" class="btn secondary" data-dl="pdf">Download PDF report</button>
      </div>
    </section>
    ${showMismatch ? `<div class="banner"><b>Breakpoints don't match.</b>
      ${mismatch.missingInMigrated.length ? `The migrated CSS has no media query at <b>${mismatch.missingInMigrated.join(', ')}px</b>.` : ''}
      ${mismatch.extraInMigrated.length ? `It switches layout at <b>${mismatch.extraInMigrated.join(', ')}px</b> instead.` : ''}
      <a class="btn tiny" href="#/?rerun=${esc(report.id)}">Re-run in chat</a></div>` : ''}
    <nav class="tabs">${tabs.map((t) => (t.r
    ? `<button type="button" data-tab="${t.key}"><b>${t.r.width}px</b><span class="score-pill sm ${scoreClass(t.r.score)}">${t.r.score}</span>${t.r.stats.high ? `<span class="tc high">${t.r.stats.high}</span>` : ''}</button>`
    : `<button type="button" data-tab="${t.key}" class="aux"><b>${t.key === 'matrix' ? 'Across breakpoints' : 'All fixes'}</b></button>`)).join('')}</nav>
    <section id="tab-body"></section>`;

  app.querySelectorAll('[data-dl]').forEach((b) => b.addEventListener('click', () => downloadReport(report.id, b.dataset.dl, b)));
  const body = document.getElementById('tab-body');
  let ws;
  const showTab = (key, focusId) => {
    current = key;
    ws?.destroy();
    ws = null;
    app.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === key));
    const url = new URL(window.location.href);
    url.hash = `#/report/${id}?${new URLSearchParams({ tab: key })}`;
    window.history.replaceState(null, '', url);
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
    if (result) ws = mountWorkspace(body, report, result, { focusId, onWidthChange: (w) => showTab(String(w)) });
  };
  app.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  if (!tabs.some((t) => t.key === current)) current = tabs[0].key;
  showTab(current, params.get('issue'));
  teardown = () => ws?.destroy();
}

async function renderHistory() {
  app.innerHTML = '<section class="card page-card"><h1>History</h1><p class="muted">Open a comparison to continue it in the chat.</p><div class="history-list" id="hl"><p class="muted">Loading…</p></div></section>';
  document.getElementById('hl').innerHTML = historyItems(await api('/api/reports'));
}

/* ------------------------------------------------------------ router */

function route() {
  teardown?.();
  document.getElementById('topbar-actions').innerHTML = ''; // only the chat puts controls here
  teardown = null;
  const [path, query] = window.location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query || '');
  const parts = (path || '/').split('/').filter(Boolean);
  document.body.classList.toggle('route-chat', !parts.length);
  if (parts[0] === 'report' && parts[1]) renderReport(parts[1], params);
  else if (parts[0] === 'history') renderHistory();
  else teardown = mountChat(app, params);
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
