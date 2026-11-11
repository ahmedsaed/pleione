// In-page measurements for the engine smoke suite. PAGE_LIB is sent as source
// into every page evaluation, so each function here runs on the engine under
// test, Chromium 53 included: ES2015 syntax only (probes.test.mjs parses it as
// such) and no API newer than Chromium 53 (no Object.entries, padStart, …).
// The geometry helpers take plain rects, so they are unit-tested in Node.

export const PAGE_LIB = {
  // A rect clipped by each ancestor rect that clips its overflow.
  clipRect(rect, clips) {
    let left = rect.left;
    let right = rect.right;
    let top = rect.top;
    let bottom = rect.bottom;
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      if (c.x) { left = Math.max(left, c.left); right = Math.min(right, c.right); }
      if (c.y) { top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom); }
    }
    return { left: left, right: right, top: top, bottom: bottom,
      width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  },

  // How far a visible rect reaches past the viewport's left or right edge.
  horizontalExcess(rect, viewportWidth) {
    if (rect.width <= 0 || rect.height <= 0) return 0;
    return Math.max(0, -rect.left, rect.right - viewportWidth);
  },

  // Whether `inner` sits inside `outer`, give or take `slack` px (a focus
  // scale or ring reaches a little past the box it grows from).
  within(inner, outer, slack) {
    return inner.left >= outer.left - slack && inner.right <= outer.right + slack
      && inner.top >= outer.top - slack && inner.bottom <= outer.bottom + slack;
  },

  rect(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  },

  describe(el) {
    if (!el || !el.tagName) return String(el);
    const key = el.getAttribute('data-key') || el.getAttribute('data-settings-target') || '';
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls + (key ? '[' + key + ']' : '');
  },

  // Whether a name element's text overflows its box, and whether its first
  // character still lies inside it (a right-to-left layout once clipped the
  // start of a long Latin name).
  nameStart(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    let first = null;
    while (!first && walker.nextNode()) {
      if (/\S/.test(walker.currentNode.data)) first = walker.currentNode;
    }
    const overflows = el.scrollWidth > el.clientWidth + 1;
    if (!first) return { element: this.describe(el), overflows: overflows, startInside: true };
    const offset = first.data.search(/\S/);
    const range = document.createRange();
    range.setStart(first, offset);
    range.setEnd(first, offset + 1);
    const glyph = range.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { element: this.describe(el), overflows: overflows,
      startInside: glyph.left >= box.left - 1 && glyph.right <= box.right + 1 };
  },

  shown(el) {
    if (!el || !el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    return getComputedStyle(el).visibility !== 'hidden';
  },

  visibleViews() {
    const out = [];
    const views = document.querySelectorAll('body > .view');
    for (let i = 0; i < views.length; i++) {
      if (!views[i].classList.contains('hidden') && this.shown(views[i])) out.push(views[i].id);
    }
    return out;
  },

  focused() {
    const lit = Array.prototype.slice.call(document.querySelectorAll('.focused')).filter(el => this.shown(el));
    return lit.filter(el => !lit.some(other => other !== el && el.contains(other)));
  },

  // The rings on screen as e2e/helpers.ts audits them: the outermost visible
  // `.focused` elements, plus a text box holding the caret.
  rings() {
    const keyboard = document.documentElement.classList.contains('keyboard-nav');
    const owner = document.querySelector('[data-ring-owner]');
    const hoverLit = el => !keyboard && !!owner && !owner.contains(el)
      && owner.getAttribute('data-ring-owner') !== 'modal' && !!el.closest('[data-ring-hover]');
    const rings = this.focused().filter(el => !hoverLit(el));
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && this.shown(active)
      && !rings.some(el => el.contains(active))) rings.push(active);
    return rings;
  },

  // Nearest ancestor that scrolls on either axis, or null.
  scroller(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/auto|scroll/.test(s.overflowY + ' ' + s.overflowX)) return p;
    }
    return null;
  },

  // Elements inside `root` whose visible part reaches past the viewport
  // sideways. An ancestor below `root` that clips (a rail, a scroller) hides
  // what it scrolls; `root` itself does not count, so content cut off at the
  // screen edge is reported.
  overflowing(root, limit) {
    const vw = window.innerWidth;
    const clipCache = typeof Map === 'function' ? new Map() : null;
    const styleOf = el => {
      if (clipCache && clipCache.has(el)) return clipCache.get(el);
      const s = getComputedStyle(el);
      const info = {
        hidden: s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0,
        x: s.overflowX !== 'visible', y: s.overflowY !== 'visible', fixed: s.position === 'fixed',
      };
      if (clipCache) clipCache.set(el, info);
      return info;
    };
    const offenders = [];
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length && offenders.length < limit; i++) {
      const el = all[i];
      if (!el.getClientRects().length) continue;
      const own = this.rect(el);
      if (own.width === 0 || own.height === 0) continue;
      if (own.left >= -0.5 && own.right <= vw + 0.5) continue;
      const clips = [];
      let hidden = styleOf(el).hidden;
      for (let p = el.parentElement; p && p !== root && !hidden; p = p.parentElement) {
        const ps = styleOf(p);
        if (ps.hidden) hidden = true;
        else if (ps.x || ps.y) {
          const r = this.rect(p);
          clips.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, x: ps.x, y: ps.y });
        }
      }
      if (hidden) continue;
      const seen = this.clipRect(own, clips);
      const excess = this.horizontalExcess(seen, vw);
      // An inner element of an offender is not news.
      if (excess > 1 && !offenders.some(o => o.el.contains(el))) {
        offenders.push({ el: el, excess: Math.round(excess), left: Math.round(seen.left), right: Math.round(seen.right) });
      }
    }
    return offenders.map(o => ({ element: this.describe(o.el), excess: o.excess, left: o.left, right: o.right }));
  },

  // Elements in `root` (itself included) scrolled off their start, other
  // than the ones expected to scroll.
  scrolled(root, expected) {
    const out = [];
    const all = [root].concat(Array.prototype.slice.call(root.getElementsByTagName('*')));
    for (let i = 0; i < all.length && out.length < 5; i++) {
      const el = all[i];
      if (!el.scrollTop && !el.scrollLeft) continue;
      if (expected.some(sel => el.matches(sel))) continue;
      out.push(this.describe(el) + ' (' + el.scrollLeft + ',' + el.scrollTop + ')');
    }
    return out;
  },

  // One read of everything a screen check asserts.
  audit(opts) {
    const root = opts.root ? document.querySelector(opts.root) : null;
    const doc = document.scrollingElement || document.documentElement;
    const owners = Array.prototype.slice.call(document.querySelectorAll('[data-ring-owner]'));
    const rings = this.rings();
    const out = {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      views: this.visibleViews(),
      keyboard: document.documentElement.classList.contains('keyboard-nav'),
      document: {
        scrollTop: doc.scrollTop, scrollLeft: doc.scrollLeft,
        scrollWidth: doc.scrollWidth, bodyScrollTop: document.body.scrollTop, bodyScrollLeft: document.body.scrollLeft,
      },
      root: null,
      owners: owners.map(el => this.describe(el) + '=' + el.getAttribute('data-ring-owner')),
      rings: rings.map(el => this.describe(el)),
      focus: null,
      overflow: [],
      scrollers: [],
    };
    if (root) {
      out.root = {
        found: true, shown: this.shown(root), scrollTop: root.scrollTop, scrollLeft: root.scrollLeft,
        scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, rect: this.rect(root),
      };
      out.overflow = this.overflowing(root, 8);
      if (opts.walk) out.scrolled = this.scrolled(root, opts.scrollers || []);
    } else if (opts.root) {
      out.root = { found: false };
    }
    if (opts.scrollers) {
      for (let i = 0; i < opts.scrollers.length; i++) {
        const sel = opts.scrollers[i];
        const el = document.querySelector(sel);
        out.scrollers.push(el ? {
          selector: sel, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
          rect: this.rect(el),
        } : { selector: sel, missing: true });
      }
    }
    if (opts.header) {
      const h = document.querySelector(opts.header);
      out.header = h ? this.rect(h) : null;
    }
    const ring = rings[0];
    if (ring) {
      const r = this.rect(ring);
      const sc = this.scroller(ring);
      const vp = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      out.focus = {
        element: this.describe(ring), rect: r,
        inViewport: this.within(r, vp, opts.slack),
        scroller: sc ? this.describe(sc) : null,
        inScroller: sc ? this.within(r, this.rect(sc), opts.slack) : true,
      };
    }
    return out;
  },

  // Where D-pad steering should go next: the target's center against the
  // focused element's, on the axis that is further off.
  steer(selector) {
    const target = document.querySelector(selector);
    if (!target) return { error: 'no element ' + selector };
    const ring = this.focused()[0];
    if (!ring) return { error: 'nothing focused' };
    if (ring === target || target.contains(ring) || ring.contains(target)) return { done: true };
    const a = this.rect(ring);
    const b = this.rect(target);
    const dx = (b.left + b.right) / 2 - (a.left + a.right) / 2;
    const dy = (b.top + b.bottom) / 2 - (a.top + a.bottom) / 2;
    const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    let axis;
    if (overlapY > 0 && overlapX <= 0) axis = 'x';
    else if (overlapX > 0 && overlapY <= 0) axis = 'y';
    else axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    const dir = axis === 'x' ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    return { done: false, dir: dir, alt: axis === 'x' ? (dy > 0 ? 'down' : 'up') : (dx > 0 ? 'right' : 'left'),
      from: this.describe(ring) };
  },
};

/** The library as an expression the page can evaluate. */
export function pageLibSource(lib = PAGE_LIB) {
  const members = Object.keys(lib).map(name => {
    const src = lib[name].toString();
    return src.startsWith(`${name}(`) ? src : `${JSON.stringify(name)}: ${src}`;
  });
  return `({\n${members.join(',\n')}\n})`;
}

/**
 * A page expression calling `body` (a function source taking the library and
 * the JSON-safe args) that always returns a JSON string: old engines surface
 * thrown errors inconsistently over CDP, so the page reports them itself.
 */
export function pageCall(body, args = []) {
  return `(function () {
  try {
    var lib = ${pageLibSource()};
    var value = (${body}).apply(null, [lib].concat(${JSON.stringify(args)}));
    return JSON.stringify({ ok: true, value: value === undefined ? null : value });
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e && e.stack || e) });
  }
})()`;
}
