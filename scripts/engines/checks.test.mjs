import { describe, expect, it } from 'vitest';
import { CHECKS, judgeScreen, judgeWalk, PROFILES, seedEntries, unexpectedErrors } from './checks.mjs';
import { harnessScript, injectHarness, smokePlaylist } from './fixtures.mjs';
import { createCatalog } from '../xtream-demo/catalog.mjs';

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

// An audit of a screen that passes; each test spoils one part of it.
function audit(over = {}) {
  return {
    viewport: { width: 1920, height: 1080 },
    views: ['view-settings'],
    document: { scrollTop: 0, scrollLeft: 0, scrollWidth: 1920, bodyScrollTop: 0, bodyScrollLeft: 0 },
    root: { found: true, shown: true, scrollTop: 0, scrollLeft: 0 },
    owners: ['div#view-settings.view='],
    rings: ['button.btn.focused'],
    focus: { element: 'button.btn.focused', rect: rect(436, 500, 300, 78), inViewport: true,
      scroller: 'div.settings-scroll', inScroller: true },
    overflow: [],
    scrollers: [{ selector: '.settings-scroll', scrollTop: 0, scrollHeight: 2000, clientHeight: 900 }],
    header: rect(80, 34, 1760, 53),
    dir: 'ltr',
    ...over,
  };
}

const SPEC = { view: '#view-settings', scroller: '.settings-scroll', header: '.settings-header' };

describe('judgeScreen', () => {
  it('passes a screen that fits with one ring', () => {
    expect(judgeScreen(audit(), SPEC)).toEqual([]);
  });

  it('reports sideways overflow, scrolled views and a wrong viewport', () => {
    const reasons = judgeScreen(audit({
      viewport: { width: 1920, height: 1036 },
      overflow: [{ element: 'div.row', excess: 40, left: 0, right: 1960 }],
      root: { found: true, scrollTop: 54, scrollLeft: 0 },
      document: { scrollTop: 0, scrollLeft: 12, scrollWidth: 1960, bodyScrollTop: 0, bodyScrollLeft: 0 },
    }), SPEC);
    expect(reasons).toEqual([
      'viewport is 1920x1036, not 1920x1080',
      'content reaches past the screen sideways: div.row (40px, 0..1960)',
      'the document scrolled to 12,0',
      'the document is 1960px wide',
      '#view-settings scrolled to 0,54',
    ]);
  });

  it('wants exactly one ring and owner, unless the screen has none', () => {
    expect(judgeScreen(audit({ rings: ['a.focused', 'b.focused'] }), SPEC))
      .toEqual(['2 focus rings: a.focused, b.focused']);
    expect(judgeScreen(audit({ owners: [] }), SPEC)).toEqual(['0 focus owners: ']);
    expect(judgeScreen(audit({ rings: [], focus: null }), { ...SPEC, ring: 'none' })).toEqual([]);
    expect(judgeScreen(audit(), { ...SPEC, ring: 'none' }))
      .toEqual(['a focus ring shows on a screen without one: button.btn.focused']);
  });

  it('wants the focused element on screen and inside its scroller', () => {
    const focus = { ...audit().focus, inViewport: false, inScroller: false };
    expect(judgeScreen(audit({ focus }), SPEC)).toEqual([
      'the focused button.btn.focused is off screen (436,500 300x78)',
      'the focused button.btn.focused is outside its scroller div.settings-scroll (436,500 300x78)',
    ]);
  });

  it('checks the view shows, the direction and the size attributes', () => {
    expect(judgeScreen(audit({ views: ['view-home'] }), SPEC))
      .toEqual(['#view-settings is not shown (shown: view-home)']);
    expect(judgeScreen(audit(), { ...SPEC, dir: 'rtl' })).toEqual(['the page direction is "ltr", not "rtl"']);
    expect(judgeScreen(audit({ htmlData: { 'text-size': '100' } }), { ...SPEC, htmlData: { 'text-size': '150' } }))
      .toEqual(['<html data-text-size> is "100", not "150"']);
  });

  it('wants a truncated name to keep its start in view', () => {
    const spec = { ...SPEC, names: ['.channel-name'] };
    const name = (overflows, startInside) => ({ element: 'div.channel-name', overflows, startInside });
    expect(judgeScreen(audit({ names: [name(true, true), name(false, true)] }), spec)).toEqual([]);
    expect(judgeScreen(audit({ names: [name(true, false)] }), spec))
      .toEqual(['div.channel-name clips the start of its name']);
    expect(judgeScreen(audit({ names: [name(false, true)] }), spec))
      .toEqual(['no truncated name in .channel-name to check']);
  });
});

