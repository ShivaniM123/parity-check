/**
 * Matches elements of the original page to elements of the migrated page.
 * Text elements are matched by content, then images/controls by position
 * using a vertical mapping learned from the matched text ("anchors").
 * Positions are always predicted from matched content nearby (the element's own
 * section), never from the page height alone: a section that moved down because
 * something above it got taller is still the same section, not a missing one.
 */

export const textKey = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// the same words can be a heading on one page and a link on the other (a card title
// wrapped in a link, or a link wrapping a heading): the text is what identifies them
const compatible = (a, b) => {
  if (a.kind === b.kind) return true;
  const textual = ['heading', 'text', 'action'];
  return textual.includes(a.kind) && textual.includes(b.kind);
};

/** What an image or icon control is called: alt, its link/button label, or aria-label. */
const labelOf = (e) => {
  if (e.kind === 'image') return textKey(e.label || e.alt);
  return e.labelOnly ? textKey(e.text) : '';
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

/**
 * Predicts where an original y lands on the migrated page from the nearest matched
 * element above it (same offset), so sections that moved, even out of order, are found.
 */
function buildLocalMap(anchors, ymap, reach = 1500) {
  const pts = [...anchors].sort((p, q) => p.o - q.o);
  return (y) => {
    let lo = 0;
    let hi = pts.length - 1;
    let k = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1; // eslint-disable-line no-bitwise
      if (pts[mid].o <= y) { k = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (k < 0 || y - pts[k].o > reach) return ymap(y);
    return pts[k].m + (y - pts[k].o);
  };
}

export function matchElements(orig, mig, { origHeight, migHeight }) {
  const ratio = origHeight ? migHeight / origHeight : 1;
  const pairs = new Map(); // orig.i -> mig
  const used = new Set();
  const take = (o, m) => { pairs.set(o.i, m); used.add(m.i); };
  const icons = new Set(); // orig.i of icons paired by position (pass 4b)

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
  let local = buildLocalMap(anchors, ymap);
  // distance from where the element is expected: page-wide mapping or its own section
  const offBy = (o, m) => Math.min(Math.abs(ymap(o.rect.y) - m.rect.y), Math.abs(local(o.rect.y) - m.rect.y));

  const score = (o, m, sim) => {
    const dy = offBy(o, m);
    const vis = o.visible === m.visible ? 0 : 0.3;
    const kind = o.kind === m.kind ? 0 : 0.1;
    return sim - Math.min(dy / 3000, 0.5) - vis - kind;
  };

  // pass 2: exact text with duplicates, closest predicted position wins
  const dup = [];
  oText.forEach((o) => {
    if (pairs.has(o.i)) return;
    (byKey.get(textKey(o.text)) || []).filter((m) => !used.has(m.i) && compatible(o, m))
      .forEach((m) => dup.push({ o, m, s: score(o, m, 1) }));
  });
  dup.sort((p, q) => q.s - p.s).forEach(({ o, m }) => {
    if (!pairs.has(o.i) && !used.has(m.i)) take(o, m);
  });

  anchors = [...pairs.entries()]
    .map(([oi, m]) => ({ o: orig[oi].rect.y, m: m.rect.y, ov: orig[oi].visible, mv: m.visible }))
    .filter((p) => p.ov && p.mv);
  ymap = buildYMap(anchors, ratio);
  local = buildLocalMap(anchors, ymap);

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

  // pass 3b: icons and images with the same label ("Share via Twitter" as an <img alt>
  // on one page, an svg in a link labelled "Share via Twitter" on the other)
  const labelled = (list) => list.filter((e) => e.visible && (e.kind === 'image' || e.labelOnly) && labelOf(e).length >= 3);
  const mLabelled = labelled(mig);
  labelled(orig).forEach((o) => {
    if (pairs.has(o.i)) return;
    const key = labelOf(o);
    const cands = mLabelled.filter((m) => !used.has(m.i) && labelOf(m) === key);
    if (!cands.length) return;
    // closest in size first: a 48px icon button matches the 48px button, not the 24px glyph in it
    const sizeOff = (e) => Math.abs(Math.log(Math.max(1, e.rect.w * e.rect.h) / Math.max(1, o.rect.w * o.rect.h)));
    cands.sort((p, q) => sizeOff(p) - sizeOff(q) || offBy(o, p) - offBy(o, q));
    take(o, cands[0]);
  });

  // pass 4: images and controls by alt/aspect/position
  ['image', 'control'].forEach((kind) => {
    const oi = orig.filter((e) => e.kind === kind && e.visible);
    const mi = mig.filter((e) => e.kind === kind && e.visible);
    const cand = [];
    oi.forEach((o) => {
      mi.forEach((m) => {
        const dy = offBy(o, m);
        if (dy > 1200) return;
        const ao = o.rect.w / Math.max(1, o.rect.h);
        const am = m.rect.w / Math.max(1, m.rect.h);
        const aspect = 1 - Math.min(1, Math.abs(Math.log(ao / am)));
        const alt = o.alt && m.alt && textKey(o.alt) === textKey(m.alt) ? 0.4 : 0;
        // two images that say what they are, and say different things, are different images
        // (an emoji "Love" is not a news card "Visit the ... page")
        const lo = labelOf(o);
        const lm = labelOf(m);
        if (!alt && lo && lm && dice(lo, lm) < 0.5) return;
        const area = (o.rect.w * o.rect.h) / Math.max(1, m.rect.w * m.rect.h);
        if (!alt && (area > 6 || area < 1 / 6)) return;
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

  // an element wrapped around (or inside) a matched one with the same label is that same
  // control: the svg inside a "Share via Twitter" link, or the link around a matched icon
  const absorbedO = new Set();
  const absorbedM = new Set();
  const inside = (a, b) => a.x >= b.x - 2 && a.y >= b.y - 2 && a.x + a.w <= b.x + b.w + 2 && a.y + a.h <= b.y + b.h + 2;
  const absorbNested = () => {
    const matchedO = orig.filter((o) => pairs.has(o.i));
    const matchedM = mig.filter((m) => used.has(m.i));
    orig.filter((o) => o.visible && !pairs.has(o.i) && !absorbedO.has(o.i) && labelOf(o)).forEach((o) => {
      if (matchedO.some((x) => labelOf(x) === labelOf(o) && (inside(o.rect, x.rect) || inside(x.rect, o.rect)))) absorbedO.add(o.i);
    });
    mig.filter((m) => m.visible && !used.has(m.i) && !absorbedM.has(m.i) && labelOf(m)).forEach((m) => {
      if (matchedM.some((x) => labelOf(x) === labelOf(m) && (inside(m.rect, x.rect) || inside(x.rect, m.rect)))) absorbedM.add(m.i);
    });
  };
  absorbNested();

  // pass 4b: icons (menu, search, close, social). Sites label them differently ("Menu"
  // vs "Open navigation") and build them differently (an <img> vs a button with a CSS
  // icon), so they are paired by where they sit and their size, across kinds.
  const isIcon = (e) => e.visible && e.rect.w <= 96 && e.rect.h <= 96
    && (e.kind === 'image' || (['action', 'control'].includes(e.kind) && e.labelOnly));
  const iconCands = [];
  orig.filter((o) => isIcon(o) && !pairs.has(o.i) && !absorbedO.has(o.i)).forEach((o) => {
    mig.filter((m) => isIcon(m) && !used.has(m.i) && !absorbedM.has(m.i)).forEach((m) => {
      const dy = offBy(o, m);
      const dx = Math.abs((o.rect.x + o.rect.w / 2) - (m.rect.x + m.rect.w / 2));
      const size = Math.max(o.rect.w, o.rect.h) / Math.max(1, Math.max(m.rect.w, m.rect.h));
      if (dy > 150 || dx > 80 || size > 3 || size < 1 / 3) return;
      iconCands.push({ o, m, s: 1 - dy / 300 - dx / 160 - Math.abs(Math.log(size)) / 4 });
    });
  });
  iconCands.sort((p, q) => q.s - p.s).forEach(({ o, m }) => {
    if (pairs.has(o.i) || used.has(m.i)) return;
    take(o, m);
    icons.add(o.i);
  });

  // pass 5: whatever is still unmatched is looked for anywhere on the page before it
  // counts as missing (a whole section can sit far lower on the migrated page)
  oText.forEach((o) => {
    if (pairs.has(o.i)) return;
    const k = textKey(o.text);
    if (k.length < 6) return;
    let best = null;
    let bestSim = 0.8;
    mText.forEach((m) => {
      if (used.has(m.i) || !compatible(o, m)) return;
      const mk = textKey(m.text);
      if (Math.abs(mk.length - k.length) > Math.max(k.length, mk.length) * 0.3) return;
      const sim = dice(k, mk) - (o.visible === m.visible ? 0 : 0.3);
      if (sim > bestSim || (best && sim === bestSim && offBy(o, m) < offBy(o, best))) { bestSim = sim; best = m; }
    });
    if (best) take(o, best);
  });
  ['image', 'control'].forEach((kind) => {
    orig.filter((o) => o.kind === kind && o.visible && !pairs.has(o.i)).forEach((o) => {
      const key = textKey(o.alt || (kind === 'control' ? o.text : ''));
      if (!key) return;
      const cands = mig.filter((m) => m.kind === kind && m.visible && !used.has(m.i)
        && textKey(m.alt || (kind === 'control' ? m.text : '')) === key);
      if (!cands.length) return;
      cands.sort((p, q) => offBy(o, p) - offBy(o, q));
      take(o, cands[0]);
    });
  });

  // pass 6: text split or merged differently ("a<br>b" in one paragraph on one page,
  // two paragraphs on the other). A run of consecutive unmatched elements whose joined
  // text equals one unmatched element on the other page is the same content.
  const split = new Set(); // orig.i matched as part of a split/merged run
  const runs = (list, isFree) => {
    const free = list.filter((e) => e.visible && isFree(e) && textKey(e.text)).sort((p, q) => p.rect.y - q.rect.y || p.rect.x - q.rect.x);
    const out = [];
    for (let a = 0; a < free.length; a += 1) {
      let joined = '';
      for (let b = a; b < Math.min(free.length, a + 6); b += 1) {
        if (b > a && (free[b].region !== free[a].region || free[b].rect.y - (free[b - 1].rect.y + free[b - 1].rect.h) > 60)) break;
        joined = `${joined} ${textKey(free[b].text)}`.trim();
        if (b > a) out.push({ items: free.slice(a, b + 1), key: joined });
      }
    }
    return out;
  };
  const sameText = (k, mk) => k === mk || (k.length >= 12 && Math.abs(k.length - mk.length) <= Math.max(k.length, mk.length) * 0.15 && dice(k, mk) >= 0.9);
  // several original elements -> one migrated element
  runs(oText, (o) => !pairs.has(o.i)).forEach(({ items, key }) => {
    if (items.some((o) => pairs.has(o.i))) return;
    const m = mText.find((x) => !used.has(x.i) && x.visible && sameText(key, textKey(x.text)));
    if (!m) return;
    items.forEach((o) => { pairs.set(o.i, m); split.add(o.i); });
    used.add(m.i);
  });
  // one original element -> several migrated elements
  runs(mText, (m) => !used.has(m.i)).forEach(({ items, key }) => {
    if (items.some((m) => used.has(m.i))) return;
    const o = oText.find((x) => !pairs.has(x.i) && x.visible && sameText(textKey(x.text), key));
    if (!o) return;
    pairs.set(o.i, items[0]);
    split.add(o.i);
    items.forEach((m) => used.add(m.i));
  });

  absorbNested();
  // text that is part of a larger element on the other page is not missing: a tweet's
  // attribution line is its own paragraph on one page and inside the quote on the other
  const contains = (list, key) => list.some((e) => e.visible && textKey(e.text).length > key.length && textKey(e.text).includes(key));
  orig.filter((o) => o.visible && !pairs.has(o.i) && !absorbedO.has(o.i) && textKey(o.text).length >= 15)
    .forEach((o) => { if (contains(mig, textKey(o.text))) absorbedO.add(o.i); });
  mig.filter((m) => m.visible && !used.has(m.i) && !absorbedM.has(m.i) && textKey(m.text).length >= 15)
    .forEach((m) => { if (contains(orig, textKey(m.text))) absorbedM.add(m.i); });

  const matched = [...pairs.entries()].map(([oi, m]) => ({
    o: orig[oi], m, icon: icons.has(oi), split: split.has(oi),
  }));
  // pairs that keep their vertical order on both pages; shuffled ones (random teasers,
  // search results, carousels) are left out of spacing and layout comparisons
  const inOrder = monotone(matched
    .filter((p) => p.o.visible && p.m.visible)
    .map((p) => ({ o: p.o.rect.y, m: p.m.rect.y, i: p.o.i })));
  const ordered = new Set(inOrder.map((p) => p.i));
  matched.forEach((p) => { p.inOrder = ordered.has(p.o.i); });
  const missing = orig.filter((o) => o.visible && !pairs.has(o.i) && !absorbedO.has(o.i));
  const extra = mig.filter((m) => m.visible && !used.has(m.i) && !absorbedM.has(m.i));
  // final mapping from everything matched: places "missing" markers where the content
  // would be, and lets the viewer scroll both pages section by section
  ymap = buildYMap(inOrder, ratio);
  return {
    matched, missing, extra, ymap, anchors: inOrder.map((p) => [Math.round(p.o), Math.round(p.m)]),
  };
}
