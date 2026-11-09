/**
 * Matches elements of the original page to elements of the migrated page.
 * Text elements are matched by content, then images/controls by position
 * using a vertical mapping learned from the matched text ("anchors").
 */

export const textKey = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const compatible = (a, b) => {
  if (a.kind === b.kind) return true;
  const textual = ['heading', 'text'];
  return textual.includes(a.kind) && textual.includes(b.kind);
};

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i += 1) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

export function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  A.forEach((n, g) => { inter += Math.min(n, B.get(g) || 0); });
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

/** Longest increasing subsequence on migrated y, to drop crossing anchors. */
function monotone(points) {
  const sorted = [...points].sort((p, q) => p.o - q.o || p.m - q.m);
  const n = sorted.length;
  const len = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);
  let best = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = Math.max(0, i - 200); j < i; j += 1) {
      if (sorted[j].m <= sorted[i].m && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
    if (len[i] > len[best]) best = i;
  }
  const out = [];
  for (let k = n ? best : -1; k >= 0; k = prev[k]) out.unshift(sorted[k]);
  return out;
}

/** Piecewise-linear map from original y to migrated y. */
function buildYMap(anchors, ratio) {
  const pts = monotone(anchors);
  return (y) => {
    if (!pts.length) return y * ratio;
    if (y <= pts[0].o) return pts[0].m - (pts[0].o - y) * ratio;
    const last = pts[pts.length - 1];
    if (y >= last.o) return last.m + (y - last.o) * ratio;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1; // eslint-disable-line no-bitwise
      if (pts[mid].o <= y) lo = mid; else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    const t = b.o === a.o ? 0 : (y - a.o) / (b.o - a.o);
    return a.m + t * (b.m - a.m);
  };
}

export function matchElements(orig, mig, { origHeight, migHeight }) {
  const ratio = origHeight ? migHeight / origHeight : 1;
  const pairs = new Map(); // orig.i -> mig
  const used = new Set();
  const take = (o, m) => { pairs.set(o.i, m); used.add(m.i); };

  const oText = orig.filter((e) => e.kind !== 'image' && e.kind !== 'control' && textKey(e.text));
  const mText = mig.filter((e) => e.kind !== 'image' && e.kind !== 'control' && textKey(e.text));
  const byKey = new Map();
  mText.forEach((e) => {
    const k = textKey(e.text);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  });
  const oCount = new Map();
  oText.forEach((e) => { const k = textKey(e.text); oCount.set(k, (oCount.get(k) || 0) + 1); });

  // pass 1: unique exact text in both pages
  oText.forEach((o) => {
    const k = textKey(o.text);
    const cands = (byKey.get(k) || []).filter((m) => compatible(o, m));
    if (oCount.get(k) === 1 && cands.length === 1 && !used.has(cands[0].i)) take(o, cands[0]);
  });
  let anchors = [...pairs.entries()]
    .map(([oi, m]) => ({ o: orig[oi].rect.y, m: m.rect.y, ov: orig[oi].visible, mv: m.visible }))
    .filter((p) => p.ov && p.mv);
  let ymap = buildYMap(anchors, ratio);

  const score = (o, m, sim) => {
    const predicted = ymap(o.rect.y);
    const dy = Math.abs(predicted - m.rect.y);
    const vis = o.visible === m.visible ? 0 : 0.3;
    const kind = o.kind === m.kind ? 0 : 0.1;
    return sim - Math.min(dy / 3000, 0.5) - vis - kind;
  };

  // pass 2: exact text with duplicates, closest predicted position wins
  oText.forEach((o) => {
    if (pairs.has(o.i)) return;
    const cands = (byKey.get(textKey(o.text)) || []).filter((m) => !used.has(m.i) && compatible(o, m));
    if (!cands.length) return;
    cands.sort((p, q) => score(o, q, 1) - score(o, p, 1));
    take(o, cands[0]);
  });

  anchors = [...pairs.entries()]
    .map(([oi, m]) => ({ o: orig[oi].rect.y, m: m.rect.y, ov: orig[oi].visible, mv: m.visible }))
    .filter((p) => p.ov && p.mv);
  ymap = buildYMap(anchors, ratio);

  // pass 3: fuzzy text (copy edits, whitespace, truncated text)
  const freeM = mText.filter((m) => !used.has(m.i));
  oText.forEach((o) => {
    if (pairs.has(o.i)) return;
    const k = textKey(o.text);
    if (k.length < 6) return;
    let best = null;
    let bestScore = 0.55;
    freeM.forEach((m) => {
      if (used.has(m.i) || !compatible(o, m)) return;
      const mk = textKey(m.text);
      if (Math.abs(mk.length - k.length) > Math.max(k.length, mk.length) * 0.5) return;
      const sim = dice(k, mk);
      if (sim < 0.72) return;
      const s = score(o, m, sim);
      if (s > bestScore) { bestScore = s; best = m; }
    });
    if (best) take(o, best);
  });

  // pass 4: images and controls by alt/aspect/position
  ['image', 'control'].forEach((kind) => {
    const oi = orig.filter((e) => e.kind === kind && e.visible);
    const mi = mig.filter((e) => e.kind === kind && e.visible);
    const cand = [];
    oi.forEach((o) => {
      mi.forEach((m) => {
        const predicted = ymap(o.rect.y);
        const dy = Math.abs(predicted - m.rect.y);
        if (dy > 1200) return;
        const ao = o.rect.w / Math.max(1, o.rect.h);
        const am = m.rect.w / Math.max(1, m.rect.h);
        const aspect = 1 - Math.min(1, Math.abs(Math.log(ao / am)));
        const alt = o.alt && m.alt && textKey(o.alt) === textKey(m.alt) ? 0.4 : 0;
        const pos = 1 - dy / 1200;
        const dx = 1 - Math.min(1, Math.abs((o.rect.x / Math.max(1, o.rect.w)) - (m.rect.x / Math.max(1, m.rect.w))) / 4);
        cand.push({
          o, m, s: alt + aspect * 0.25 + pos * 0.5 + dx * 0.15,
        });
      });
    });
    cand.sort((p, q) => q.s - p.s);
    cand.forEach(({ o, m, s }) => {
      if (s < 0.55 || pairs.has(o.i) || used.has(m.i)) return;
      take(o, m);
    });
  });

  const matched = [...pairs.entries()].map(([oi, m]) => ({ o: orig[oi], m }));
  // pairs that keep their vertical order on both pages; shuffled ones (random teasers,
  // search results, carousels) are left out of spacing and layout comparisons
  const ordered = new Set(monotone(matched
    .filter((p) => p.o.visible && p.m.visible)
    .map((p) => ({ o: p.o.rect.y, m: p.m.rect.y, i: p.o.i }))).map((p) => p.i));
  matched.forEach((p) => { p.inOrder = ordered.has(p.o.i); });
  const missing = orig.filter((o) => o.visible && !pairs.has(o.i));
  const extra = mig.filter((m) => m.visible && !used.has(m.i));
  return {
    matched, missing, extra, ymap,
  };
}
