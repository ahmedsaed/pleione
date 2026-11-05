// Drives one page of an archived Chromium over raw CDP, using only methods
// Chromium 53 already has: Runtime.evaluate, Input.dispatchKeyEvent,
// Page.navigate and Page.captureScreenshot.

import { writeFile } from 'node:fs/promises';
import { pageCall } from './probes.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Remote keys as the TV sends them: a keyCode the app reads in its keydown
// handler (CONFIG.KEYS). `back` is filled in per platform.
export const KEYS = {
  left: { code: 37, key: 'ArrowLeft' },
  up: { code: 38, key: 'ArrowUp' },
  right: { code: 39, key: 'ArrowRight' },
  down: { code: 40, key: 'ArrowDown' },
  enter: { code: 13, key: 'Enter' },
  red: { code: 403, key: 'ColorF0Red' },
};

export class EnginePage {
  constructor(client, { backKey, log = () => {} }) {
    this.client = client;
    this.keys = { ...KEYS, back: { code: backKey, key: 'GoBack' } };
    this.log = log;
    this.exceptions = [];
    client.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => {
      const text = d?.exception?.description || d?.text || 'exception';
      this.exceptions.push({ message: String(text).split('\n')[0], source: `${d?.url || ''}:${d?.lineNumber ?? ''}` });
    });
  }

  async init() {
    await this.client.call('Runtime.enable');
    await this.client.call('Page.enable');
  }

  /** Evaluate `body(lib, ...args)` in the page (see probes.pageCall). */
  async run(body, ...args) {
    const { result, exceptionDetails } = await this.client.call('Runtime.evaluate', {
      expression: pageCall(String(body), args),
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(`page evaluation failed: ${exceptionDetails.text}`);
    let parsed;
    try {
      parsed = JSON.parse(result.value);
    } catch {
      throw new Error(`page returned ${String(result.value).slice(0, 200)}`);
    }
    if (!parsed.ok) throw new Error(`page threw: ${parsed.error}`);
    return parsed.value;
  }

  /** Poll `body` until it returns something truthy; resolves with it. */
  async waitFor(label, body, args = [], { timeout = 15000, interval = 100 } = {}) {
    const end = Date.now() + timeout;
    let last;
    for (;;) {
      try {
        last = await this.run(body, ...args);
        if (last) return last;
      } catch (error) {
        last = error.message;
      }
      if (Date.now() > end) {
        throw new Error(`timed out after ${timeout} ms waiting for ${label}${last ? ` (last: ${JSON.stringify(last).slice(0, 300)})` : ''}`);
      }
      await sleep(interval);
    }
  }

  /** Two animation frames: whatever a key changed has rendered. */
  async settle() {
    await this.run(() => {
      window.__engineFrames = 0;
      requestAnimationFrame(() => requestAnimationFrame(() => { window.__engineFrames = 2; }));
      return true;
    });
    // A page with no frames (hidden, busy) still moves on after the timeout.
    await this.waitFor('two frames', () => window.__engineFrames === 2, [], { timeout: 2000, interval: 16 })
      .catch(() => {});
  }

  async press(name, times = 1) {
    const k = this.keys[name];
    if (!k) throw new Error(`unknown key ${name}`);
    for (let i = 0; i < times; i++) {
      const base = { windowsVirtualKeyCode: k.code, nativeVirtualKeyCode: k.code, key: k.key };
      await this.client.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      await this.client.call('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await this.settle();
    }
  }

  /** Type into the focused text box, one key per character. */
  async type(text) {
    for (const ch of text) {
      const code = ch.toUpperCase().charCodeAt(0);
      await this.client.call('Input.dispatchKeyEvent', {
        type: 'keyDown', text: ch, unmodifiedText: ch, key: ch, windowsVirtualKeyCode: code,
      });
      await this.client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, windowsVirtualKeyCode: code });
    }
    await this.settle();
  }

  async navigate(url) {
    await this.client.call('Page.navigate', { url });
    await this.waitFor(`load of ${url}`, (lib, u) => location.href === u && document.readyState === 'complete', [url]);
  }

  async screenshot(path) {
    const { data } = await this.client.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(path, Buffer.from(data, 'base64'));
  }

  /** Uncaught errors since the last call: the page's collector and CDP's. */
  async takeErrors() {
    let page = [];
    try {
      page = await this.run(() => {
        const list = window.__engineErrors || [];
        window.__engineErrors = [];
        return list;
      });
    } catch { /* a page mid-navigation has none to give */ }
    const cdp = this.exceptions.splice(0);
    const seen = new Set();
    return [...page, ...cdp].filter(e => {
      const key = e.message.replace(/^Uncaught /, '').replace(/^(Unhandled rejection: )?\w*Error: /, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
