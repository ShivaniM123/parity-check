/**
 * Rule-based parity analysis for one viewport width.
 * Every issue carries a recommended CSS fix targeted at the migrated page.
 */

import { textKey, dice } from './match.js';
import { wordDiff } from './words.js';

const SEV = { high: 3, medium: 2, low: 1 };

export function parseColor(c) {
  const m = (c || '').match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return {
    r, g, b, a,
  };
}

export function colorDistance(c1, c2) {
  const a = parseColor(c1);
  const b = parseColor(c2);
  if (!a || !b) return c1 === c2 ? 0 : 999;
  // weighted RGB ("redmean") distance, 0..~765
  const rm = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  const d = Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
  return d + Math.abs(a.a - b.a) * 255;
}

export function toHex(c) {
  const p = parseColor(c);
  if (!p) return c;
  const h = (n) => Math.round(n).toString(16).padStart(2, '0');
  const hex = `#${h(p.r)}${h(p.g)}${h(p.b)}`;
  return p.a < 1 ? `rgb(${p.r} ${p.g} ${p.b} / ${Math.round(p.a * 100) / 100})` : hex;
}

export function fileFor(el, isEds) {
  if (!isEds) return null;
  if (el.block) return `blocks/${el.block}/${el.block}.css`;
  return 'styles/styles.css';
}

const pxv = (n) => `${Math.round(n * 100) / 100}px`;
const boxShorthand = ([t, r, b, l]) => {
  if (t === b && r === l) return t === r ? pxv(t) : `${pxv(t)} ${pxv(r)}`;
  return [t, r, b, l].map(pxv).join(' ');
};
const RATIOS = [[1, 1], [4, 3], [3, 2], [16, 9], [21, 9], [5, 4], [3, 4], [2, 3], [9, 16], [4, 5], [2, 1]];
const niceRatio = (w, h) => {
  const r = w / Math.max(1, h);
  const hit = RATIOS.find(([a, b]) => Math.abs(a / b - r) / r < 0.02);
  return hit ? `${hit[0]} / ${hit[1]}` : `${Math.round(w)} / ${Math.round(h)}`;
};
const pct = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(a));
const countOf = (n) => `${n} element${n === 1 ? '' : 's'}`;
const short = (t, n = 60) => (t && t.length > n ? `${t.slice(0, n - 1)}…` : t || '');
const overlapX = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > Math.min(a.w, b.w) * 0.3;
const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

function tokenFinder(tokens = []) {
  return (type, value) => {
    const t = tokens.find((tk) => {
      if (tk.type !== type) return false;
      if (type === 'color') return colorDistance(tk.value, value) < 2;
      if (type === 'length') return Math.abs(tk.value - value) < 0.5;
      return tk.value.toLowerCase() === String(value).toLowerCase();
    });
    return t ? t.name : null;
  };
}

function unionRect(rects) {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const r = Math.max(...rects.map((q) => q.x + q.w));
  const b = Math.max(...rects.map((q) => q.y + q.h));
  return {
    x, y, w: r - x, h: b - y,
  };
}

const contains = (a, b) => a !== b && b.x >= a.x && b.y >= a.y
  && b.x + b.w <= a.x + a.w + 1 && b.y + b.h <= a.y + a.h + 1;

/**
 * How much of a text box is covered by glyphs: pixels that differ clearly from the box's
 * most common colour (its background). Bold text covers noticeably more than regular.
 */
function inkCoverage(img, r) {
  if (!img || !r || r.w < 4 || r.h < 4) return null;
  const x0 = Math.max(0, Math.round(r.x));
  const y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(img.width, Math.round(r.x + r.w));
  const y1 = Math.min(img.height, Math.round(r.y + r.h));
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  const counts = new Map();
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const k = (y * img.width + x) * 4;
      const key = (img.data[k] >> 4) * 256 + (img.data[k + 1] >> 4) * 16 + (img.data[k + 2] >> 4); // eslint-disable-line no-bitwise
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const bgKey = [...counts.entries()].sort((p, q) => q[1] - p[1])[0][0];
  const bg = [((bgKey >> 8) & 15) * 16 + 8, ((bgKey >> 4) & 15) * 16 + 8, (bgKey & 15) * 16 + 8]; // eslint-disable-line no-bitwise
  let ink = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const k = (y * img.width + x) * 4;
      const dist = Math.abs(img.data[k] - bg[0]) + Math.abs(img.data[k + 1] - bg[1]) + Math.abs(img.data[k + 2] - bg[2]);
      if (dist > 120) ink += 1;
    }
  }
  return ink / ((x1 - x0) * (y1 - y0));
}

