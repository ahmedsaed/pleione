// The engine smoke checks: app navigation helpers, the pure judges that turn
// a page audit into failure reasons, and the declarative CHECKS list. To add a
// screen, add a `screen({...})` entry: how to get there (`go`), its view root,
// and anything it scrolls.

import { BLANK_PATH, PLAYLIST_PATH, XTREAM_PASS, XTREAM_USER } from './fixtures.mjs';

// localStorage seeds (`iptv_` + key, JSON-encoded as StorageService writes them).
export const PROFILES = {
  default: {},
  rtl: { locale: 'ar', direction: 'rtl' },
  // The largest text and Interface sizes (TEXT_SIZES, INTERFACE_SIZES).
  large: { text_size: '150', interface_size: '130' },
};

export function seedEntries(profile, { appOrigin, xtreamOrigin }) {
  return {
    iptv_playlists: JSON.stringify([
      { id: 'm1', name: 'Alpha', url: appOrigin + PLAYLIST_PATH, source: 'url' },
      { id: 'x1', name: 'Bravo', url: xtreamOrigin, source: 'xtream',
        xtream: { username: XTREAM_USER, password: XTREAM_PASS } },
    ]),
    // Samsung builds ask before storing a source; agreed, as on a set-up TV.
    iptv_privacy_consent: 'true',
    iptv_time_format: '"24h"',
    ...Object.fromEntries(Object.entries(PROFILES[profile]).map(([k, v]) => [`iptv_${k}`, JSON.stringify(v)])),
  };
}

// Uncaught errors the suite causes itself: its streams carry no media, so a
// media element's play() promise rejects when the app moves on or retries.
export const ERROR_ALLOWLIST = [
  /play\(\) request was interrupted/,
  /no supported sources?/i,
  /play\(\) failed because the user didn't interact/,
];

export const unexpectedErrors = errors => errors.filter(e => !ERROR_ALLOWLIST.some(re => re.test(e.message)));

// --- judges (pure) -----------------------------------------------------------

const VIEWPORT = { width: 1920, height: 1080 };

