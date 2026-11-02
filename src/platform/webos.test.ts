// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { platform } from './index';
import { webos } from './webos';

type Host = { PalmSystem?: unknown };
const realUserAgent = navigator.userAgent;

function setUserAgent(value: string): void {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value });
}

afterEach(() => {
  delete (window as Host).PalmSystem;
  setUserAgent(realUserAgent);
  vi.restoreAllMocks();
});

describe('platform', () => {
  it('is the webOS adapter in a webOS build', () => {
    expect(platform).toBe(webos);
    expect(platform.name).toBe('webos');
  });
});

describe('webos adapter', () => {
  it('closes at once on Back at Home, as LG requires', () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    expect(webos.confirmExitAtHome).toBe(false);
    webos.exit();
    expect(close).toHaveBeenCalledOnce();
  });

  it('reads cold launch params from PalmSystem', () => {
    expect(webos.coldLaunchParams()).toBeUndefined();
    (window as Host).PalmSystem = { launchParams: '{"reminderChannelKey":"ch1"}' };
    expect(webos.coldLaunchParams()).toBe('{"reminderChannelKey":"ch1"}');
  });

  it('passes each webOSRelaunch detail to the callback', () => {
    const cb = vi.fn();
    webos.onRelaunch(cb);
    document.dispatchEvent(new CustomEvent('webOSRelaunch', { detail: { reminderChannelKey: 'ch2' } }));
    expect(cb).toHaveBeenCalledWith({ reminderChannelKey: 'ch2' });
  });

  it('reads the media capabilities from the engine on every call', () => {
    setUserAgent('Mozilla/5.0 (X11; Linux x86_64) Chrome/120.0');
    expect(webos.media.nativePipeline()).toBe(false);
    expect(webos.media.nativeCaptionCompositor()).toBe(false);
    setUserAgent('Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/53.0');
    expect(webos.media.nativePipeline()).toBe(true);
    expect(webos.media.nativeCaptionCompositor()).toBe(true);
  });
});