export function analyzeWidth({
  width, orig, mig, match, diff,
}) {
  const findings = [];
  const { isEds } = mig;
  const token = tokenFinder(mig.tokens);
  const add = (f) => findings.push(f);
  const decl = (prop, value, type, raw) => {
    const name = type ? token(type, raw) : null;
    return name ? { prop, value: `var(${name})`, comment: value } : { prop, value };
  };
  // compact computed-style snapshot, shown as an inspector table (original vs migrated)
  const snap = (el) => {
    const s = el.s || {};
    return {
      'font-family': s.fontFamily,
      'font-size': s.fontSize ? pxv(s.fontSize) : undefined,
      'font-weight': s.fontWeight ? String(s.fontWeight) : undefined,
      'line-height': s.lineHeight ? pxv(s.lineHeight) : undefined,
      'letter-spacing': s.letterSpacing !== undefined ? pxv(s.letterSpacing) : undefined,
      'text-transform': s.textTransform,
      'text-align': s.textAlign,
      color: s.color ? toHex(s.color) : undefined,
      background: s.bg && s.bg !== 'image' ? toHex(s.bg) : s.bg,
      padding: s.pt !== undefined ? boxShorthand([s.pt, s.pr, s.pb, s.pl]) : undefined,
      'margin-top': s.mt !== undefined ? pxv(s.mt) : undefined,
      'margin-bottom': s.mb !== undefined ? pxv(s.mb) : undefined,
      'border-radius': s.radius !== undefined ? pxv(s.radius) : undefined,
      display: s.display,
      size: `${el.rect.w}×${el.rect.h}`,
    };
  };
  const ref = (el) => ({
    rect: el.rect, selector: el.selector, text: short(el.text), path: el.path, block: el.block, tag: el.tag, st: snap(el),
  });

  // third-party embed content is compared as a whole by the embed rule, not element by element
  const visiblePairs = match.matched.filter(({ o, m }) => o.visible && m.visible && !o.embed && !m.embed);
  // icons paired by position (an <img> on one page, a CSS icon button on the other) are
  // the same control built differently: their font, colour and box styles don't compare
  const stylePairs = visiblePairs.filter((p) => !p.icon);
  // text split or merged differently (one paragraph vs two) has the same styles, but its
  // boxes differ in size by construction: leave it out of size, wrap and spacing checks
  const geomPairs = visiblePairs.filter((p) => !p.icon && !p.split);
  const textual = (e) => ['heading', 'text', 'action'].includes(e.kind);

  // ---------- typography / colour / component styles ----------
  const fontGroups = new Map();
  stylePairs.forEach(({ o, m, split }) => {
    const os = o.s;
    const ms = m.s;
    const file = fileFor(m, isEds);
    const base = { o: ref(o), m: ref(m) };

    if (textual(o) && textual(m)) {
      const fsDiff = ms.fontSize - os.fontSize;
      if (Math.abs(fsDiff) > 1) {
        const big = Math.abs(fsDiff) >= 4 || pct(os.fontSize, ms.fontSize) > 0.15;
        add({
          ...base,
          category: 'typography',
          property: 'font-size',
          severity: big ? 'high' : 'medium',
          title: `Font size ${pxv(ms.fontSize)} should be ${pxv(os.fontSize)}`,
          detail: `“${short(o.text, 40)}” renders ${fsDiff > 0 ? 'larger' : 'smaller'} than the original.`,
          ov: pxv(os.fontSize),
          mv: pxv(ms.fontSize),
          fix: { file, selector: m.selector, decl: [decl('font-size', pxv(os.fontSize), 'length', os.fontSize)] },
        });
      }
      // the weight that is drawn: asking for bold from a font with no bold face gives the
      // regular face when the site turns off fake bold (font-synthesis), so it looks regular
      const drawnWeight = (e, page) => {
        const w = e.s.fontWeight;
        if (w < 600) return w;
        const fam = (e.s.fontFamily || '').toLowerCase();
        const faces = (page.fonts || []).filter((f) => f.status === 'loaded' && f.family.toLowerCase() === fam);
        if (!faces.length) return w; // system or unknown font: trust the value
        const bold = faces.some((f) => (f.weight === 'bold' ? 700 : parseInt(f.weight, 10) || 400) >= 600);
        return bold || e.s.synthWeight !== 'none' ? w : 400;
      };
      // and confirm on the screenshots: same glyphs drawn bolder cover more of their box
      const looksSameWeight = () => {
        const box = (e) => (e.ink ? { x: e.rect.x, y: e.ink.y, w: e.rect.w, h: e.ink.h } : e.rect);
        const io = inkCoverage(diff?.shots?.o, box(o));
        const im = inkCoverage(diff?.shots?.m, box(m));
        if (io == null || im == null || !io || !im || textKey(o.text) !== textKey(m.text)) return false;
        const heavier = drawnWeight(m, mig) > drawnWeight(o, orig) ? im / io : io / im;
        return heavier < 1.12; // bolder by 100+ adds well over 12% ink
      };
      if (Math.abs(drawnWeight(m, mig) - drawnWeight(o, orig)) >= 100 && !looksSameWeight()) {
        add({
          ...base,
          category: 'typography',
          property: 'font-weight',
          severity: 'medium',
          title: `Font weight ${ms.fontWeight} should be ${os.fontWeight}`,
          detail: `“${short(o.text, 40)}” looks ${ms.fontWeight > os.fontWeight ? 'bolder' : 'lighter'}.`,
          ov: String(os.fontWeight),
          mv: String(ms.fontWeight),
          fix: { file, selector: m.selector, decl: [{ prop: 'font-weight', value: String(os.fontWeight) }] },
        });
      }
      const of = os.fontFamily.toLowerCase();
      const mf = ms.fontFamily.toLowerCase().replace(/-fallback$/, '');
      // the same typeface under another face name ("Graphik Semibold" vs "Graphik Regular"
      // drawn bold) that covers the same ink on screen looks the same: not a difference
      const sameTypeface = of.split(/[\s-]+/)[0] === mf.split(/[\s-]+/)[0];
      const sameInk = () => {
        const box = (e) => (e.ink ? { x: e.rect.x, y: e.ink.y, w: e.rect.w, h: e.ink.h } : e.rect);
        const io = inkCoverage(diff?.shots?.o, box(o));
        const im = inkCoverage(diff?.shots?.m, box(m));
        return !!io && !!im && Math.max(io, im) / Math.min(io, im) < 1.12;
      };
      if (of && mf && of !== mf && !(sameTypeface && textKey(o.text) === textKey(m.text) && sameInk())) {
        const scope = o.kind === 'heading' ? 'heading' : 'body';
        const key = `${scope}|${of}|${mf}`;
        if (!fontGroups.has(key)) fontGroups.set(key, { scope, o, m, rects: [], count: 0 });
        const g = fontGroups.get(key);
        g.count += 1;
        if (g.rects.length < 12) g.rects.push(m.rect);
      }
      const multiLine = (o.lines || 1) > 1 || (m.lines || 1) > 1;
      if (multiLine && Math.abs(ms.lineHeight - os.lineHeight) > 2 && pct(os.lineHeight, ms.lineHeight) > 0.08) {
        add({
          ...base,
          category: 'typography',
          property: 'line-height',
          severity: pct(os.lineHeight, ms.lineHeight) > 0.2 ? 'medium' : 'low',
          title: `Line height ${pxv(ms.lineHeight)} should be ${pxv(os.lineHeight)}`,
          detail: 'Vertical rhythm of the text differs.',
          ov: pxv(os.lineHeight),
          mv: pxv(ms.lineHeight),
          fix: { file, selector: m.selector, decl: [{ prop: 'line-height', value: String(Math.round((os.lineHeight / os.fontSize) * 100) / 100), comment: pxv(os.lineHeight) }] },
        });
      }
      if (Math.abs(ms.letterSpacing - os.letterSpacing) > 0.4) {
        add({
          ...base,
          category: 'typography',
          property: 'letter-spacing',
          severity: 'low',
          title: `Letter spacing ${pxv(ms.letterSpacing)} should be ${pxv(os.letterSpacing)}`,
          detail: 'Tracking differs.',
          ov: pxv(os.letterSpacing),
          mv: pxv(ms.letterSpacing),
          fix: { file, selector: m.selector, decl: [{ prop: 'letter-spacing', value: os.letterSpacing ? pxv(os.letterSpacing) : 'normal' }] },
        });
      }
      // only when it shows: text authored in capitals needs no uppercase transform (the text
      // read from the page is already as displayed, transform applied)
      if (os.textTransform !== ms.textTransform && o.text !== m.text) {
        add({
          ...base,
          category: 'typography',
          property: 'text-transform',
          severity: 'medium',
          title: `Text transform “${ms.textTransform}” should be “${os.textTransform}”`,
          detail: `Casing of “${short(o.text, 40)}” differs.`,
          ov: os.textTransform,
          mv: ms.textTransform,
          fix: { file, selector: m.selector, decl: [{ prop: 'text-transform', value: os.textTransform }] },
        });
      }
      const al = (a) => ({ start: 'left', end: 'right', '-webkit-center': 'center' }[a] || a);
      if (al(os.textAlign) !== al(ms.textAlign) && o.lines >= 1 && !['inline', 'inline-block', 'inline-flex'].includes(ms.display)) {
        add({
          ...base,
          category: 'typography',
          property: 'text-align',
          severity: 'medium',
          title: `Text aligned ${al(ms.textAlign)}, original is ${al(os.textAlign)}`,
          detail: `“${short(o.text, 40)}” alignment differs.`,
          ov: al(os.textAlign),
          mv: al(ms.textAlign),
          fix: { file, selector: m.selector, decl: [{ prop: 'text-align', value: al(os.textAlign) }] },
        });
      }
      const cd = colorDistance(os.color, ms.color);
      if (cd > 18) {
        add({
          ...base,
          category: 'color',
          property: 'color',
          severity: cd > 90 ? 'high' : 'medium',
          title: `Text color ${toHex(ms.color)} should be ${toHex(os.color)}`,
          detail: `“${short(o.text, 40)}” has a different text color.`,
          ov: toHex(os.color),
          mv: toHex(ms.color),
          swatch: [os.color, ms.color],
          fix: { file, selector: m.selector, decl: [decl('color', toHex(os.color), 'color', os.color)] },
        });
      }
      if (o.kind === 'action' && os.textDecoration !== ms.textDecoration) {
        add({
          ...base,
          category: 'typography',
          property: 'text-decoration',
          severity: 'low',
          title: `Link decoration “${ms.textDecoration}” should be “${os.textDecoration}”`,
          detail: 'Underline style differs.',
          ov: os.textDecoration,
          mv: ms.textDecoration,
          fix: { file, selector: m.selector, decl: [{ prop: 'text-decoration', value: os.textDecoration }] },
        });
      }
      // wrapping: same text spans a different number of lines
      const linesOf = (e) => e.inkLines || e.lines;
      if (!split && linesOf(o) && linesOf(m) && linesOf(o) !== linesOf(m) && Math.abs(fsDiff) <= 1 && pct(o.rect.w, m.rect.w) > 0.1 && Math.abs(o.rect.w - m.rect.w) > 24) {
        add({
          ...base,
          category: 'layout',
          property: 'max-width',
          severity: 'low',
          title: `Text wraps to ${linesOf(m)} line${linesOf(m) > 1 ? 's' : ''}, original ${linesOf(o)}`,
          detail: `Text box is ${m.rect.w}px wide vs ${o.rect.w}px in the original.`,
          ov: `${o.rect.w}px`,
          mv: `${m.rect.w}px`,
          fix: { file, selector: m.selector, decl: [{ prop: 'max-width', value: `${o.rect.w}px` }] },
        });
      }
    }

    // effective background (section / card backgrounds)
    const boxed = o.kind === 'action' && (os.ownBg || ms.ownBg); // covered by the component rule
    // text drawn over a photo (hero, banner): what is behind it is the photo, not the
    // colour of the box under the photo or a translucent overlay
    const overPhoto = (e, els) => {
      const cx = e.rect.x + e.rect.w / 2;
      const cy = e.rect.y + e.rect.h / 2;
      return els.some((x) => x.kind === 'image' && x.visible && x !== e && x.rect.w * x.rect.h > e.rect.w * e.rect.h
        && cx >= x.rect.x && cx <= x.rect.x + x.rect.w && cy >= x.rect.y && cy <= x.rect.y + x.rect.h);
    };
    if (!boxed && textual(o) && textual(m) && os.bg !== 'image' && ms.bg !== 'image' && !overPhoto(o, orig.elements) && !overPhoto(m, mig.elements)) {
      const bd = colorDistance(os.bg, ms.bg);
      if (bd > 18) {
        add({
          o: { ...ref(o) },
          m: { ...ref(m), selector: ms.bgSelector },
          category: 'color',
          property: 'background-color',
          groupBy: ms.bgPath,
          severity: bd > 90 ? 'high' : 'medium',
          title: `Background ${toHex(ms.bg)} should be ${toHex(os.bg)}`,
          detail: `Background behind “${short(o.text, 40)}” differs.`,
          ov: toHex(os.bg),
          mv: toHex(ms.bg),
          swatch: [os.bg, ms.bg],
          fix: { file, selector: ms.bgSelector, decl: [decl('background-color', toHex(os.bg), 'color', os.bg)] },
        });
      }
    }

    // buttons and other boxed components
    if (o.kind === 'action' && m.kind === 'action' && (os.ownBg || os.borderW || ms.ownBg || ms.borderW)) {
      const d = [];
      const notes = [];
      if (colorDistance(os.ownBg || 'rgba(0,0,0,0)', ms.ownBg || 'rgba(0,0,0,0)') > 18) {
        d.push(os.ownBg ? decl('background-color', toHex(os.ownBg), 'color', os.ownBg) : { prop: 'background-color', value: 'transparent' });
        notes.push(`background ${ms.ownBg ? toHex(ms.ownBg) : 'none'} → ${os.ownBg ? toHex(os.ownBg) : 'none'}`);
      }
      if (Math.abs(os.radius - ms.radius) > 2) {
        d.push({ prop: 'border-radius', value: pxv(os.radius) });
        notes.push(`radius ${pxv(ms.radius)} → ${pxv(os.radius)}`);
      }
      const pads = ['pt', 'pr', 'pb', 'pl'].map((k) => os[k]);
      if (['pt', 'pr', 'pb', 'pl'].some((k) => Math.abs(os[k] - ms[k]) > 3)) {
        d.push({ prop: 'padding', value: boxShorthand(pads) });
        notes.push(`padding ${['pt', 'pr', 'pb', 'pl'].map((k) => ms[k]).join('/')} → ${pads.join('/')}`);
      }
      if (Math.abs(os.borderW - ms.borderW) >= 1 || (os.borderW && colorDistance(os.borderC, ms.borderC) > 18)) {
        d.push({ prop: 'border', value: os.borderW ? `${pxv(os.borderW)} ${os.borderS} ${toHex(os.borderC)}` : 'none' });
        notes.push('border differs');
      }
      if (d.length) {
        add({
          ...base,
          category: 'component',
          property: 'button',
          severity: d.length >= 2 ? 'high' : 'medium',
          title: `Button “${short(o.text, 30)}” styled differently`,
          detail: notes.join('; '),
          ov: `${o.rect.w}×${o.rect.h}`,
          mv: `${m.rect.w}×${m.rect.h}`,
          fix: { file, selector: m.selector, decl: d },
        });
      }
    }

    // images and media
    if (o.kind === 'image' && m.kind === 'image') {
      if (m.broken) {
        add({
          ...base,
          category: 'image',
          property: 'src',
          severity: 'high',
          title: 'Image failed to load',
          detail: `Source: ${short(m.src, 90)}`,
          ov: o.src ? 'loaded' : '',
          mv: 'broken',
          fix: { file: null, selector: m.selector, decl: [], note: 'Re-import the image or fix its reference in the page content.' },
        });
      }
      const dw = Math.abs(o.rect.w - m.rect.w);
      const dh = Math.abs(o.rect.h - m.rect.h);
      if ((dw > 8 && pct(o.rect.w, m.rect.w) > 0.06) || (dh > 8 && pct(o.rect.h, m.rect.h) > 0.06)) {
        const ao = o.rect.w / Math.max(1, o.rect.h);
        const am = m.rect.w / Math.max(1, m.rect.h);
        const ratioDiffers = Math.abs(ao - am) / ao > 0.05;
        // an image that fills its container in both pages is sized by the container, not by itself
        const fills = (e) => e.pw && Math.abs(e.rect.w - e.pw) <= 2;
        const fluid = fills(o) && fills(m);
        const d = [];
        if (dw > 8 && !fluid) d.push({ prop: 'width', value: fills(o) ? '100%' : `${o.rect.w}px` });
        if (ratioDiffers) {
          d.push({ prop: 'aspect-ratio', value: niceRatio(o.rect.w, o.rect.h) });
          d.push({ prop: 'object-fit', value: os.objectFit && os.objectFit !== 'fill' ? os.objectFit : 'cover' });
        } else if (dh > 8 && !fluid) d.push({ prop: 'height', value: 'auto' });
        if (d.length) {
          add({
            ...base,
            category: 'image',
            property: ratioDiffers ? 'aspect-ratio' : 'size',
            groupBy: `${m.selector}|${niceRatio(o.rect.w, o.rect.h)}|${fluid}`,
            severity: ratioDiffers || pct(o.rect.w * o.rect.h, m.rect.w * m.rect.h) > 0.25 ? 'high' : 'medium',
            title: ratioDiffers
              ? `Image aspect ratio ${niceRatio(m.rect.w, m.rect.h)}, original ${niceRatio(o.rect.w, o.rect.h)}`
              : `Image is ${m.rect.w}×${m.rect.h}, original ${o.rect.w}×${o.rect.h}`,
            detail: `${m.rect.w}×${m.rect.h} vs ${o.rect.w}×${o.rect.h}. ${ratioDiffers ? 'The crop differs.' : 'Rendered size differs.'}${fluid ? ' The image fills its container, so width follows the layout.' : ''}`,
            ov: `${o.rect.w}×${o.rect.h}`,
            mv: `${m.rect.w}×${m.rect.h}`,
            fix: { file, selector: m.selector, decl: d },
          });
        }
      }
    }
  });

  fontGroups.forEach((g) => {
    const tokenName = g.scope === 'heading' ? '--heading-font-family' : '--body-font-family';
    const hasToken = (mig.tokens || []).some((t) => t.name === tokenName);
    const loaded = (orig.fonts || []).some((f) => f.family.toLowerCase() === g.o.s.fontFamily.toLowerCase() && f.status === 'loaded');
    add({
      o: ref(g.o),
      m: { ...ref(g.m), rects: g.rects },
      category: 'typography',
      property: 'font-family',
      severity: g.scope === 'heading' || g.count > 5 ? 'high' : 'medium',
      title: `${g.scope === 'heading' ? 'Headings' : 'Text'} use “${g.m.s.fontFamily}” instead of “${g.o.s.fontFamily}”`,
      detail: `${g.count} element${g.count > 1 ? 's' : ''} affected.${loaded ? ` “${g.o.s.fontFamily}” is a web font on the original: add its @font-face to styles/fonts.css.` : ''}`,
      ov: g.o.s.fontStack,
      mv: g.m.s.fontStack,
      count: g.count,
      fix: hasToken
        ? { file: isEds ? 'styles/styles.css' : null, selector: ':root', decl: [{ prop: tokenName, value: g.o.s.fontStack }] }
        : { file: fileFor(g.m, isEds), selector: g.m.selector, decl: [{ prop: 'font-family', value: g.o.s.fontStack }] },
    });
  });

  // ---------- visibility at this breakpoint ----------
  match.matched.filter(({ o, m }) => !o.embed && !m.embed).forEach(({ o, m }) => {
    if (o.visible && !m.visible) {
      add({
        o: ref(o),
        m: { ...ref(m), rect: null },
        category: 'responsive',
        property: 'display',
        severity: o.region === 'main' ? 'high' : 'medium',
        title: `“${short(o.text, 40)}” is hidden at ${width}px`,
        detail: 'The element exists on the migrated page but is not visible at this width.',
        ov: 'visible',
        mv: 'hidden',
        fix: { file: fileFor(m, isEds), selector: m.selector, decl: [{ prop: 'display', value: o.s.display === 'none' ? 'block' : o.s.display }] },
      });
    } else if (!o.visible && m.visible) {
      add({
        o: { ...ref(o), rect: null },
        m: ref(m),
        category: 'responsive',
        property: 'display',
        severity: m.region === 'main' ? 'medium' : 'low',
        title: `“${short(m.text, 40)}” shows at ${width}px but is hidden on the original`,
        detail: 'The original hides this element at this width.',
        ov: 'hidden',
        mv: 'visible',
        fix: { file: fileFor(m, isEds), selector: m.selector, decl: [{ prop: 'display', value: 'none' }] },
      });
    }
  });

  // ---------- vertical spacing between consecutive elements ----------
  const flow = geomPairs.filter(({ o, m, inOrder }) => inOrder && !o.fixed && !m.fixed && o.kind !== 'control');
  flow.forEach((b) => {
    let above = null;
    flow.forEach((a) => {
      if (a === b) return;
      const ao = a.o.rect;
      const bo = b.o.rect;
      if (ao.y + ao.h <= bo.y + 1 && overlapX(ao, bo) && !contains(ao, bo)) {
        if (!above || ao.y + ao.h > above.o.rect.y + above.o.rect.h) above = a;
      }
    });
    if (!above) return;
    const ao = above.o.rect;
    const bo = b.o.rect;
    const am = above.m.rect;
    const bm = b.m.rect;
    if (!(am.y + am.h <= bm.y + 1 && overlapX(am, bm))) return;
    const go = bo.y - (ao.y + ao.h);
    const gm = bm.y - (am.y + am.h);
    if (go > 400 || gm > 400) return;
    // the same gap measured between what is drawn (text glyphs, image edges): if that
    // matches, the boxes differ (padding, line-height) but nothing moves on screen
    const inkOf = (e) => e.ink || { y: e.rect.y, h: e.rect.h };
    const inkGap = (a, c) => inkOf(c).y - (inkOf(a).y + inkOf(a).h);
    const io = inkGap(above.o, b.o);
    const im = inkGap(above.m, b.m);
    if (Math.abs(io - im) <= Math.max(8, Math.abs(io) * 0.3)) return;
    // content missing (or added) in between explains the gap: reported as content
    const between = (list, top, bottom) => list.some((e) => e.rect.y < bottom && e.rect.y + e.rect.h > top);
    if (between(match.missing, ao.y + ao.h, bo.y) || between(match.extra, am.y + am.h, bm.y)) return;
    const delta = go - gm;
    if (Math.abs(delta) > Math.max(8, go * 0.3)) {
      // the gap is made of A's margin-bottom, B's margin-top and the padding of any
      // container that ends after A / starts before B: change the biggest contributor
      const ancA = above.m.anc || [];
      const ancB = b.m.anc || [];
      const onlyIn = (list, other) => list.filter((x) => !other.some((y) => y.p === x.p));
      const parts = [
        {
          target: b.m, prop: 'margin-top', current: b.m.s.mt,
        },
        {
          target: above.m, prop: 'margin-bottom', current: above.m.s.mb,
        },
        ...onlyIn(ancB, ancA).map((x) => ({
          target: { selector: x.s, block: x.b }, prop: 'padding-top', current: x.pt,
        })),
        ...onlyIn(ancA, ancB).map((x) => ({
          target: { selector: x.s, block: x.b }, prop: 'padding-bottom', current: x.pb,
        })),
      ].filter((c) => c.target.selector);
      const pick = delta > 0 && !parts.some((c) => c.current > 0)
        ? parts[0]
        : [...parts].sort((p, q) => q.current - p.current)[0];
      const { target, prop, current } = pick;
      const next = Math.max(0, Math.round(current + delta));
      add({
        o: ref(b.o),
        m: { ...ref(b.m), rect: { ...bm, y: am.y + am.h, h: bm.y - (am.y + am.h) + Math.min(bm.h, 40) } },
        category: 'spacing',
        property: prop,
        groupBy: `${target.selector}|${prop}|${go}|${gm}`,
        severity: Math.abs(delta) > 24 ? 'medium' : 'low',
        title: `Gap above ${b.o.text ? `“${short(b.o.text, 30)}”` : `the ${b.o.kind === 'image' ? 'image' : b.o.tag}`} is ${gm}px, original ${go}px`,
        detail: `Measured from ${above.o.text ? `“${short(above.o.text, 30)}”` : `the ${above.o.kind === 'image' ? 'image' : above.o.tag} above`}. ${delta > 0 ? 'Add' : 'Remove'} ${Math.abs(delta)}px.`,
        ov: `${go}px`,
        mv: `${gm}px`,
        fix: {
          file: fileFor(target, isEds),
          selector: target.selector,
          decl: [{ prop, value: `${next}px`, comment: `currently ${current}px` }],
          note: next === 0 && current + delta < 0 ? `Only ${current}px can be removed here; check the other spacing around this gap.` : undefined,
        },
      });
    }
  });

  // ---------- column layout (cards, columns, grids) ----------
  const drawn = (e) => (e.ink && e.kind !== 'image' ? { ...e.rect, y: e.ink.y, h: e.ink.h } : e.rect);
  const rowsOf = (items, side) => {
    const rows = [];
    [...items].sort((p, q) => drawn(p[side]).y - drawn(q[side]).y).forEach((it) => {
      const r = drawn(it[side]);
      const slack = Math.min(80, r.h * 1.5 + 24); // about two lines of the item
      const row = rows.find((rw) => Math.abs(rw.y - r.y) <= slack
        && rw.items.every((x) => !overlapX(drawn(x[side]), r) && pct(drawn(x[side]).w, r.w) < 0.3));
      if (row) row.items.push(it); else rows.push({ y: r.y, items: [it] });
    });
    return rows;
  };
  const lca = (els) => {
    const first = els[0];
    return (first.anc || []).find((a) => els.every((e) => e.path.startsWith(`${a.p}/`))) || null;
  };
  const layoutSeen = new Map();
  ['image', 'heading', 'action', 'text'].forEach((kind) => {
    // no inOrder filter here: a grid that reflows to fewer columns legitimately changes order
    const items = geomPairs.filter(({ o, m }) => o.kind === kind && m.kind === kind && o.region === 'main');
    // rows in either page: side by side in the original and stacked in migrated, or the reverse
    const groupsO = rowsOf(items, 'o').filter((r) => r.items.length >= 2).map((r) => r.items);
    const groupsM = rowsOf(items, 'm').filter((r) => r.items.length >= 2).map((r) => r.items);
    // columns = how many distinct horizontal positions the items take: cards of uneven height
    // put their last lines at different heights, but they are still side by side
    const columnsOf = (group, side) => {
      const cols = [];
      [...group].sort((p, q) => drawn(p[side]).x - drawn(q[side]).x).forEach((it) => {
        const r = drawn(it[side]);
        const col = cols.find((c) => c.some((x) => overlapX(drawn(x[side]), r)));
        if (col) col.push(it); else cols.push([it]);
      });
      return cols.length;
    };
    [...groupsO, ...groupsM].forEach((group) => {
      const colsO = columnsOf(group, 'o');
      const colsM = columnsOf(group, 'm');
      if (colsO === colsM) return;
      const row = { items: [...group].sort((p, q) => p.o.rect.y - q.o.rect.y || p.o.rect.x - q.o.rect.x).slice(0, Math.max(colsO, colsM)) };
      const container = lca(group.map((it) => it.m));
      if (!container) return;
      const xs = row.items.map((it) => it.o.rect).sort((p, q) => p.x - q.x);
      const gap = median(xs.slice(1).map((r, i) => r.x - (xs[i].x + xs[i].w)).filter((g) => g >= 0));
      if (layoutSeen.has(container.p)) {
        // the same grid seen through another element type: the tightest gap is the column gap
        // (headings/text carry their own margins inside the cards)
        const gapDecl = layoutSeen.get(container.p).fix.decl.find((x) => x.prop === 'gap');
        if (gapDecl && colsO > 1 && gap < parseFloat(gapDecl.value)) gapDecl.value = `${gap}px`;
        return;
      }
      let d;
      if (colsO === 1) {
        d = container.d.includes('flex')
          ? [{ prop: 'flex-direction', value: 'column' }]
          : [{ prop: 'grid-template-columns', value: '1fr' }];
      } else {
        d = [{ prop: 'display', value: 'grid' }, { prop: 'grid-template-columns', value: `repeat(${colsO}, 1fr)` }, { prop: 'gap', value: `${gap}px` }];
      }
      const finding = {
        o: { ...ref(row.items[0].o), rect: unionRect(row.items.map((it) => it.o.rect)) },
        m: { ...ref(row.items[0].m), selector: container.s, rect: unionRect(row.items.map((it) => it.m.rect)) },
        category: 'layout',
        property: 'columns',
        layoutPath: container.p,
        severity: 'high',
        title: `${colsO} per row in the original, ${colsM} per row in migrated`,
        detail: `Repeating ${kind}s (“${short(row.items[0].o.text, 30) || row.items[0].o.tag}” …) are arranged differently at ${width}px.`,
        ov: `${colsO} columns`,
        mv: `${colsM} columns`,
        fix: { file: fileFor(row.items[0].m, isEds), selector: container.s, decl: d },
      };
      layoutSeen.set(container.p, finding);
      add(finding);
    });
  });

  // ---------- content container width ----------
  const mainPairs = geomPairs.filter(({ o, m }) => o.region === 'main' && m.region === 'main' && textual(o) && o.rect.w < width * 0.98);
  if (mainPairs.length >= 5) {
    const lo = percentile(mainPairs.map((p) => p.o.rect.x), 0.1);
    const ro = percentile(mainPairs.map((p) => p.o.rect.x + p.o.rect.w), 0.9);
    const lm = percentile(mainPairs.map((p) => p.m.rect.x), 0.1);
    const rm = percentile(mainPairs.map((p) => p.m.rect.x + p.m.rect.w), 0.9);
    if (Math.abs(lo - lm) > 16 || Math.abs((ro - lo) - (rm - lm)) > 32) {
      const centred = Math.abs(lo - (width - ro)) < 24;
      const box = mig.container || { pl: 0, pr: 0, boxSizing: 'content-box', maxWidth: 'none' };
      const maxW = parseFloat(box.maxWidth);
      // migrated container already capped by max-width at this width -> the cap is wrong;
      // otherwise the content spans the viewport and the gutters are wrong
      const capped = Number.isFinite(maxW) && width - box.pl - box.pr > (box.boxSizing === 'border-box' ? maxW - box.pl - box.pr : maxW) + 1;
      const contentW = Math.round(ro - lo);
      const decls = centred && (capped || lo > 64)
        ? [{ prop: 'max-width', value: `${box.boxSizing === 'border-box' ? contentW + box.pl + box.pr : contentW}px`, comment: `${contentW}px content + ${box.boxSizing === 'border-box' ? 'padding' : 'no padding'}` }]
        : [{ prop: 'padding-inline', value: centred ? `${Math.round(lo)}px` : `${Math.round(lo)}px ${Math.round(width - ro)}px`, comment: `currently ${box.pl}px ${box.pr}px` }];
      add({
        o: { rect: { x: lo, y: 0, w: ro - lo, h: Math.min(orig.height, 1200) }, selector: 'content area', text: '' },
        m: { rect: { x: lm, y: 0, w: rm - lm, h: Math.min(mig.height, 1200) }, selector: 'main > .section > div', text: '' },
        category: 'layout',
        property: 'container',
        severity: 'high',
        title: `Content column is ${Math.round(rm - lm)}px wide at x=${Math.round(lm)}, original ${Math.round(ro - lo)}px at x=${Math.round(lo)}`,
        detail: 'Page gutters or max-width differ. This shifts most content on the page.',
        ov: `${Math.round(lo)} → ${Math.round(ro)}`,
        mv: `${Math.round(lm)} → ${Math.round(rm)}`,
        fix: {
          file: isEds ? 'styles/styles.css' : null,
          selector: 'main > .section > div',
          decl: decls,
        },
      });
    }
  }

  // ---------- missing / extra content ----------
  const groupRegions = (els) => {
    const top = els.filter((e) => !els.some((p) => contains(p.rect, e.rect)));
    const sorted = [...top].sort((p, q) => p.rect.y - q.rect.y);
    const groups = [];
    sorted.forEach((e) => {
      const g = groups[groups.length - 1];
      if (g && g.region === e.region && e.rect.y - g.bottom < 80) {
        g.items.push(e);
        g.bottom = Math.max(g.bottom, e.rect.y + e.rect.h);
      } else groups.push({ region: e.region, items: [e], bottom: e.rect.y + e.rect.h });
    });
    return groups;
  };
  const iconOnly = (e) => e.labelOnly && e.kind !== 'image';
  const CONSENT = /requires[^.]{0,60}cookies|cookie (preferences|settings)|accept[^.]{0,30}cookies/i;
  const consentNotes = (mig.elements || []).filter((e) => e.visible && e.region === 'main' && CONSENT.test(e.text || ''));
  const consentIds = new Set(consentNotes.map((e) => e.i));
  const missingGroups = groupRegions(match.missing.filter((e) => !e.embed && !iconOnly(e)).filter((e) => e.text || e.kind === 'image'));
  const extraGroups = groupRegions(match.extra.filter((e) => !e.embed && !iconOnly(e) && !consentIds.has(e.i)
    && !consentNotes.some((c) => contains(c.rect, e.rect))).filter((e) => (e.text && e.text.length > 2) || e.kind === 'image'));
  // same structure at the same spot but different text: dynamic/randomised content (feeds, search, carousels)
  const swapped = new Set();
  missingGroups.forEach((mg) => {
    const orect = unionRect(mg.items.map((e) => e.rect));
    const sels = new Set(mg.items.map((e) => e.selector));
    const near = (x) => Math.abs(unionRect(x.items.map((e) => e.rect)).y - match.ymap(orect.y)) < Math.max(200, orect.h);
    const sameMarkup = (x) => x.items.some((e) => sels.has(e.selector));
    // same markup in the same spot: dynamic content; other markup in the same spot (a
    // different card in a list): still one difference, not "missing" plus "extra"
    // another item of the same list on both pages: the original item looks like items
    // that were matched, and the migrated one looks like their migrated counterparts
    const sameList = (x) => {
      const xs = new Set(x.items.map((e) => e.selector));
      return match.matched.some((p) => sels.has(p.o.selector) && xs.has(p.m.selector));
    };
    const eg = extraGroups.find((x) => !swapped.has(x) && sameMarkup(x) && near(x))
      || extraGroups.find((x) => !swapped.has(x) && near(x) && sameList(x));
    if (!eg) return;
    swapped.add(mg);
    swapped.add(eg);
    const dynamic = sameMarkup(eg);
    // the item's title: a heading, else a link or text, else an image label
    const lead = (g) => (g.items.find((e) => e.kind === 'heading')
      || g.items.find((e) => e.kind !== 'image' && e.text && e.text.length > 12)
      || g.items.find((e) => e.text) || g.items[0]).text;
    add({
      o: { rect: orect, selector: mg.items[0].selector, text: short(mg.items[0].text) },
      m: { rect: unionRect(eg.items.map((e) => e.rect)), selector: eg.items[0].selector, text: short(eg.items[0].text) },
      category: 'content',
      property: 'changed',
      severity: dynamic ? 'low' : 'medium',
      title: dynamic
        ? `Content differs in the same spot (${mg.items.length} vs ${eg.items.length} elements)`
        : `Different content: “${short(lead(eg), 34)}” where the original has “${short(lead(mg), 34)}”`,
      detail: dynamic
        ? `Original: “${short(mg.items[0].text, 40)}”. Migrated: “${short(eg.items[0].text, 40)}”. Same markup, different text: probably dynamic content (search results, feeds, random teasers).`
        : `Original: “${short(lead(mg), 60)}”. Migrated: “${short(lead(eg), 60)}”. The same spot shows a different item (e.g. another card in a list).`,
      ov: countOf(mg.items.length),
      mv: countOf(eg.items.length),
      fix: {
        file: null, selector: null, decl: [], note: 'If the content is meant to be static, check the authored content. Otherwise approve it, or add its selector to "Ignore elements" in the comparison form.',
      },
    });
  });
  missingGroups.filter((g) => !swapped.has(g)).forEach((g) => {
    const rect = unionRect(g.items.map((e) => e.rect));
    const heading = g.items.find((e) => e.kind === 'heading');
    const sample = g.items.filter((e) => e.text).slice(0, 3).map((e) => `“${short(e.text, 40)}”`).join(', ');
    const images = g.items.filter((e) => e.kind === 'image').length;
    const my = Math.round(match.ymap(rect.y));
    const where = { header: 'the nav fragment (nav)', footer: 'the footer fragment (footer)' }[g.region];
    add({
      o: { rect, selector: g.items[0].selector, text: short(g.items[0].text) },
      m: { rect: { x: rect.x, y: my, w: rect.w, h: Math.min(rect.h, 120) }, selector: null, expected: true },
      category: 'content',
      property: 'missing',
      severity: heading || g.items.length >= 3 || images ? 'high' : 'medium',
      title: heading ? `Missing section “${short(heading.text, 40)}”` : `Missing content (${g.items.length} element${g.items.length > 1 ? 's' : ''})`,
      detail: `${sample}${images ? `${sample ? ' and ' : ''}${images} image${images > 1 ? 's' : ''}` : ''} not found on the migrated page.`,
      ov: countOf(g.items.length),
      mv: 'not found',
      fix: {
        file: null,
        selector: null,
        decl: [],
        note: where
          ? `Add this content to ${where} document.`
          : 'Check the import parser/transformer for this section (it may be dropped or filtered), or author the missing content.',
      },
    });
  });
  extraGroups.filter((g) => !swapped.has(g)).forEach((g) => {
    if (g.items.length === 1 && g.items[0].kind !== 'image' && g.items[0].text.length < 12) return;
    const rect = unionRect(g.items.map((e) => e.rect));
    add({
      o: { rect: null, selector: null },
      m: { rect, selector: g.items[0].selector, text: short(g.items[0].text), block: g.items[0].block },
      category: 'content',
      property: 'extra',
      severity: 'low',
      title: `Extra content on migrated page (${g.items.length} element${g.items.length > 1 ? 's' : ''})`,
      detail: `${g.items.filter((e) => e.text).slice(0, 3).map((e) => `“${short(e.text, 40)}”`).join(', ')} is not on the original.`,
      ov: 'not present',
      mv: countOf(g.items.length),
      fix: {
        file: null, selector: null, decl: [], note: 'Remove it from the page content, or exclude it in the import cleanup transformer.',
      },
    });
  });

  // heading level changes (SEO / accessibility)
  visiblePairs.filter(({ o, m }) => o.kind === 'heading' && m.kind === 'heading' && o.level !== m.level).forEach(({ o, m }) => {
    add({
      o: ref(o),
      m: ref(m),
      category: 'content',
      property: 'heading-level',
      severity: 'low',
      title: `Heading level h${m.level}, original h${o.level}`,
      detail: `“${short(o.text, 40)}”: the document outline differs (SEO/accessibility).`,
      ov: `h${o.level}`,
      mv: `h${m.level}`,
      fix: {
        file: null, selector: null, decl: [], note: `Change the heading to h${o.level} in the content (or in the import parser).`,
      },
    });
  });

  // wording changed on a matched element (copy edits, typos, test text left in the content)
  visiblePairs.filter(({ o, m, split, icon }) => !split && !icon && textual(o) && textual(m) && !o.labelOnly && !m.labelOnly
    && textKey(o.text) !== textKey(m.text)).forEach(({ o, m }) => {
    // name the words that changed; quote both texts only when it was rewritten
    const wd = wordDiff(o.text, m.text);
    add({
      o: ref(o),
      m: ref(m),
      category: 'content',
      property: 'text',
      severity: 'medium',
      title: wd ? `Wording: ${wd.title}` : `Text differs: “${short(m.text, 40)}”, original “${short(o.text, 40)}”`,
      detail: `Original: “${short(o.text, 120)}”. Migrated: “${short(m.text, 120)}”.`,
      ov: wd ? wd.ov : short(o.text, 80),
      mv: wd ? wd.mv : short(m.text, 80),
      words: wd ? { o: wd.o, m: wd.m } : undefined,
      fix: {
        file: null, selector: null, decl: [], note: 'Correct the text in the page content.',
      },
    });
  });

  // ---------- third-party embeds (Twitter, Instagram, YouTube, …) ----------
  // Paired by post id (tweet / video id) when known, otherwise in page order. A post
  // that has no embed on the other page may still be there as plain content (quote +
  // link): migration usually keeps the content but drops the provider's embed markup.
  const sameText = (embedText, elements) => {
    const k = textKey(embedText).slice(0, 240);
    if (k.length < 20) return null;
    return elements.find((e) => {
      if (!e.visible || e.embed || !e.text) return false;
      const ek = textKey(e.text);
      if (ek.length < 20) return false;
      return k.includes(ek.slice(0, 120)) || ek.includes(k.slice(0, 120)) || dice(k, ek.slice(0, 240)) >= 0.7;
    }) || null;
  };
  // the same post shown as ordinary content on `page` (a link to it, or its text)
  const asContent = (embed, page) => {
    const link = embed.id && (page.embedLinks || []).find((l) => l.id === embed.id);
    if (link) return { rect: link.rect, selector: link.selector, block: link.block };
    const el = embed.text && sameText(embed.text, page.elements || []);
    return el ? { rect: el.rect, selector: el.selector, block: el.block } : null;
  };
  const providers = new Set([...(orig.embeds || []), ...(mig.embeds || [])].map((e) => e.provider));
  providers.forEach((provider) => {
    const oe = (orig.embeds || []).filter((e) => e.provider === provider);
    const me = (mig.embeds || []).filter((e) => e.provider === provider);
    // rendering an embed is the block's script's job, not its CSS
    const fileOf = (e) => (e.block && isEds ? `blocks/${e.block}/${e.block}.js` : null);
    const scriptNote = `The ${provider} embed script didn't render it. Check the embed block loads the provider script (EDS embed blocks load it when the block scrolls into view), and that a consent manager or CSP isn't blocking it.`;

    const pairs = [];
    const usedM = new Set();
    oe.forEach((o) => {
      const m = o.id && me.find((x) => !usedM.has(x) && x.id === o.id);
      if (m) { usedM.add(m); pairs.push([o, m]); }
    });
    const restM = me.filter((m) => !usedM.has(m));
    const leftO = [];
    oe.filter((o) => !pairs.some(([p]) => p === o)).forEach((o) => {
      // in page order, unless both ids are known (different ids = different posts)
      const idx = restM.findIndex((m) => !(o.id && m.id));
      if (idx >= 0) pairs.push([o, restM.splice(idx, 1)[0]]);
      else leftO.push(o);
    });

    pairs.forEach(([o, m]) => {
      if (o.rendered && !m.rendered) {
        add({
          o: { rect: o.rect, selector: o.selector },
          m: { rect: m.rect, selector: m.selector, block: m.block },
          category: 'content',
          property: 'embed',
          severity: 'medium',
          title: `${provider} embed not rendered on the migrated page`,
          detail: `The original shows the rendered ${provider} card. The migrated page still shows the plain fallback text.`,
          ov: 'rendered',
          mv: 'fallback text',
          fix: {
            file: fileOf(m), selector: null, decl: [], note: scriptNote,
          },
        });
      } else if (!o.rendered && m.rendered) {
        add({
          o: { rect: o.rect, selector: o.selector },
          m: { rect: m.rect, selector: m.selector, block: m.block },
          category: 'content',
          property: 'embed',
          severity: 'low',
          title: `${provider} embed rendered on migrated, plain fallback on the original`,
          detail: `Both pages contain the ${provider} post. Only the migrated page rendered it during capture.`,
          ov: 'fallback text',
          mv: 'rendered',
          fix: {
            file: null, selector: null, decl: [], note: 'Usually fine. The original\'s embed script was slow or blocked during capture.',
          },
        });
      }
    });

    leftO.forEach((o) => {
      const c = asContent(o, mig);
      if (c && !o.rendered) return; // same post, shown as plain text on both pages: looks the same
      if (c) {
        add({
          o: { rect: o.rect, selector: o.selector },
          m: { rect: c.rect, selector: c.selector, block: c.block },
          category: 'content',
          property: 'embed',
          severity: 'medium',
          title: `${provider} post shows as plain text on the migrated page`,
          detail: `The post's content is on the migrated page, but as a plain quote/link instead of the embedded ${provider} card.`,
          ov: 'embedded card',
          mv: 'plain text',
          fix: {
            file: null,
            selector: null,
            decl: [],
            note: `Author it as an Embed block with the post's URL so the embed block renders the ${provider} card (EDS doesn't render embed markup inside default content).`,
          },
        });
        return;
      }
      const my = Math.round(match.ymap(o.rect.y));
      const gate = consentNotes.find((n) => Math.abs(n.rect.y - my) < Math.max(400, o.rect.h));
      add({
        o: { rect: o.rect, selector: o.selector },
        m: gate ? { rect: gate.rect, selector: gate.selector, text: short(gate.text) }
          : { rect: { x: o.rect.x, y: my, w: o.rect.w, h: Math.min(o.rect.h, 120) }, selector: null, expected: true },
        category: 'content',
        property: 'embed',
        severity: 'high',
        title: `${provider} post missing on the migrated page`,
        detail: gate
          ? `The migrated page shows “${short(gate.text, 70)}” in its place: the ${provider} embed only loads after social-media cookies are accepted. The original shows it without consent.`
          : `This ${provider} post isn't on the migrated page, as an embed or as a quote/link.`,
        ov: 'present',
        mv: 'not found',
        fix: {
          file: null, selector: null, decl: [], note: `Author an Embed block with the ${provider} URL, or check that the import parser keeps embeds.`,
        },
      });
    });

    restM.forEach((m) => {
      const c = asContent(m, orig);
      if (c && !m.rendered) return; // plain on both pages
      if (c) return; // original shows the same post as plain content: an upgrade, not a parity bug
      add({
        o: { rect: null, selector: null },
        m: { rect: m.rect, selector: m.selector, block: m.block },
        category: 'content',
        property: 'embed',
        severity: 'low',
        title: `Extra ${provider} embed on the migrated page`,
        detail: `This ${provider} post isn't on the original page.`,
        ov: 'not present',
        mv: 'present',
        fix: {
          file: null, selector: null, decl: [], note: 'Remove it from the page content if it isn\'t meant to be there.',
        },
      });
    });
  });

  // ---------- page level ----------
  if (mig.overflow && !orig.overflow) {
    const off = mig.offenders[0];
    add({
      o: { rect: null, selector: null },
      m: { rect: off ? off.rect : null, selector: off ? off.selector : 'body' },
      category: 'responsive',
      property: 'overflow',
      severity: 'high',
      title: `Horizontal scrolling at ${width}px (page is ${mig.scrollWidth}px wide)`,
      detail: off ? `Widest element: ${off.selector} (${off.w}px wide, ends at ${off.right}px).` : 'Content is wider than the viewport.',
      ov: `${orig.scrollWidth}px`,
      mv: `${mig.scrollWidth}px`,
      fix: off
        ? {
          file: fileFor({ block: off.block }, isEds),
          selector: off.selector,
          decl: [{ prop: 'min-width', value: '0' }, { prop: 'max-width', value: '100%' }, { prop: 'box-sizing', value: 'border-box' }],
        }
        : { file: null, selector: null, decl: [], note: 'Find the element wider than the viewport.' },
    });
  }
  const hRatio = mig.height / Math.max(1, orig.height);
  if (Math.abs(1 - hRatio) > 0.15) {
    add({
      o: { rect: null, selector: null },
      m: { rect: null, selector: null },
      category: 'page',
      property: 'height',
      severity: Math.abs(1 - hRatio) > 0.35 ? 'medium' : 'low',
      title: `Page is ${Math.round(Math.abs(1 - hRatio) * 100)}% ${hRatio > 1 ? 'taller' : 'shorter'} (${mig.height}px vs ${orig.height}px)`,
      detail: 'Usually caused by the spacing, missing content or layout issues listed here.',
      ov: `${orig.height}px`,
      mv: `${mig.height}px`,
      fix: {
        file: null, selector: null, decl: [], note: 'Fix the spacing/content/layout issues first, then check again.',
      },
    });
  }
  const failedInOrig = new Set((orig.fonts || []).filter((f) => f.status === 'error').map((f) => f.family.toLowerCase()));
  // local()-only faces (EDS size-adjusted fallbacks) depend on the fonts of the machine
  // running the check, not on the site: they are never a download failure
  const localOnly = new Set(mig.localOnlyFonts || []);
  const failedFonts = (mig.fonts || []).filter((f) => f.status === 'error' && !failedInOrig.has(f.family.toLowerCase())
    && !localOnly.has(f.family.toLowerCase()) && !/-fallback$/i.test(f.family));
  if (failedFonts.length) {
    add({
      o: { rect: null, selector: null },
      m: { rect: null, selector: null },
      category: 'typography',
      property: 'font-loading',
      severity: 'high',
      title: `Web font failed to load: ${[...new Set(failedFonts.map((f) => f.family))].join(', ')}`,
      detail: 'The browser fell back to a system font.',
      ov: '',
      mv: 'error',
      fix: {
        file: isEds ? 'styles/fonts.css' : null, selector: null, decl: [], note: 'Check the @font-face src URLs and that the font files are committed under /fonts.',
      },
    });
  }
  // ERR_ABORTED is the browser cancelling a request itself (lazy images it no longer needs,
  // an embed's carousel, a navigation): nothing is broken
  const broken = (mig.failedRequests || []).filter((r) => !/analytics|gtm|doubleclick|rum|hlx\.page\/.*\.json/.test(r.url)
    && !/ERR_ABORTED|NS_BINDING_ABORTED/.test(String(r.status)));
  if (broken.length) {
    add({
      o: { rect: null, selector: null },
      m: { rect: null, selector: null },
      category: 'page',
      property: 'requests',
      severity: 'low',
      title: `${broken.length} failed request${broken.length > 1 ? 's' : ''} on the migrated page`,
      detail: broken.slice(0, 4).map((r) => `${r.status} ${short(r.url, 80)}`).join('\n'),
      ov: '',
      mv: `${broken.length}`,
      fix: {
        file: null, selector: null, decl: [], note: 'Missing assets often show up as broken images or icons.',
      },
    });
  }

  // ---------- drop symptoms already explained by a column layout issue ----------
  const layoutPaths = findings.filter((f) => f.property === 'columns').map((f) => f.layoutPath);
  const offenderSelectors = mig.overflow ? mig.offenders.map((o) => o.selector) : [];
  const explained = (f) => ['max-width', 'size'].includes(f.property) && f.m?.path
    && (layoutPaths.some((p) => f.m.path.startsWith(`${p}/`))
      || (f.property === 'max-width' && offenderSelectors.includes(f.m.selector)));
  const kept = findings.filter((f) => !explained(f));

  // ---------- group duplicates (same selector, same property, same values) ----------
  const grouped = new Map();
  kept.forEach((f) => {
    const props = (f.fix?.decl || []).map((d) => d.prop).join(',');
    const key = f.groupBy
      ? [f.category, f.property, f.groupBy].join('|')
      : [f.category, f.property, props, f.fix?.selector || f.m?.selector || f.title, f.ov, f.mv].join('|');
    if (!grouped.has(key)) {
      grouped.set(key, { ...f, count: f.count || 1, m: { ...f.m, rects: f.m.rects || (f.m.rect ? [f.m.rect] : []) }, oRects: f.o.rect ? [f.o.rect] : [] });
    } else {
      const g = grouped.get(key);
      g.count += 1;
      if (f.m.rect && g.m.rects.length < 12) g.m.rects.push(f.m.rect);
      if (f.o.rect && g.oRects.length < 12) g.oRects.push(f.o.rect);
      if (SEV[f.severity] > SEV[g.severity]) g.severity = f.severity;
    }
  });
  const issues = [...grouped.values()]
    .map((g) => {
      const { groupBy, layoutPath, ...rest } = g;
      if (rest.count > 1 && rest.property !== 'font-family') {
        rest.detail = `${rest.detail} (${rest.count} elements)`;
      }
      return rest;
    })
    .sort((p, q) => SEV[q.severity] - SEV[p.severity]
      || ((p.m.rect || p.o.rect || { y: 1e9 }).y - (q.m.rect || q.o.rect || { y: 1e9 }).y));
  issues.forEach((iss, n) => { iss.id = `${width}-${n + 1}`; iss.n = n + 1; iss.width = width; });

  // ---------- score ----------
  const weight = issues.reduce((s, i) => s + ({ high: 6, medium: 3, low: 1 }[i.severity]), 0);
  const matchRate = match.matched.length / Math.max(1, match.matched.length + match.missing.length);
  const score = Math.max(0, Math.round(
    (diff.similarity * 0.35) + (matchRate * 100 * 0.35) + (Math.max(0, 100 - weight * 1.5) * 0.3),
  ));

  return {
    issues,
    score,
    stats: {
      matched: match.matched.length,
      missing: match.missing.length,
      extra: match.extra.length,
      matchRate: Math.round(matchRate * 1000) / 10,
      similarity: diff.similarity,
      high: issues.filter((i) => i.severity === 'high').length,
      medium: issues.filter((i) => i.severity === 'medium').length,
      low: issues.filter((i) => i.severity === 'low').length,
    },
  };
}
