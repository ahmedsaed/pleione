// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tizen } from './tizen';

type Host = { tizen?: unknown };

function stubTizen(supported: string[]) {
  const api = {
    tvinputdevice: {
      getSupportedKeys: () => supported.map((name, i) => ({ name, code: 1000 + i })),
      registerKey: vi.fn(),
    },
    application: { getCurrentApplication: () => ({ exit: vi.fn() }) },
  };
  const app = { exit: vi.fn() };
  api.application.getCurrentApplication = () => app;
  (window as Host).tizen = api;
  return { api, app };
}

afterEach(() => {
  delete (window as Host).tizen;
  vi.restoreAllMocks();
});

describe('tizen adapter', () => {
  it('registers the remote keys the TV supports, never Exit', () => {
    const { api } = stubTizen(['ColorF0Red', 'ChannelUp', '1', 'Exit', 'MediaPlayPause']);
    tizen.start();
    const names = api.tvinputdevice.registerKey.mock.calls.map(c => c[0]);
    expect(names).toEqual(['1', 'ColorF0Red', 'ChannelUp']);
  });

  it('logs the keys this TV does not offer', () => {
    stubTizen(['1']);
    const lines: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(' ')); });
    tizen.start();
    expect(lines).toContainEqual(expect.stringMatching(/event=platform\.keys\.missing count=20 keys=0,2,/));
  });

  it('maps Return and CH+/- to the shared actions', () => {
    expect(tizen.keys.back).toBe(10009);
    expect(tizen.keys.actions).toEqual({ 10009: 'back', 427: 'channel_up', 428: 'channel_down' });
  });

  it('exits through the current application and asks first at Home', () => {
    const { app } = stubTizen([]);
    expect(tizen.confirmExitAtHome).toBe(true);
    tizen.exit();
    expect(app.exit).toHaveBeenCalledOnce();
  });

  it('plays natively and has no caption compositor', () => {
    expect(tizen.media.nativePipeline()).toBe(true);
    expect(tizen.media.nativeCaptionCompositor()).toBe(false);
  });

  it('does nothing at boot outside a Tizen engine', () => {
    expect(() => tizen.start()).not.toThrow();
    expect(tizen.coldLaunchParams()).toBeUndefined();
  });
});
