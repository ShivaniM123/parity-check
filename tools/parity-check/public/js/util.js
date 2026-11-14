export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
export const api = async (path, body) => {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || res.statusText);
  return json;
};
export const hostOf = (u) => { try { return u ? new URL(u).host : ''; } catch (e) { return ''; } };
export const SEV_ORDER = { high: 0, medium: 1, low: 2 };
export const CATEGORY_LABEL = {
  layout: 'Layout', typography: 'Typography', color: 'Color', spacing: 'Spacing', content: 'Content', image: 'Image', responsive: 'Responsive', component: 'Component', page: 'Page',
};

/** Widths to test: exactly the chosen breakpoints, plus any widths asked for in the chat. */
export function testWidths(bps, extra = []) {
  return [...new Set([...bps, ...extra])].filter((w) => w >= 280).sort((a, b) => a - b);
}

export async function copy(text, btn, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // no clipboard API (plain http, or the fetch took the user gesture): copy from a hidden field
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (!ok) throw new Error('Copying is blocked in this browser. Type "prompt for AEM Coder" and copy it from the preview.');
  }
  const old = btn.textContent;
  btn.textContent = done;
  setTimeout(() => { btn.textContent = old; }, 1800);
}

export function scoreClass(score) {
  if (score >= 85) return 'good';
  if (score >= 65) return 'fair';
  return 'poor';
}

export function historyItems(list) {
  if (!list.length) return '<p class="muted">No comparisons yet.</p>';
  return list.map((r) => `
    <a class="history-item" href="#/?open=${esc(r.id)}">
      <span class="score-pill ${scoreClass(r.summary?.score ?? 0)}">${r.summary?.score ?? '–'}</span>
      <span class="hi-main">
        <span class="hi-urls">${esc(r.original)}<br><span class="muted">→ ${esc(r.migrated)}</span></span>
        <span class="hi-meta">${new Date(r.created).toLocaleString()} · ${r.widths.join(', ')}px
          · <b class="txt-high">${r.summary?.high ?? 0}</b> / <b class="txt-medium">${r.summary?.medium ?? 0}</b> / <b class="txt-low">${r.summary?.low ?? 0}</b></span>
      </span>
    </a>`).join('');
}

export const reportCache = new Map();
export async function loadReport(id) {
  if (!reportCache.has(id)) {
    const res = await fetch(`/reports/${id}/report.json`);
    if (!res.ok) throw new Error('Report not found');
    reportCache.set(id, await res.json());
  }
  return reportCache.get(id);
}

/** Downloads the PDF report, showing progress on the button. */
export async function downloadReport(id, format, btn) {
  const old = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = format === 'pdf' ? 'Preparing PDF…' : 'Preparing…';
  }
  try {
    const res = await fetch(`/api/reports/${id}/export.${format}`);
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || `parity-report.${format}`;
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = old;
    }
  }
}

/* review decisions per issue ('fix' | 'ok'), shared by every view of a report */
const reviewCache = new Map();
export function getReview(id) {
  if (!reviewCache.has(id)) {
    reviewCache.set(id, fetch(`/api/reports/${id}/review`)
      .then((r) => (r.ok ? r.json() : { statuses: {} }))
      .then((j) => j.statuses || {})
      .catch(() => ({})));
  }
  return reviewCache.get(id);
}
const saveTimers = new Map();
export function saveReview(id, statuses) {
  clearTimeout(saveTimers.get(id));
  saveTimers.set(id, setTimeout(() => {
    fetch(`/api/reports/${id}/review`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statuses }),
    });
  }, 250));
}
