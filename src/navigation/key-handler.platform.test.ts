// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { Action } from '../types';

// A platform with keys of its own, as Samsung's remotes have.
vi.mock('../platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform')>();
  return {
    platform: {
      ...actual.platform,
      keys: { back: 10009, actions: { 10009: 'back', 427: 'channel_up', 458: 'guide', 10252: 'play_pause' } },
    },
  };
});

describe('KeyHandler with platform keys', () => {
  beforeAll(async () => {
    const { KeyHandler } = await import('./key-handler');
    KeyHandler.init();
  });

  it('lets the platform\'s keys through a focused text box, as it does Red', async () => {
    const { KeyHandler } = await import('./key-handler');
    const seen: Action[] = [];
    KeyHandler.setHandler((a: Action) => { seen.push(a); });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    for (const keyCode of [458, 10252, 427]) {
      input.dispatchEvent(new KeyboardEvent('keydown', { keyCode, bubbles: true, cancelable: true } as KeyboardEventInit));
    }
    expect(seen).toEqual(['guide', 'play_pause', 'channel_up']);
  });
});