/** Failure reasons for one audit of a screen; empty when it passes. */
export function judgeScreen(audit, spec = {}) {
  const reasons = [];
  const { viewport } = audit;
  if (viewport.width !== VIEWPORT.width || viewport.height !== VIEWPORT.height) {
    reasons.push(`viewport is ${viewport.width}x${viewport.height}, not 1920x1080`);
  }
  if (spec.view && !audit.views.includes(spec.view.replace(/^#/, ''))) {
    reasons.push(`${spec.view} is not shown (shown: ${audit.views.join(', ') || 'none'})`);
  }
  if (spec.view && audit.root && !audit.root.found) reasons.push(`${spec.view} is missing`);
  if (audit.overflow.length) {
    reasons.push(`content reaches past the screen sideways: ${audit.overflow
      .map(o => `${o.element} (${o.excess}px, ${o.left}..${o.right})`).join('; ')}`);
  }
  const d = audit.document;
  if (d.scrollTop || d.scrollLeft || d.bodyScrollTop || d.bodyScrollLeft) {
    reasons.push(`the document scrolled to ${d.scrollLeft || d.bodyScrollLeft},${d.scrollTop || d.bodyScrollTop}`);
  }
  if (d.scrollWidth > VIEWPORT.width + 1) reasons.push(`the document is ${d.scrollWidth}px wide`);
  if (audit.root?.found && (audit.root.scrollTop || audit.root.scrollLeft)) {
    reasons.push(`${spec.view} scrolled to ${audit.root.scrollLeft},${audit.root.scrollTop}`);
  }
  const ring = spec.ring ?? 'one';
  if (ring === 'one') {
    if (audit.owners.length !== 1) reasons.push(`${audit.owners.length} focus owners: ${audit.owners.join(', ')}`);
    if (audit.rings.length !== 1) reasons.push(`${audit.rings.length} focus rings: ${audit.rings.join(', ') || 'none'}`);
  } else if (ring === 'none') {
    if (audit.owners.length > 1) reasons.push(`${audit.owners.length} focus owners: ${audit.owners.join(', ')}`);
    if (audit.rings.length) reasons.push(`a focus ring shows on a screen without one: ${audit.rings.join(', ')}`);
  }
  if (spec.ringIn && audit.focus && !audit.focus.element.includes(spec.ringIn) && !audit.ringInside) {
    reasons.push(`the ring is on ${audit.focus.element}, not in ${spec.ringIn}`);
  }
  if (audit.focus && !audit.focus.inViewport) {
    reasons.push(`the focused ${audit.focus.element} is off screen (${rectText(audit.focus.rect)})`);
  }
  if (audit.focus && !audit.focus.inScroller) {
    reasons.push(`the focused ${audit.focus.element} is outside its scroller ${audit.focus.scroller} (${rectText(audit.focus.rect)})`);
  }
  if (spec.dir && audit.dir !== spec.dir) reasons.push(`the page direction is "${audit.dir}", not "${spec.dir}"`);
  for (const [attr, value] of Object.entries(spec.htmlData ?? {})) {
    if (audit.htmlData?.[attr] !== value) reasons.push(`<html data-${attr}> is "${audit.htmlData?.[attr]}", not "${value}"`);
  }
  if (spec.names?.length) {
    const truncated = (audit.names ?? []).filter(n => n.overflows);
    if (!truncated.length) reasons.push(`no truncated name in ${spec.names.join(', ')} to check`);
    for (const n of truncated) {
      if (!n.startInside) reasons.push(`${n.element} clips the start of its name`);
    }
  }
  for (const s of audit.shownChecks ?? []) {
    if (!s.shown) reasons.push(`${s.selector} is not shown`);
    else if (!s.inViewport) reasons.push(`${s.selector} is off screen (${rectText(s.rect)})`);
  }
  return reasons;
}

/**
 * Failure reasons for a walk down a scrolling screen: every step must keep
 * the view and header still and the focus visible, and the walk must scroll
 * `scroller` itself.
 */
export function judgeWalk(steps, spec) {
  const reasons = [];
  const first = steps[0];
  const headerTop = first.header?.top;
  steps.forEach((audit, i) => {
    const label = i === 0 ? 'before the walk' : `after ${spec.key} ${i}`;
    const screen = judgeScreen(audit, spec);
    if (screen.length) reasons.push(`${label}: ${screen.join('; ')}`);
    if (headerTop !== undefined && audit.header && Math.abs(audit.header.top - headerTop) > 1) {
      const instead = audit.scrolled?.length ? `; scrolled instead: ${audit.scrolled.join(', ')}` : '';
      reasons.push(`${label}: the header moved from y=${Math.round(headerTop)} to y=${Math.round(audit.header.top)}${instead}`);
    }
  });
  const start = first.scrollers[0];
  const end = steps[steps.length - 1].scrollers[0];
  if (!start || start.missing) {
    reasons.push(`no ${spec.scroller} to scroll`);
  } else if (start.scrollHeight <= start.clientHeight + 1) {
    reasons.push(`${spec.scroller} has nothing to scroll (scrollHeight ${start.scrollHeight}, clientHeight ${start.clientHeight})`);
  } else if (!(end.scrollTop > start.scrollTop)) {
    reasons.push(`${spec.scroller} never scrolled (scrollTop ${start.scrollTop} -> ${end.scrollTop})`);
  }
  // Report each kind of failure once, at its first step.
  const seen = new Set();
  return reasons.filter(r => {
    const kind = r.replace(/^[^:]*: /, '').replace(/-?\d+(\.\d+)?/g, '#');
    if (seen.has(kind)) return false;
    seen.add(kind);
    return true;
  });
}

const rectText = r => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;

// --- app navigation ------------------------------------------------------------

const VIEW_OF = {
  live: '#view-channels', movies: '#view-movies', series: '#view-series',
  search: '#view-search', settings: '#view-settings',
};

export class App {
  constructor(page, fixtures) {
    this.page = page;
    this.fixtures = fixtures;
  }

  /** Seed `profile` on a blank same-origin page, then launch the app to Home. */
  async boot(profile) {
    const { page, fixtures } = this;
    await page.navigate(fixtures.appOrigin + BLANK_PATH);
    await page.run((lib, entries) => {
      localStorage.clear();
      Object.keys(entries).forEach(k => localStorage.setItem(k, entries[k]));
      return true;
    }, seedEntries(profile, fixtures));
    await page.navigate(`${fixtures.appOrigin}/`);
    await this.waitHome(45000);
  }

  waitHome(timeout = 15000) {
    return this.page.waitFor('Home with a focused card', lib => {
      const home = document.getElementById('view-home');
      const loading = document.getElementById('view-loading');
      return lib.shown(home) && !lib.shown(loading) && !!home.querySelector('.focused');
    }, [], { timeout });
  }

  shown(selector) {
    return this.page.run((lib, sel) => lib.shown(document.querySelector(sel)), selector);
  }

  waitShown(selector, timeout) {
    return this.page.waitFor(`${selector} to show`, (lib, sel) => lib.shown(document.querySelector(sel)),
      [selector], { timeout });
  }

  waitHidden(selector, timeout) {
    return this.page.waitFor(`${selector} to hide`, (lib, sel) => !lib.shown(document.querySelector(sel)),
      [selector], { timeout });
  }

  /** Back until Home shows, as a viewer would. */
  async goHome() {
    for (let i = 0; i < 8 && !(await this.shown('#view-home')); i++) {
      // A text box holds Back for itself first; the remote's Back still leaves it.
      await this.page.press('back');
    }
    await this.waitHome();
  }

  /** The focused element's description, or ''. */
  focusedName() {
    return this.page.run(lib => { const f = lib.focused()[0]; return f ? lib.describe(f) : ''; });
  }

  /** Move the D-pad focus onto `selector`, steering by geometry. */
  async steer(selector, maxSteps = 24) {
    for (let i = 0; i < maxSteps; i++) {
      const s = await this.page.run((lib, sel) => lib.steer(sel), selector);
      if (s.error) throw new Error(`cannot steer to ${selector}: ${s.error}`);
      if (s.done) return;
      await this.page.press(s.dir);
      if ((await this.focusedName()) === s.from) await this.page.press(s.alt);
    }
    throw new Error(`could not reach ${selector} in ${maxSteps} key presses (at ${await this.focusedName()})`);
  }

  /** Press `key` until the focused element matches `selector`. */
  async pressUntil(key, selector, max = 20) {
    for (let i = 0; i <= max; i++) {
      const hit = await this.page.run((lib, sel) => lib.focused().some(el => el.matches(sel) || !!el.closest(sel)), selector);
      if (hit) return;
      if (i < max) await this.page.press(key);
    }
    throw new Error(`${key} x${max} never focused ${selector} (at ${await this.focusedName()})`);
  }

  async openSection(name) {
    await this.goHome();
    await this.steer(`#view-home [data-key="section:${name}"]`);
    await this.page.press('enter');
    await this.waitShown(VIEW_OF[name], 15000);
    if (name === 'live') await this.waitLive();
    if (name === 'movies' || name === 'series') await this.waitCatalog(VIEW_OF[name], 'browse');
  }

  /** Wait for Live's channels, back in the list if the Guide was left open,
   *  with the focus on a channel row. */
  async waitLive() {
    await this.page.waitFor('Live channels', lib => {
      const live = document.getElementById('view-channels');
      return !live.classList.contains('live-loading') && !!live.querySelector('.focused');
    }, [], { timeout: 30000 });
    if (await this.page.run(() => document.getElementById('view-channels').classList.contains('live-guide-mode'))) {
      await this.page.press('red');
      await this.page.waitFor('the channel list', () =>
        !document.getElementById('view-channels').classList.contains('live-guide-mode'));
    }
    await this.pressUntil('right', '#view-channels .live-row', 3);
  }

  waitCatalog(view, layer) {
    return this.page.waitFor(`${view} ${layer} focus`, (lib, v, l) => {
      const host = document.querySelector(`${v} .catalog-layer-${l}`);
      return !!host && lib.shown(host) && !!host.querySelector('.focused');
    }, [view, layer], { timeout: 30000 });
  }

  async openSettingsPage(id) {
    if (!(await this.shown('#view-settings'))) await this.openSection('settings');
    // The sidebar owns the keys when Settings opens; Left returns there from a page.
    if (!(await this.page.run(lib => lib.focused().some(el => el.classList.contains('settings-nav-item'))))) {
      await this.pressUntil('left', '.settings-nav-item', 4);
    }
    await this.steer(`.settings-nav-item[data-settings-target="${id}"]`);
    await this.page.waitFor(`settings page ${id}`, (lib, i) => {
      const page = document.querySelector('.settings-category.active');
      return !!page && page.getAttribute('data-settings-category') === i;
    }, [id]);
  }

  audit(spec) {
    return this.page.run((lib, opts) => {
      const out = lib.audit(opts);
      out.dir = document.documentElement.dir || 'ltr';
      out.htmlData = { 'text-size': document.documentElement.getAttribute('data-text-size'),
        'interface-size': document.documentElement.getAttribute('data-interface-size') };
      out.shownChecks = (opts.visible || []).map(sel => {
        const el = document.querySelector(sel);
        const shown = lib.shown(el);
        const r = shown ? lib.rect(el) : null;
        return { selector: sel, shown: shown, rect: r,
          inViewport: !!r && lib.within(r, { left: 0, top: 0, right: innerWidth, bottom: innerHeight }, 1) };
      });
      out.names = [];
      (opts.names || []).forEach(sel => {
        Array.prototype.forEach.call(document.querySelectorAll(sel), el => {
          if (lib.shown(el)) out.names.push(lib.nameStart(el));
        });
      });
      if (opts.ringIn) out.ringInside = lib.rings().some(el => !!el.closest(opts.ringIn));
      return out;
    }, {
      root: spec.view, scrollers: spec.scroller ? [spec.scroller] : [], header: spec.header,
      slack: spec.slack ?? 12, visible: spec.visible ?? [], ringIn: spec.ringIn, walk: !!spec.walk,
      names: spec.names ?? [],
    });
  }
}

// --- the checks ------------------------------------------------------------------

/** A screen check: get there with `go`, then audit it once. */
export function screen({ id, title, profile = 'default', go, ...spec }) {
  return {
    id, title, profile,
    async run(app) {
      await go(app);
      const audit = await app.audit(spec);
      return { reasons: judgeScreen(audit, spec), details: audit };
    },
  };
}

/** A scroll check: get there with `go`, then press `key` `steps` times. */
export function walk({ id, title, profile = 'default', go, key = 'down', steps = 15, ...spec }) {
  return {
    id, title, profile,
    async run(app) {
      await go(app);
      const audits = [await app.audit({ ...spec, walk: true })];
      for (let i = 0; i < steps; i++) {
        await app.page.press(key);
        audits.push(await app.audit({ ...spec, walk: true }));
      }
      const last = audits[audits.length - 1];
      return {
        reasons: judgeWalk(audits, { ...spec, key }),
        details: {
          scroller: { from: audits[0].scrollers[0], to: last.scrollers[0] },
          header: { from: audits[0].header, to: last.header },
          root: last.root, document: last.document, focus: last.focus,
        },
      };
    },
  };
}

const PROFILES_DATA = { 'text-size': PROFILES.large.text_size, 'interface-size': PROFILES.large.interface_size };

const SETTINGS_PAGES = ['general', 'sources', 'guide', 'appearance', 'subtitles', 'advanced', 'data'];

const LIVE = { view: '#view-channels', scroller: '.channel-main', header: '.live-header' };
const SETTINGS = { view: '#view-settings', scroller: '.settings-scroll', header: '.settings-header' };

async function openCatalogGrid(app, view) {
  await app.openSection(view.slice('#view-'.length));
  await app.pressUntil('right', `${view} .catalog-layer-browse [data-key^="all:"]`, 20);
  await app.page.press('enter');
  await app.waitCatalog(view, 'grid');
}

async function openCatalogDetail(app, view) {
  await openCatalogGrid(app, view);
  await app.page.press('enter');
  await app.waitCatalog(view, 'detail');
}

export const CHECKS = [
  screen({ id: 'home', title: 'Home', go: app => app.goHome(), view: '#view-home' }),
  screen({ id: 'live', title: 'Live: channel list and preview', go: app => app.openSection('live'),
    view: '#view-channels', visible: ['.channel-main'] }),
  walk({ id: 'live-walk', title: 'Live: walk down the channel list', go: app => app.openSection('live'),
    ...LIVE, steps: 20 }),
  screen({ id: 'guide', title: 'Guide', go: async app => {
    await app.openSection('live');
    await app.page.press('red');
    await app.page.waitFor('the guide grid', () =>
      !!document.querySelector('#view-channels.live-guide-mode #live-guide .guide-cell.focused'), [], { timeout: 20000 });
  }, view: '#view-channels', visible: ['#live-guide'] }),
  screen({ id: 'player', title: 'Player: live channel OSD', go: async app => {
    await app.openSection('live');
    await app.page.press('down', 2);
    await app.page.press('enter');
    await app.waitShown('#view-player');
    await app.waitShown('#player-osd');
  }, view: '#view-player', ring: 'none', visible: ['#player-osd'] }),
  screen({ id: 'movies', title: 'Movies: rails', go: app => app.openSection('movies'), view: '#view-movies' }),
  screen({ id: 'movies-grid', title: 'Movies: See all grid', go: app => openCatalogGrid(app, '#view-movies'),
    view: '#view-movies' }),
  screen({ id: 'movie-detail', title: 'Movies: detail', go: app => openCatalogDetail(app, '#view-movies'),
    view: '#view-movies' }),
  screen({ id: 'series', title: 'Series: rails', go: app => app.openSection('series'), view: '#view-series' }),
  screen({ id: 'series-grid', title: 'Series: See all grid', go: app => openCatalogGrid(app, '#view-series'),
    view: '#view-series' }),
  screen({ id: 'series-detail', title: 'Series: detail', go: app => openCatalogDetail(app, '#view-series'),
    view: '#view-series' }),
  screen({ id: 'search', title: 'Search: results for a typed query', go: async app => {
    await app.openSection('search');
    await app.page.waitFor('the search box', () => document.activeElement
      && document.activeElement.classList.contains('search-box-input'));
    await app.page.type('Movie');
    await app.page.waitFor('search results', () =>
      !!document.querySelector('#view-search .search-results-host .catalog-tile'), [], { timeout: 20000 });
    await app.pressUntil('down', '#view-search .search-results-host', 4);
  }, view: '#view-search', ringIn: '.search-results-host' }),
  ...SETTINGS_PAGES.map(page => screen({
    id: `settings-${page}`, title: `Settings: ${page}`, go: app => app.openSettingsPage(page),
    view: '#view-settings', header: '.settings-header',
  })),
  walk({ id: 'settings-sources-walk', title: 'Settings: walk down Sources', go: async app => {
    await app.openSettingsPage('sources');
    await app.page.press('right');
  }, ...SETTINGS, steps: 18 }),
  walk({ id: 'settings-advanced-walk', title: 'Settings: walk down Advanced', go: async app => {
    await app.openSettingsPage('advanced');
    await app.page.press('right');
  }, ...SETTINGS, steps: 12 }),
  {
    id: 'confirm-prompt', title: 'Confirmation prompt: open, then cancel with Back', profile: 'default',
    async run(app) {
      await app.openSettingsPage('data');
      await app.page.press('right');
      await app.steer('#clear-recently-watched');
      await app.page.press('enter');
      await app.waitShown('.confirmation-prompt:not(.hidden)');
      const spec = { view: '#view-settings', ringIn: '.confirmation-prompt', visible: ['.confirmation-prompt:not(.hidden)'] };
      const audit = await app.audit(spec);
      const reasons = judgeScreen(audit, spec);
      await app.page.press('back');
      await app.waitHidden('.confirmation-prompt:not(.hidden)');
      const after = await app.audit({ view: '#view-settings' });
      if (!after.focus?.element.includes('clear-recently-watched')) {
        reasons.push(`after Back the ring is on ${after.focus?.element ?? 'nothing'}, not the button that opened the prompt`);
      }
      return { reasons, details: { prompt: audit, after } };
    },
  },
  screen({ id: 'rtl-home', title: 'Arabic (RTL): Home', profile: 'rtl', go: app => app.goHome(),
    view: '#view-home', dir: 'rtl' }),
  screen({ id: 'rtl-settings', title: 'Arabic (RTL): Settings', profile: 'rtl',
    go: app => app.openSettingsPage('sources'), view: '#view-settings', dir: 'rtl' }),
  // Channel 4's long Latin name keeps its start in view, truncated at its end.
  screen({ id: 'rtl-live', title: 'Arabic (RTL): Live, a long Latin name', profile: 'rtl',
    go: app => app.openSection('live'), view: '#view-channels', dir: 'rtl',
    names: ['#view-channels .channel-main .channel-name'] }),
  screen({ id: 'large-home', title: 'Largest text and Interface size: Home', profile: 'large',
    go: app => app.goHome(), view: '#view-home', htmlData: PROFILES_DATA }),
  screen({ id: 'large-live', title: 'Largest text and Interface size: Live', profile: 'large',
    go: app => app.openSection('live'), view: '#view-channels', htmlData: PROFILES_DATA }),
];