describe('judgeWalk', () => {
  const step = (scrollTop, headerTop = 34, over = {}) => audit({
    scrollers: [{ selector: '.settings-scroll', scrollTop, scrollHeight: 2000, clientHeight: 900 }],
    header: rect(80, headerTop, 1760, 53),
    ...over,
  });

  it('passes a walk that scrolls the pane and nothing else', () => {
    expect(judgeWalk([step(0), step(0), step(120), step(300)], { ...SPEC, key: 'down' })).toEqual([]);
  });

  // The Chromium 69 Settings bug: the pane grew to its content, so the view
  // scrolled, header and all, instead of the pane.
  it('catches a view that scrolls in place of its pane', () => {
    const grown = (headerTop, rootTop) => audit({
      scrollers: [{ selector: '.settings-scroll', scrollTop: 0, scrollHeight: 2208, clientHeight: 2208 }],
      header: rect(80, headerTop, 1760, 53),
      root: { found: true, scrollTop: rootTop, scrollLeft: 0 },
      scrolled: rootTop ? [`div.settings-view (0,${rootTop})`] : [],
    });
    expect(judgeWalk([grown(34, 0), grown(34, 0), grown(-20, 54), grown(-80, 114)], { ...SPEC, key: 'down' })).toEqual([
      'after down 2: #view-settings scrolled to 0,54',
      'after down 2: the header moved from y=34 to y=-20; scrolled instead: div.settings-view (0,54)',
      '.settings-scroll has nothing to scroll (scrollHeight 2208, clientHeight 2208)',
    ]);
  });

  it('reports a pane that never scrolls', () => {
    expect(judgeWalk([step(0), step(0)], { ...SPEC, key: 'down' }))
      .toEqual(['.settings-scroll never scrolled (scrollTop 0 -> 0)']);
  });
});

describe('seeding and errors', () => {
  const origins = { appOrigin: 'http://host:1', xtreamOrigin: 'http://host:2' };

  it('seeds both sources and the profile, JSON-encoded', () => {
    const entries = seedEntries('rtl', origins);
    expect(JSON.parse(entries.iptv_playlists).map(p => p.source)).toEqual(['url', 'xtream']);
    expect(entries.iptv_locale).toBe('"ar"');
    expect(entries.iptv_direction).toBe('"rtl"');
    expect(seedEntries('large', origins).iptv_text_size).toBe('"150"');
    expect(seedEntries('default', origins).iptv_locale).toBeUndefined();
  });

  it('runs every check under a known profile', () => {
    for (const check of CHECKS) expect(PROFILES[check.profile], check.id).toBeDefined();
    expect(new Set(CHECKS.map(c => c.id)).size).toBe(CHECKS.length);
  });

  it('allows only the media rejections the suite causes', () => {
    const errors = [
      { message: 'Unhandled rejection: The play() request was interrupted by a call to pause().' },
      { message: 'Uncaught TypeError: x is not a function' },
    ];
    expect(unexpectedErrors(errors)).toEqual([errors[1]]);
  });
});

describe('fixtures', () => {
  it('lists the live channels with logos and the portal guide', () => {
    const catalog = createCatalog('smoke');
    const text = smokePlaylist(catalog, 'http://host:2', 'http://host:1');
    expect(text.split('\n')[0]).toBe('#EXTM3U url-tvg="http://host:2/xmltv.php?username=demo&password=demo"');
    expect(text.match(/#EXTINF/g)).toHaveLength(catalog.channels.length);
    expect(text).toContain('tvg-logo="http://host:2/demo-assets/logo/1.svg"');
    expect(text).toContain('http://host:1/__engines/live/1.m3u8');
  });

  it('loads the harness first and stubs Tizen only for the Tizen build', () => {
    expect(injectHarness('<html><head><title>x</title>')).toBe(
      '<html><head>\n  <script src="/__engines/harness.js"></script><title>x</title>');
    expect(harnessScript({ tizen: false })).not.toContain('window.tizen');
    expect(harnessScript({ tizen: true })).toContain('window.tizen');
  });
});
