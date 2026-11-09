/*
 * Functions in this file run inside the browser via page.evaluate().
 * They must be fully self-contained: no imports, no references to module scope.
 */

/**
 * Collects @media conditions from every same-origin stylesheet (CSSOM) and
 * reports the hrefs of stylesheets whose rules are not readable (cross-origin),
 * so the caller can parse those from the network response text instead.
 */
export function collectMediaFromCssom() {
  const conditions = [];
  const unreadable = [];
  const walk = (rules) => {
    [...rules].forEach((rule) => {
      if (rule.type === CSSRule.MEDIA_RULE) {
        conditions.push(rule.conditionText || rule.media.mediaText);
      }
      if (rule.type === CSSRule.IMPORT_RULE && rule.styleSheet) {
        try {
          walk(rule.styleSheet.cssRules);
        } catch (e) {
          unreadable.push(rule.styleSheet.href);
        }
      }
      if (rule.cssRules && rule.type !== CSSRule.MEDIA_RULE) walk(rule.cssRules);
      if (rule.type === CSSRule.MEDIA_RULE) walk(rule.cssRules);
    });
  };
  const sheets = [...document.styleSheets, ...(document.adoptedStyleSheets || [])];
  sheets.forEach((sheet) => {
    try {
      if (sheet.media && sheet.media.mediaText && sheet.media.mediaText !== 'all') {
        conditions.push(sheet.media.mediaText);
      }
      walk(sheet.cssRules);
    } catch (e) {
      if (sheet.href) unreadable.push(sheet.href);
    }
  });
  return { conditions, unreadable, sheetCount: sheets.length };
}

/**
 * Scrolls through the page so lazy-loaded sections, images and blocks render.
 */
export async function autoScroll({ maxHeight }) {
  const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
  const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
  let y = 0;
  for (let i = 0; i < 80; i += 1) {
    const limit = Math.min(document.documentElement.scrollHeight, maxHeight);
    if (y >= limit) break;
    y += step;
    window.scrollTo(0, y);
    // eslint-disable-next-line no-await-in-loop
    await sleep(120);
  }
  window.scrollTo(0, 0);
  await sleep(400);
}

/**
 * Extracts a structural/style fingerprint of the rendered page.
 */
