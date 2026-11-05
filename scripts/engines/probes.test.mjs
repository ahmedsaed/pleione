import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';
import { PAGE_LIB, pageCall, pageLibSource } from './probes.mjs';

const lib = PAGE_LIB;
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

describe('page library syntax', () => {
  // Chromium 53 parses ES2015 (plus exponentiation, which nothing here uses);
  // ES2017 syntax such as a trailing comma in a call would fail the whole page script.
  it('parses as ES2015', () => {
    expect(() => parse(pageLibSource(), { ecmaVersion: 2015 })).not.toThrow();
    expect(() => parse(pageCall('function (lib, a) { return lib.rect(a); }', [1]), { ecmaVersion: 2015 }))
      .not.toThrow();
  });

  // The driver and the checks hand inline functions to page.run(body, …) and
  // page.waitFor(label, body, …); each is sent to the engine as source.
  it.each(['driver.mjs', 'checks.mjs'])('sends only ES2015 bodies to the page from %s', (file) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const bodies = [];
    const visit = (node) => {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression') {
        const name = node.callee.property.name;
        const body = name === 'run' ? node.arguments[0] : name === 'waitFor' ? node.arguments[1] : null;
        if (body && /Function/.test(body.type)) bodies.push(source.slice(body.start, body.end));
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
    };
    visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
    expect(bodies.length).toBeGreaterThan(3);
    for (const body of bodies) expect(() => parse(`(${body})`, { ecmaVersion: 2015 }), body).not.toThrow();
  });
});

describe('clipRect', () => {
  it('clips only on the axes an ancestor clips', () => {
    const r = lib.clipRect(rect(1800, 100, 400, 50), [{ left: 0, right: 1900, top: 0, bottom: 80, x: true, y: false }]);
    expect(r).toMatchObject({ left: 1800, right: 1900, top: 100, bottom: 150, width: 100 });
  });

  it('leaves a rect hidden by a rail with no width', () => {
    const r = lib.clipRect(rect(2100, 260, 180, 311), [{ left: 0, right: 1920, top: 0, bottom: 1080, x: true, y: true }]);
    expect(r.width).toBe(0);
    expect(lib.horizontalExcess(r, 1920)).toBe(0);
  });
});

describe('horizontalExcess', () => {
  it('measures the reach past either side', () => {
    expect(lib.horizontalExcess(rect(1900, 0, 60, 10), 1920)).toBe(40);
    expect(lib.horizontalExcess(rect(-12, 0, 60, 10), 1920)).toBe(12);
    expect(lib.horizontalExcess(rect(0, 0, 1920, 10), 1920)).toBe(0);
  });
});

describe('within', () => {
  it('allows the slack a focus scale needs', () => {
    const outer = rect(416, 136, 656, 864);
    expect(lib.within(rect(410, 140, 600, 100), outer, 12)).toBe(true);
    expect(lib.within(rect(400, 140, 600, 100), outer, 12)).toBe(false);
  });
});
