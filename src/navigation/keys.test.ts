import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { platform } from '../platform';
import { isBackKey } from './keys';

const key = (init: { keyCode?: number; key?: string }) => init as KeyboardEvent;

describe('isBackKey', () => {
  it('matches the remote Back key, the Escape key code, and Escape by name', () => {
    expect(isBackKey(key({ keyCode: CONFIG.KEYS.BACK }))).toBe(true);
    expect(isBackKey(key({ keyCode: CONFIG.KEYS.ESC }))).toBe(true);
    expect(isBackKey(key({ keyCode: 0, key: 'Escape' }))).toBe(true);
  });

  it('matches the platform\'s own Back key', () => {
    expect(isBackKey(key({ keyCode: platform.keys.back }))).toBe(true);
  });

  it('ignores other keys', () => {
    expect(isBackKey(key({ keyCode: CONFIG.KEYS.ENTER, key: 'Enter' }))).toBe(false);
    expect(isBackKey(key({ keyCode: 8, key: 'Backspace' }))).toBe(false);
  });
});
