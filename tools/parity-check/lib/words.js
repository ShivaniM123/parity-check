/**
 * Word-level comparison of two texts, so a wording issue can name exactly
 * what changed ("hosts" → "host", extra "2") instead of quoting both texts.
 * Words are compared without case and punctuation, like the text matching.
 */

const norm = (w) => w.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
const MAX_WORDS = 400; // longer texts: no word diff (cost grows with a × b)
const CONTEXT = 2; // words of context around each change in the snippets

const quote = (words, n = 40) => {
  const t = words.join(' ');
  return `“${t.length > n ? `${t.slice(0, n - 1)}…` : t}”`;
};

/** Longest-common-subsequence alignment → runs of kept, removed and added words. */
function align(a, b) {
  const A = a.map(norm);
  const B = b.map(norm);
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i -= 1) {
    for (let j = B.length - 1; j >= 0; j -= 1) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) { ops.push(['=', i, j]); i += 1; j += 1; } else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) { ops.push(['+', i, j]); j += 1; } else { ops.push(['-', i, j]); i += 1; }
  }
  return ops;
}

/**
 * Snippet of one side around the `focus` words, with the `changed` words
 * flagged: [[text, changed], …]. A space between two changed words is part of
 * the highlight, so "now please" reads as one change.
 */
function snippet(words, focus, changed) {
  const keep = new Set();
  focus.forEach((k) => {
    for (let x = Math.max(0, k - CONTEXT); x <= Math.min(words.length - 1, k + CONTEXT); x += 1) keep.add(x);
  });
  const segs = [];
  const push = (text, flag) => {
    const prev = segs[segs.length - 1];
    if (prev && prev[1] === flag) prev[0] += text;
    else segs.push([text, flag]);
  };
  let last = null;
  [...keep].sort((p, q) => p - q).forEach((k) => {
    let sep = ' … ';
    if (last === null) sep = k > 0 ? '… ' : '';
    else if (k === last + 1) sep = ' ';
    if (sep) push(sep, sep === ' ' && changed.has(k) && changed.has(last));
    push(words[k], changed.has(k));
    last = k;
  });
  if (last !== null && last < words.length - 1) push(' …', false);
  return segs;
}

/**
 * Returns null when the texts can't be compared word by word (too long, or
 * mostly different). Otherwise:
 * - title: "“hosts” → “host”; extra “2” at the end"
 * - o / m: highlighted snippets of each text, ov / mv: the same as plain text
 */
export function wordDiff(original, migrated) {
  const a = String(original || '').split(/\s+/).filter(Boolean);
  const b = String(migrated || '').split(/\s+/).filter(Boolean);
  if (!a.length || !b.length || a.length > MAX_WORDS || b.length > MAX_WORDS) return null;
  const ops = align(a, b);
  const hunks = [];
  let cur = null;
  ops.forEach(([op, i, j]) => {
    if (op === '=') { cur = null; return; }
    if (!cur) { cur = { del: [], add: [], at: i, atB: j }; hunks.push(cur); }
    if (op === '-') cur.del.push(i); else cur.add.push(j);
  });
  if (!hunks.length) return null;
  const same = ops.filter(([op]) => op === '=').length;
  if (same < Math.min(a.length, b.length) * 0.5) return null; // rewritten, not edited
  const describe = (h) => {
    const del = h.del.map((i) => a[i]);
    const add = h.add.map((j) => b[j]);
    if (del.length && add.length) return `${quote(del)} → ${quote(add)}`;
    let where = '';
    if (h.at >= a.length) where = ' at the end';
    else if (h.at === 0) where = ' at the start';
    else where = ` after “${a[h.at - 1]}”`;
    return add.length ? `extra ${quote(add)}${where}` : `missing ${quote(del)}${where === ' at the end' ? '' : where}`;
  };
  const parts = hunks.slice(0, 2).map(describe);
  const title = `${parts.join('; ')}${hunks.length > 2 ? `; ${hunks.length - 2} more change${hunks.length > 3 ? 's' : ''}` : ''}`;
  // a removed word is shown on the original side, an added one on the migrated side;
  // the other side still shows the spot (its neighbouring words)
  const near = (k, len) => Math.max(0, Math.min(len - 1, k));
  const o = snippet(a, hunks.map((h) => (h.del.length ? h.del : [near(h.at, a.length)])).flat(), new Set(hunks.flatMap((h) => h.del)));
  const m = snippet(b, hunks.map((h) => (h.add.length ? h.add : [near(h.atB, b.length)])).flat(), new Set(hunks.flatMap((h) => h.add)));
  const plain = (segs) => segs.map((s) => s[0]).join('');
  return {
    title, o, m, ov: plain(o), mv: plain(m),
  };
}