export function extractPage({ hideSelectors = [], maxElements = 3000 }) {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const sx = window.scrollX;
  const sy = window.scrollY;

  hideSelectors.forEach((sel) => {
    try {
      document.querySelectorAll(sel).forEach((el) => el.style.setProperty('display', 'none', 'important'));
    } catch (e) { /* invalid selector */ }
  });

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const px = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  };
  const isTransparent = (c) => !c || c === 'transparent' || /rgba\(.*,\s*0\)$/.test(c);

  const SEMANTIC = {
    H1: 'heading',
    H2: 'heading',
    H3: 'heading',
    H4: 'heading',
    H5: 'heading',
    H6: 'heading',
    A: 'action',
    BUTTON: 'action',
    P: 'text',
    LI: 'text',
    BLOCKQUOTE: 'text',
    FIGCAPTION: 'text',
    TD: 'text',
    TH: 'text',
    DT: 'text',
    DD: 'text',
    LABEL: 'text',
    SUMMARY: 'text',
  };
  const kindOf = (el) => {
    const role = el.getAttribute('role');
    if (role === 'heading') return 'heading';
    if (role === 'button') return 'action';
    return SEMANTIC[el.tagName];
  };

  const regionOf = (el) => {
    if (el.closest('header, [role=banner]')) return 'header';
    if (el.closest('footer, [role=contentinfo]')) return 'footer';
    return 'main';
  };

  const blockOf = (el) => {
    const block = el.closest('.block[data-block-name]');
    if (block) return block.dataset.blockName;
    return null;
  };

  const GENERIC = /^(block|section|default-content-wrapper|button-container|appear|visible|active|is-|js-|ng-|css-|sc-|jsx-)/;
  const goodClass = (el) => [...el.classList].find((c) => !GENERIC.test(c) && !/\d{3,}|[A-Z0-9]{6,}|__/.test(c) && c.length < 40);
  const part = (el) => {
    const c = goodClass(el);
    const tag = el.tagName.toLowerCase();
    if (!c) return tag;
    return ['div', 'span'].includes(tag) ? `.${CSS.escape(c)}` : `${tag}.${CSS.escape(c)}`;
  };

  // Pretty, author-friendly selector used in recommended CSS.
  const selectorOf = (el) => {
    const block = el.closest('.block[data-block-name]');
    const parts = [];
    let cur = el;
    let root;
    let stop = null;
    if (block) {
      root = `.${CSS.escape(block.dataset.blockName)}`;
      if (el === block) return root;
      stop = block;
    } else {
      const section = el.closest('main > .section, main > div');
      const wrapper = el.closest('.default-content-wrapper');
      if (section && wrapper) {
        const extra = [...section.classList].filter((c) => c !== 'section' && !GENERIC.test(c));
        root = `main ${extra.length ? `.section.${extra.map((c) => CSS.escape(c)).join('.')} ` : ''}.default-content-wrapper`;
        if (el === wrapper) return root;
        stop = wrapper;
      }
    }
    while (cur && cur !== stop && cur !== document.body && parts.length < 3) {
      parts.unshift(part(cur));
      cur = cur.parentElement;
    }
    if (!root) {
      // non-EDS page: anchor on the nearest ancestor with an id or a good class
      while (cur && cur !== document.body && !root) {
        if (cur.id && !/\d{3,}/.test(cur.id)) root = `#${CSS.escape(cur.id)}`;
        else if (['MAIN', 'HEADER', 'FOOTER', 'NAV'].includes(cur.tagName)) root = cur.tagName.toLowerCase();
        cur = cur.parentElement;
      }
    }
    // collapse to at most root + last two parts
    const tail = parts.slice(-2);
    return [root, ...tail].filter(Boolean).join(' ');
  };

  const pathOf = (el) => {
    const segs = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== doc) {
      let i = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) i += 1;
        sib = sib.previousElementSibling;
      }
      segs.unshift(`${cur.tagName.toLowerCase()}:${i}`);
      cur = cur.parentElement;
    }
    return segs.join('/');
  };

  // translate offsets from transforms (scroll-reveal, marquees) are removed so the
  // measured position is the layout position, independent of animation state
  const translateCache = new Map();
  const translateOf = (el) => {
    if (!el || el === document.body || el.nodeType !== 1) return { tx: 0, ty: 0 };
    if (translateCache.has(el)) return translateCache.get(el);
    const parent = translateOf(el.parentElement);
    const cs = getComputedStyle(el);
    let { tx, ty } = parent;
    if (cs.transform && cs.transform !== 'none') {
      try {
        const m = new DOMMatrixReadOnly(cs.transform);
        tx += m.m41;
        ty += m.m42;
      } catch (e) { /* unsupported matrix */ }
    }
    if (cs.translate && cs.translate !== 'none') {
      const [x = '0', y = '0'] = cs.translate.split(/\s+/);
      tx += parseFloat(x) || 0;
      ty += parseFloat(y) || 0;
    }
    const out = { tx, ty };
    translateCache.set(el, out);
    return out;
  };

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    const { tx, ty } = translateOf(el);
    return {
      x: Math.round(r.left + sx - tx),
      y: Math.round(r.top + sy - ty),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  };

  const isVisible = (el, r) => {
    if (r.w < 1 || r.h < 1) return false;
    // opacity is ignored on purpose: scroll-reveal animations leave content at opacity 0
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) return false;
    if (r.x + r.w <= 0 || r.x >= vw + sx) return false; // off-canvas
    return true;
  };

  const effectiveBg = (el) => {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const cs = getComputedStyle(cur);
      if (!isTransparent(cs.backgroundColor)) return { color: cs.backgroundColor, el: cur };
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && cur !== el) return { color: 'image', el: cur };
      cur = cur.parentElement;
    }
    return { color: 'rgb(255, 255, 255)', el: document.body };
  };

  const ancestorsOf = (el) => {
    const list = [];
    let cur = el.parentElement;
    while (cur && cur !== document.body && list.length < 6) {
      const cs = getComputedStyle(cur);
      list.push({
        p: pathOf(cur), s: selectorOf(cur), d: cs.display, fd: cs.flexDirection, pt: px(cs.paddingTop), pb: px(cs.paddingBottom), b: blockOf(cur),
      });
      cur = cur.parentElement;
    }
    return list;
  };

  // ---- pick candidate elements ----
  const owners = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeValue.trim().length > 1) {
      let el = node.parentElement;
      if (el && !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION'].includes(el.tagName)) {
        while (el && el !== document.body && !kindOf(el)) {
          const d = getComputedStyle(el).display;
          if (d !== 'inline' && d !== 'contents') break;
          el = el.parentElement;
        }
        if (el && el !== document.body) owners.add(el);
      }
    }
    node = walker.nextNode();
  }
  // actions without text (icon links/buttons)
  document.querySelectorAll('a[aria-label], button[aria-label], a:has(img), a:has(svg), button:has(svg)').forEach((el) => owners.add(el));
  // images, media, form controls, large background images
  const media = [...document.querySelectorAll('img, svg, video, iframe, input:not([type=hidden]), select, textarea')]
    .filter((el) => !(el.tagName === 'svg' && el.parentElement.closest('svg')));
  media.forEach((el) => owners.add(el));
  document.querySelectorAll('body *').forEach((el) => {
    if (el.tagName === 'svg' || el.closest('svg')) return;
    const bi = getComputedStyle(el).backgroundImage;
    if (bi && bi.includes('url(')) {
      const r = el.getBoundingClientRect();
      if (r.width >= 120 && r.height >= 80) owners.add(el);
    }
  });

  const elements = [];
  let index = 0;
  [...owners].forEach((el) => {
    if (elements.length >= maxElements) return;
    const tag = el.tagName.toLowerCase();
    const cs = getComputedStyle(el);
    const r = rectOf(el);
    const visible = isVisible(el, r);
    let kind = kindOf(el) || 'text';
    const isMedia = ['img', 'svg', 'video', 'iframe'].includes(tag)
      || (!kindOf(el) && cs.backgroundImage.includes('url(') && !norm(el.innerText));
    if (isMedia) kind = 'image';
    if (['input', 'select', 'textarea'].includes(tag)) kind = 'control';
    if (kind === 'image' && tag === 'svg' && r.w < 24 && r.h < 24) return; // tiny icons
    if (!visible && kind === 'image') return;

    let text = norm(el.innerText || el.textContent);
    if (!text) text = norm(el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder'));
    if (kind !== 'image' && kind !== 'control' && !text && kind !== 'action') return;

    const fs = px(cs.fontSize);
    const lh = cs.lineHeight === 'normal' ? Math.round(fs * 1.2 * 100) / 100 : px(cs.lineHeight);
    const bg = effectiveBg(el);
    const rec = {
      i: index,
      kind,
      tag,
      text: text.slice(0, 200),
      visible,
      rect: r,
      path: pathOf(el),
      selector: selectorOf(el),
      block: blockOf(el),
      region: regionOf(el),
      fixed: (() => {
        let cur = el;
        while (cur && cur !== document.body) {
          const p = getComputedStyle(cur).position;
          if (p === 'fixed' || p === 'sticky') return true;
          cur = cur.parentElement;
        }
        return false;
      })(),
      s: {
        fontFamily: (cs.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim(),
        fontStack: cs.fontFamily,
        fontSize: fs,
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
        fontStyle: cs.fontStyle,
        lineHeight: lh,
        letterSpacing: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
        textTransform: cs.textTransform,
        textAlign: cs.textAlign,
        textDecoration: cs.textDecorationLine,
        color: cs.color,
        bg: bg.color,
        bgSelector: bg.el === document.body ? 'body' : selectorOf(bg.el),
        bgPath: pathOf(bg.el),
        ownBg: isTransparent(cs.backgroundColor) ? null : cs.backgroundColor,
        pt: px(cs.paddingTop),
        pr: px(cs.paddingRight),
        pb: px(cs.paddingBottom),
        pl: px(cs.paddingLeft),
        mt: px(cs.marginTop),
        mb: px(cs.marginBottom),
        radius: px(cs.borderTopLeftRadius),
        borderW: px(cs.borderTopWidth),
        borderC: cs.borderTopColor,
        borderS: cs.borderTopStyle,
        display: cs.display,
        objectFit: cs.objectFit,
      },
    };
    if (kind === 'heading') rec.level = tag.match(/^h\d$/) ? parseInt(tag[1], 10) : parseInt(el.getAttribute('aria-level') || '2', 10);
    if (kind === 'action' && el.href) rec.href = el.getAttribute('href');
    if (tag === 'img') {
      rec.src = el.currentSrc || el.src;
      rec.alt = el.alt || '';
      rec.natural = { w: el.naturalWidth, h: el.naturalHeight };
      rec.broken = el.complete && el.naturalWidth === 0 && !!rec.src;
    }
    if (kind === 'image') {
      // content width of the nearest block-level ancestor: tells whether the image just fills it
      let p = el.parentElement;
      while (p && p !== document.body && ['inline', 'contents'].includes(getComputedStyle(p).display)) p = p.parentElement;
      const pcs = getComputedStyle(p);
      rec.pw = Math.round(p.clientWidth - px(pcs.paddingLeft) - px(pcs.paddingRight));
    }
    if (kind === 'image' && tag !== 'img') {
      const [, src] = cs.backgroundImage.match(/url\(["']?([^"')]+)/) || [];
      if (src) rec.src = src;
      rec.alt = el.getAttribute('aria-label') || '';
    }
    if (visible) rec.anc = ancestorsOf(el);
    if (visible && kind !== 'image') rec.lines = lh ? Math.max(1, Math.round((r.h - rec.s.pt - rec.s.pb) / lh)) : 1;
    elements.push(rec);
    index += 1;
  });

  // ---- page level ----
  const offenders = [];
  if (doc.scrollWidth > vw + 1) {
    document.querySelectorAll('body *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0 && el.checkVisibility()) {
        // only report the outermost offenders
        const parentR = el.parentElement.getBoundingClientRect();
        if (parentR.right <= vw + 1) offenders.push({ selector: selectorOf(el), block: blockOf(el), right: Math.round(r.right), w: Math.round(r.width), rect: rectOf(el) });
      }
    });
  }

  // design tokens declared on :root (EDS custom properties)
  const tokens = [];
  const names = new Set();
  const collect = (rules) => {
    [...rules].forEach((rule) => {
      if (rule.selectorText && /(^|,)\s*:root\b/.test(rule.selectorText)) {
        [...rule.style].filter((n) => n.startsWith('--')).forEach((n) => names.add(n));
      }
    });
  };
  [...document.styleSheets].forEach((sh) => { try { collect(sh.cssRules); } catch (e) { /* cross-origin */ } });
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.append(probe);
  names.forEach((n) => {
    const raw = getComputedStyle(doc).getPropertyValue(n).trim();
    if (!raw) return;
    if (CSS.supports('color', raw) && !/^\d/.test(raw)) {
      probe.style.color = raw;
      tokens.push({ name: n, type: 'color', value: getComputedStyle(probe).color });
    } else if (CSS.supports('font-size', raw) && /\d/.test(raw)) {
      probe.style.fontSize = raw;
      tokens.push({ name: n, type: 'length', value: px(getComputedStyle(probe).fontSize) });
    } else if (/[a-z]/i.test(raw) && !raw.includes('(')) {
      tokens.push({ name: n, type: 'font', value: raw.split(',')[0].replace(/["']/g, '').trim() });
    }
  });
  probe.remove();

  // EDS section content container (main > .section > div), used for gutter / max-width fixes
  let container = null;
  const wrap = document.querySelector('main > .section > div');
  if (wrap) {
    const wcs = getComputedStyle(wrap);
    container = {
      pl: px(wcs.paddingLeft), pr: px(wcs.paddingRight), boxSizing: wcs.boxSizing, maxWidth: wcs.maxWidth,
    };
  }

  return {
    container,
    url: window.location.href,
    title: document.title,
    viewport: vw,
    height: doc.scrollHeight,
    scrollWidth: doc.scrollWidth,
    overflow: doc.scrollWidth > vw + 1,
    offenders: offenders.sort((a, b) => b.right - a.right).slice(0, 5),
    fonts: [...document.fonts].map((f) => ({ family: f.family.replace(/["']/g, ''), status: f.status, weight: f.weight })),
    isEds: !!document.querySelector('main .section, .block[data-block-name]'),
    tokens,
    elements,
  };
}
