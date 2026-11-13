import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import {
  readFile, writeFile, readdir, stat, mkdir,
} from 'node:fs/promises';
import {
  join, dirname, extname, normalize, resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { detectBreakpoints, testWidths } from './lib/breakpoints.js';
import { runComparison } from './lib/run.js';
import { buildExport, exportName } from './lib/export.js';
import { buildFixPrompt, buildBatchPrompt } from './lib/prompt.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(ROOT, '..', '..');
const PUBLIC = join(ROOT, 'public');
const DEMO = join(ROOT, 'demo');
const REPORTS = join(ROOT, 'reports');
const SITES = join(ROOT, 'sites.json');
const PORT = parseInt(process.env.PORT || '4300', 10);
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const jobs = new Map();
let queue = Promise.resolve();

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

async function readBody(req) {
  const chunks = [];
  // eslint-disable-next-line no-restricted-syntax
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  return raw ? JSON.parse(raw) : {};
}

function validUrl(u) {
  try {
    const url = new URL(u);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch (e) {
    return null;
  }
}

// demo pages are served by this server, so make relative demo URLs absolute
const absolutize = (u) => (u && u.startsWith('/demo/') ? `http://${HOST}:${PORT}${u}` : u);

async function serveFile(res, base, rel) {
  const file = normalize(join(base, rel));
  if (!file.startsWith(base) || !existsSync(file) || !(await stat(file)).isFile()) {
    send(res, 404, { error: 'not found' });
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(file).pipe(res);
}

async function loadSites() {
  try {
    return JSON.parse(await readFile(SITES, 'utf8'));
  } catch (e) {
    return {};
  }
}

async function listReports() {
  if (!existsSync(REPORTS)) return [];
  const ids = await readdir(REPORTS);
  const out = await Promise.all(ids.map(async (id) => {
    try {
      const r = JSON.parse(await readFile(join(REPORTS, id, 'report.json'), 'utf8'));
      return {
        id, created: r.created, original: r.original, migrated: r.migrated, widths: r.widths, summary: r.summary,
      };
    } catch (e) {
      return null;
    }
  }));
  return out.filter(Boolean).sort((a, b) => b.created.localeCompare(a.created));
}

/**
 * Downloadable PDF report with annotated screenshots, printed by Chromium
 * and cached next to the report.
 */
async function exportReport(res, id) {
  const dir = join(REPORTS, id);
  const jsonFile = join(dir, 'report.json');
  if (!existsSync(jsonFile)) { send(res, 404, { error: 'unknown report' }); return; }
  const report = JSON.parse(await readFile(jsonFile, 'utf8'));
  const reviewFile = join(dir, 'review.json');
  if (existsSync(reviewFile)) report.review = JSON.parse(await readFile(reviewFile, 'utf8')).statuses || {};
  const attach = (name, type, body) => {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  };
  const pdfFile = join(dir, 'export.pdf');
  const newest = Math.max((await stat(jsonFile)).mtimeMs, existsSync(reviewFile) ? (await stat(reviewFile)).mtimeMs : 0);
  if (!existsSync(pdfFile) || (await stat(pdfFile)).mtimeMs < newest) {
    const { html } = await buildExport(report, dir, { inline: false });
    await writeFile(join(dir, 'export.html'), html);
    const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
    try {
      const page = await browser.newPage();
      await page.goto(`http://${HOST}:${PORT}/reports/${id}/export.html`, { waitUntil: 'load', timeout: 120000 });
      await page.pdf({
        path: pdfFile, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
      });
    } finally {
      await browser.close();
    }
  }
  attach(`${exportName(report)}.pdf`, 'application/pdf', await readFile(pdfFile));
}

function notifyStatus(job) {
  job.listeners.forEach((fn) => fn({
    type: 'status', status: job.status, error: job.error, summary: job.summary,
  }));
}

function startJob(body) {
  const original = validUrl(absolutize(body.original));
  const migrated = validUrl(absolutize(body.migrated));
  if (!original || !migrated) throw new Error('Both URLs must be valid http(s) URLs.');
  const breakpoints = (body.breakpoints || []).map(Number).filter((n) => n > 0);
  let widths = (body.widths || []).map(Number).filter((n) => n >= 280 && n <= 3840);
  if (!widths.length) widths = testWidths(breakpoints);
  if (!widths.length) throw new Error('Add at least one breakpoint to test.');
  widths = [...new Set(widths)].sort((a, b) => a - b);
  const job = {
    id: `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${randomUUID().slice(0, 6)}`,
    original,
    migrated,
    breakpoints,
    widths,
    options: body.options || {},
    status: 'queued',
    progress: 0,
    log: [],
    listeners: new Set(),
  };
  const log = (message, progress) => {
    if (progress !== undefined) job.progress = progress;
    const entry = { t: Date.now(), message, progress: job.progress };
    job.log.push(entry);
    job.listeners.forEach((fn) => fn({ type: 'log', ...entry }));
  };
  jobs.set(job.id, job);
  queue = queue.then(async () => {
    if (job.status === 'cancelled') return; // stopped while it was waiting
    job.status = 'running';
    log('Started');
    try {
      const report = await runComparison(job, { reportsDir: REPORTS, repoRoot: REPO_ROOT, log });
      job.summary = report.summary;
      job.status = 'done';
    } catch (e) {
      job.status = 'error';
      job.error = e.message;
      log(`Error: ${e.message}`);
    }
    notifyStatus(job);
  });
  return job;
}

const FINAL = new Set(['done', 'error', 'cancelled']);
const MAX_BATCH = 100;

/**
 * Several page pairs at once: one job per pair, run one after another by the
 * same queue. All pairs are checked first, so a typo doesn't start half a batch.
 */
function startBatch(body) {
  const pairs = Array.isArray(body.pairs) ? body.pairs : [];
  if (!pairs.length) throw new Error('Add at least one page pair.');
  if (pairs.length > MAX_BATCH) throw new Error(`Up to ${MAX_BATCH} pages per batch. Split the list.`);
  pairs.forEach((p, i) => {
    if (!validUrl(absolutize(p.original)) || !validUrl(absolutize(p.migrated))) {
      throw new Error(`Page ${i + 1}: both URLs must be valid http(s) URLs.`);
    }
  });
  return pairs.map((p) => startJob({
    original: p.original,
    migrated: p.migrated,
    breakpoints: p.breakpoints?.length ? p.breakpoints : body.breakpoints,
    options: p.options || body.options,
  }));
}

/** Streams the progress of several jobs (a batch) over one connection. */
function streamJobs(req, res, ids) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  const open = new Set();
  const subs = [];
  const finish = () => {
    if (open.size) return;
    res.write(`data: ${JSON.stringify({ type: 'end' })}\n\n`);
    res.end();
  };
  ids.forEach((id) => {
    const job = jobs.get(id);
    const push = (ev) => res.write(`data: ${JSON.stringify({ jobId: id, ...ev })}\n\n`);
    if (!job) { push({ type: 'status', status: 'lost' }); return; } // the tool was restarted
    job.log.forEach((e) => push({ type: 'log', ...e }));
    if (FINAL.has(job.status)) {
      push({
        type: 'status', status: job.status, error: job.error, summary: job.summary,
      });
      return;
    }
    open.add(id);
    const fn = (ev) => {
      push(ev);
      if (ev.type === 'status') {
        job.listeners.delete(fn);
        open.delete(id);
        finish();
      }
    };
    job.listeners.add(fn);
    subs.push([job, fn]);
  });
  finish();
  req.on('close', () => subs.forEach(([job, fn]) => job.listeners.delete(fn)));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (req.method === 'POST' && p === '/api/breakpoints') {
      const body = await readBody(req);
      const target = validUrl(absolutize(body.url));
      if (!target) { send(res, 400, { error: 'Invalid URL' }); return; }
      const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
      try {
        const result = await detectBreakpoints(browser, target);
        send(res, 200, result);
      } finally {
        await browser.close();
      }
      return;
    }
    if (p === '/api/sites' && req.method === 'GET') { send(res, 200, await loadSites()); return; }
    if (p === '/api/sites' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.host) { send(res, 400, { error: 'host required' }); return; }
      const sites = await loadSites();
      sites[body.host] = {
        breakpoints: body.breakpoints || [],
        extraWidths: body.extraWidths || [],
        hideSelectors: body.hideSelectors || [],
        updated: new Date().toISOString(),
      };
      await writeFile(SITES, `${JSON.stringify(sites, null, 2)}\n`);
      send(res, 200, sites[body.host]);
      return;
    }
    if (p === '/api/widths' && req.method === 'POST') {
      const body = await readBody(req);
      send(res, 200, { widths: testWidths(body.breakpoints || []) });
      return;
    }
    if (p === '/api/jobs' && req.method === 'POST') {
      const job = startJob(await readBody(req));
      send(res, 202, { id: job.id, widths: job.widths });
      return;
    }
    if (p === '/api/batches' && req.method === 'POST') {
      const list = startBatch(await readBody(req));
      send(res, 202, { jobs: list.map((j) => ({ id: j.id, widths: j.widths })) });
      return;
    }
    if (p === '/api/jobs/events') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter((id) => /^[\w-]+$/.test(id));
      streamJobs(req, res, ids);
      return;
    }
    if (p === '/api/jobs/cancel' && req.method === 'POST') {
      // waiting jobs are dropped; the one already running finishes
      const { ids = [] } = await readBody(req);
      const cancelled = ids.map((id) => jobs.get(id)).filter((j) => j?.status === 'queued');
      cancelled.forEach((j) => { j.status = 'cancelled'; notifyStatus(j); });
      send(res, 200, { cancelled: cancelled.map((j) => j.id) });
      return;
    }
    if (p === '/api/fix-prompt' && req.method === 'POST') {
      // one AEM Coder prompt for several reports (a batch)
      const { ids = [] } = await readBody(req);
      const entries = (await Promise.all(ids.filter((id) => /^[\w-]+$/.test(id)).map(async (id) => {
        const dir = join(REPORTS, id);
        if (!existsSync(join(dir, 'report.json'))) return null;
        const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));
        const reviewFile = join(dir, 'review.json');
        const statuses = existsSync(reviewFile) ? JSON.parse(await readFile(reviewFile, 'utf8')).statuses || {} : {};
        return { report, statuses };
      }))).filter(Boolean);
      if (!entries.length) { send(res, 404, { error: 'No finished reports' }); return; }
      send(res, 200, entries.length === 1 ? buildFixPrompt(entries[0].report, entries[0].statuses) : buildBatchPrompt(entries), 'text/markdown; charset=utf-8');
      return;
    }
    let m = p.match(/^\/api\/jobs\/([\w-]+)\/events$/);
    if (m) {
      const job = jobs.get(m[1]);
      if (!job) { send(res, 404, { error: 'unknown job' }); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      const push = (ev) => {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
        if (ev.type === 'status') {
          job.listeners.delete(push);
          res.end();
        }
      };
      job.log.forEach((e) => push({ type: 'log', ...e }));
      if (FINAL.has(job.status)) {
        push({
          type: 'status', status: job.status, error: job.error, summary: job.summary,
        });
        return;
      }
      job.listeners.add(push);
      req.on('close', () => job.listeners.delete(push));
      return;
    }
    m = p.match(/^\/api\/reports\/([\w-]+)\/review$/);
    if (m) {
      // review decisions per issue: 'fix' (needs fix) or 'ok' (difference approved)
      const dir = join(REPORTS, m[1]);
      if (!existsSync(join(dir, 'report.json'))) { send(res, 404, { error: 'unknown report' }); return; }
      const file = join(dir, 'review.json');
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const statuses = Object.fromEntries(Object.entries(body.statuses || {})
          .filter(([k, v]) => /^\d+-\d+$/.test(k) && ['fix', 'ok'].includes(v)));
        await writeFile(file, JSON.stringify({ statuses, updated: new Date().toISOString() }));
        send(res, 200, { ok: true });
      } else {
        send(res, 200, existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : { statuses: {} });
      }
      return;
    }
    m = p.match(/^\/api\/reports\/([\w-]+)\/fix-prompt$/);
    if (m) {
      // prompt for AEM Coder: open issues (approved ones left out) and suggested CSS
      const dir = join(REPORTS, m[1]);
      if (!existsSync(join(dir, 'report.json'))) { send(res, 404, { error: 'unknown report' }); return; }
      const report = JSON.parse(await readFile(join(dir, 'report.json'), 'utf8'));
      const reviewFile = join(dir, 'review.json');
      const statuses = existsSync(reviewFile) ? JSON.parse(await readFile(reviewFile, 'utf8')).statuses || {} : {};
      const prompt = buildFixPrompt(report, statuses);
      await writeFile(join(dir, 'fix-prompt.md'), prompt);
      send(res, 200, prompt, 'text/markdown; charset=utf-8');
      return;
    }
    m = p.match(/^\/api\/reports\/([\w-]+)\/export\.(pdf)$/);
    if (m) {
      await exportReport(res, m[1]);
      return;
    }
    if (p === '/api/reports') { send(res, 200, await listReports()); return; }
    m = p.match(/^\/reports\/([\w-]+)\/([\w.-]+)$/);
    if (m) { await serveFile(res, REPORTS, join(m[1], m[2])); return; }
    if (p.startsWith('/demo/')) { await serveFile(res, DEMO, p.slice(6)); return; }
    await serveFile(res, PUBLIC, p === '/' ? 'index.html' : p.slice(1));
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

await mkdir(REPORTS, { recursive: true });
server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Parity Check running at http://${HOST}:${PORT}`);
});
