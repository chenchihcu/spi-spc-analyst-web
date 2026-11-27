// Browser-side checks for the Web UI Acceptance Gate (spec 2026-11-27-03).
// G2 RUNTIME-CLEAN: watchRuntime(); G3 LAYOUT-INVARIANTS: runLayout() → layoutInvariants() in the page.

/**
 * Runs inside the page via page.evaluate. Returns [{rule, target, detail}].
 * opts: { ignore: [{selector, rules:[...]}], isMobile: boolean, minTarget: number }
 */
export function layoutInvariants(opts) {
  const TOL = 0.5; // absorbs sub-pixel rounding only; a 1 px overflow is a violation
  const ignore = opts.ignore || [];
  const minTarget = opts.minTarget || 44;
  const out = [];
  const ignored = (el, rule) => ignore.some((x) => x.rules.includes(rule) && el.closest(x.selector));
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    if (cls.length) s += '.' + cls.join('.');
    const label = el.getAttribute('aria-label') || (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
    return label ? `${s} "${label}"` : s;
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width * r.height <= 1) return false;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true })) return false;
    const st = getComputedStyle(el);
    if (st.clip === 'rect(0px, 0px, 0px, 0px)' || st.clipPath === 'inset(50%)') return false;
    return true;
  };
  // Horizontal scroll containers let the user reach overflowing content; hidden/clip ancestors cut it off.
  const ancestorX = (el, kinds) => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (kinds.includes(getComputedStyle(p).overflowX)) return true;
    }
    return false;
  };
  const meaningful = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    || el.matches('a[href],button,input,select,textarea,img[alt]:not([alt=""]),[role=button],[role=link]');
  const all = [...document.body.querySelectorAll('*')].filter((el) => !el.closest('svg') || el.tagName.toLowerCase() === 'svg');
  const vis = all.filter(visible);
  const W = window.innerWidth;
  // Fixed/sticky overlays (floating toolbars, sticky headers) are judged by L8, not by L4/L5.
  const overlayOf = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === 'fixed' || pos === 'sticky') return p;
    }
    return null;
  };
  // Visible part of a rect: intersect with every clipping ancestor (overflow != visible).
  const clipRect = (r, el) => {
    let { left, top, right, bottom } = r;
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const st = getComputedStyle(p);
      if (st.overflowX !== 'visible' || st.overflowY !== 'visible') {
        const c = p.getBoundingClientRect();
        if (st.overflowX !== 'visible') { left = Math.max(left, c.left); right = Math.min(right, c.right); }
        if (st.overflowY !== 'visible') { top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom); }
      }
    }
    return right - left > 0 && bottom - top > 0 ? { left, top, right, bottom } : null;
  };

  // L1 page-level horizontal scroll
  const se = document.scrollingElement || document.documentElement;
  if (se.scrollWidth - se.clientWidth > TOL) {
    out.push({ rule: 'L1', target: 'document', detail: `scrollWidth ${se.scrollWidth} > clientWidth ${se.clientWidth}` });
  }

  // L2 element outside the viewport horizontally (outermost offenders only).
  // Inside a horizontal scroll container: fine. Clipped by overflow hidden/clip: a violation only for
  // text and controls (cut-off content); decorative boxes there are ignored.
  const off = new Set(vis.filter((el) => {
    if (ignored(el, 'L2') || ancestorX(el, ['auto', 'scroll'])) return false;
    if (ancestorX(el, ['hidden', 'clip']) && !meaningful(el)) return false;
    const r = el.getBoundingClientRect();
    return r.left < -TOL || r.right > W + TOL;
  }));
  for (const el of off) {
    if (el.parentElement && off.has(el.parentElement)) continue;
    const r = el.getBoundingClientRect();
    out.push({ rule: 'L2', target: describe(el), detail: `left ${Math.round(r.left)}, right ${Math.round(r.right)}, viewport ${W}` });
  }

  // L3 clipped text
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  for (const el of vis) {
    if (!ownText(el) || ignored(el, 'L3') || ['input', 'textarea', 'select', 'option'].includes(el.tagName.toLowerCase())) continue;
    const st = getComputedStyle(el);
    const hx = ['hidden', 'clip'].includes(st.overflowX);
    const hy = ['hidden', 'clip'].includes(st.overflowY);
    if (!hx && !hy) continue;
    if (st.textOverflow === 'ellipsis' || (st.webkitLineClamp && st.webkitLineClamp !== 'none')) continue;
    if ((hx && el.scrollWidth > el.clientWidth + TOL) || (hy && el.scrollHeight > el.clientHeight + TOL)) {
      out.push({ rule: 'L3', target: describe(el), detail: `content ${el.scrollWidth}x${el.scrollHeight} > box ${el.clientWidth}x${el.clientHeight}` });
    }
  }

  // L4 overlapping interactive controls
  const IA = 'a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=link],[role=tab],[role=checkbox],[role=switch],[role=menuitem],[tabindex]:not([tabindex="-1"])';
  const controls = vis.filter((el) => el.matches(IA) && getComputedStyle(el).pointerEvents !== 'none');
  const area = (a, b) => (!a || !b ? 0 : Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)));
  const rects = controls.map((el) => clipRect(el.getBoundingClientRect(), el));
  const overlays = controls.map(overlayOf);
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i], b = controls[j];
      if (a.contains(b) || b.contains(a) || ignored(a, 'L4') || ignored(b, 'L4')) continue;
      if (overlays[i] !== overlays[j]) continue; // overlay vs page content → L8
      const ov = area(rects[i], rects[j]);
      if (ov > 1) out.push({ rule: 'L4', target: `${describe(a)} ⟂ ${describe(b)}`, detail: `overlap ${Math.round(ov)} px²` });
    }
  }

  // L5 overlapping text (text-node rects of different, non-nested elements)
  const boxes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const owner = n.parentElement;
    if (!n.textContent.trim() || !owner || !visible(owner) || owner.closest('svg') || ignored(owner, 'L5')) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const ov = overlayOf(owner);
    for (const raw of range.getClientRects()) {
      const r = clipRect(raw, owner);
      if (r && (r.right - r.left) * (r.bottom - r.top) > 1) boxes.push({ owner, r, ov });
    }
  }
  const seen = new Set();
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.owner === b.owner || a.owner.contains(b.owner) || b.owner.contains(a.owner) || a.ov !== b.ov) continue;
      const ov = area(a.r, b.r);
      const key = describe(a.owner) + '|' + describe(b.owner);
      if (ov > 4 && !seen.has(key)) {
        seen.add(key);
        out.push({ rule: 'L5', target: `${describe(a.owner)} ⟂ ${describe(b.owner)}`, detail: `text overlap ${Math.round(ov)} px²` });
      }
    }
  }

  // L6 touch targets on narrow/mobile viewports; L7 viewport meta
  if (W <= 480) {
    for (const el of controls) {
      if (ignored(el, 'L6')) continue;
      const st = getComputedStyle(el);
      const inlineLink = el.tagName === 'A' && st.display === 'inline' && [...(el.parentElement?.childNodes || [])].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (inlineLink) continue;
      let r = el.getBoundingClientRect();
      if (el.matches('input[type=radio],input[type=checkbox]')) {
        const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`));
        if (lab) r = lab.getBoundingClientRect();
      }
      if (r.width < minTarget - TOL || r.height < minTarget - TOL) {
        out.push({ rule: 'L6', target: describe(el), detail: `${Math.round(r.width)}x${Math.round(r.height)} < ${minTarget}x${minTarget}` });
      }
    }
  }
  // L8 overlay clearance: content under a fixed/sticky bar must be scrollable out from under it.
  const H = window.innerHeight;
  const scrollerOf = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const st = getComputedStyle(p);
      if (['auto', 'scroll'].includes(st.overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
    }
    return document.scrollingElement || document.documentElement;
  };
  // Modal dialogs are meant to cover the page: while one is open only bars inside it are judged,
  // and only against content inside it. Full-screen layers (backdrops) are never "bars".
  const MODAL = '[role=dialog],[role=alertdialog],[aria-modal="true"],dialog[open]';
  const openModal = vis.find((el) => el.matches(MODAL));
  const big = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height >= 0.5 * W * H; };
  const bars = [...new Set(overlays.filter(Boolean))].filter((o) => !ignored(o, 'L8') && !big(o)
    && (!openModal || openModal.contains(o)) && (openModal || !o.closest(MODAL)));
  for (const bar of bars) {
    const b = bar.getBoundingClientRect();
    const atBottom = b.top > H / 2;
    const sticky = getComputedStyle(bar).position === 'sticky';
    const barScroller = sticky ? scrollerOf(bar) : null;
    const under = controls.filter((el) => !bar.contains(el) && overlayOf(el) !== bar && !ignored(el, 'L8')
      && (!openModal || openModal.contains(el)) && (!sticky || scrollerOf(el) === barScroller) && (() => {
        const r = el.getBoundingClientRect();
        return Math.min(r.right, b.right) - Math.max(r.left, b.left) > 1;
      })());
    const byScroller = new Map();
    for (const el of under) { const s = scrollerOf(el); byScroller.set(s, [...(byScroller.get(s) || []), el]); }
    // Bottom bar: at max scroll the last control must be fully clear (others can scroll out).
    // Top/side bar: at scroll 0 (first view) no control may be covered at all.
    for (const [s, els] of byScroller) {
      const saved = s.scrollTop;
      s.scrollTop = atBottom ? s.scrollHeight : 0;
      const nb = bar.getBoundingClientRect(); // sticky bars move with scroll
      const check = atBottom ? [els.reduce((m, el) => (el.getBoundingClientRect().bottom > m.getBoundingClientRect().bottom ? el : m))] : els;
      let reported = 0;
      for (const el of check) {
        const r = el.getBoundingClientRect();
        const covered = Math.min(r.bottom, nb.bottom) - Math.max(r.top, nb.top);
        const across = Math.min(r.right, nb.right) - Math.max(r.left, nb.left);
        if (covered > TOL && across > TOL && r.bottom > 0 && r.top < H && reported < 3) {
          reported++;
          out.push({ rule: 'L8', target: `${describe(el)} under ${describe(bar)}`, detail: `${Math.round(covered)}x${Math.round(across)} px covered ${atBottom ? 'even at max scroll (bottom bar)' : 'on first view (top/side bar)'}` });
        }
      }
      s.scrollTop = saved;
    }
  }

  if (W <= 480 || opts.isMobile) {
    const meta = document.querySelector('meta[name=viewport]');
    if (!meta || !/width\s*=\s*device-width/i.test(meta.content || '')) {
      out.push({ rule: 'L7', target: 'meta[name=viewport]', detail: 'missing width=device-width' });
    }
  }
  return out;
}

/** Attach G2 listeners. Returns the live problems array. */
export function watchRuntime(page, rt) {
  const problems = [];
  const allowed = (list, text) => (list || []).some((x) => new RegExp(x.pattern).test(text));
  page.on('pageerror', (err) => problems.push({ rule: 'pageerror', detail: String(err.message || err).slice(0, 300) }));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !allowed(rt.allowConsole, msg.text())) {
      problems.push({ rule: 'console.error', detail: msg.text().slice(0, 300) });
    }
  });
  page.on('response', (res) => {
    const url = res.url();
    if (url.startsWith(rt.origin) && res.status() >= 400 && !allowed(rt.allowRequests, url)) {
      problems.push({ rule: 'http', detail: `${res.status()} ${res.request().method()} ${url.slice(rt.origin.length)}` });
    }
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    // net::ERR_ABORTED = cancelled by a navigation/reload or the app's own AbortController, not a failure.
    if (req.failure()?.errorText === 'net::ERR_ABORTED') return;
    if (url.startsWith(rt.origin) && !allowed(rt.allowRequests, url)) {
      problems.push({ rule: 'requestfailed', detail: `${req.failure()?.errorText || 'failed'} ${url.slice(rt.origin.length)}` });
    }
  });
  return problems;
}

/** Run G3 in the page; never throws (an evaluation error is itself a violation). */
export async function runLayout(page, rt, isMobile) {
  try {
    return await page.evaluate(
      `(${layoutInvariants.toString()})(${JSON.stringify({ ignore: rt.layoutIgnore || [], isMobile: !!isMobile, minTarget: rt.minTarget || 44 })})`,
    );
  } catch (err) {
    return [{ rule: 'L0', target: 'page', detail: `layout check could not run: ${String(err.message || err).slice(0, 200)}` }];
  }
}
