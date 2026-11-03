import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTizenLanTransport } from './tizen-lan';

interface Data { key: string; value: string | string[] }

// The app's trusted ports in memory: the service port appears once the
// service "starts" (`serviceUp`), and `reply` answers as the service would.
function fakeTizen() {
  let appListener: ((data: Data[]) => void) | null = null;
  let serviceUp = false;
  const toService: Record<string, string>[] = [];
  const launches: string[] = [];
  const api = {
    application: {
      getCurrentApplication: () => ({ appInfo: { packageId: 'pkgAAAAAAA' } }),
      launchAppControl: (_c: unknown, appId: string, ok: () => void) => { launches.push(appId); ok(); },
    },
    ApplicationControl: class { constructor(public operation: string) {} },
    messageport: {
      requestTrustedLocalMessagePort: () => ({ addMessagePortListener: (l: (d: Data[]) => void) => { appListener = l; return 1; } }),
      requestTrustedRemoteMessagePort: (appId: string, name: string) => {
        if (!serviceUp) throw new Error('NotFoundError');
        expect([appId, name]).toEqual(['pkgAAAAAAA.PleioneLan', 'pleione.lan']);
        return {
          sendMessage: (data: Data[]) => {
            toService.push(Object.fromEntries(data.map(d => [d.key, String(d.value)])));
          },
        };
      },
    },
  };
  const reply = (id: string, payload: unknown) =>
    appListener!([{ key: 'id', value: id }, { key: 'payload', value: JSON.stringify(payload) }]);
  return { api, toService, launches, reply, up: () => { serviceUp = true; } };
}

afterEach(() => vi.useRealTimers());

describe('createTizenLanTransport', () => {
  it('launches the service, waits for its port, and resolves start with the port and key', async () => {
    vi.useFakeTimers();
    const tz = fakeTizen();
    const transport = createTizenLanTransport(tz.api, 'PleioneLan');
    const started = transport.start();
    await vi.advanceTimersByTimeAsync(300);
    expect(tz.launches).toEqual(['pkgAAAAAAA.PleioneLan']);
    expect(tz.toService).toEqual([]);
    tz.up();
    await vi.advanceTimersByTimeAsync(200);
    expect(tz.toService).toEqual([{ method: 'start', id: 'r1' }]);
    tz.reply('r1', { running: true, port: 4242, key: 'k1' });
    await expect(started).resolves.toEqual({ port: 4242, key: 'k1' });
  });

  it('resolves start to null when the service never answers', async () => {
    vi.useFakeTimers();
    const tz = fakeTizen();
    tz.up();
    const started = createTizenLanTransport(tz.api, 'PleioneLan').start();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(started).resolves.toBeNull();
  });

  it('delivers change events after the subscription confirms, and cancels it', async () => {
    const tz = fakeTizen();
    tz.up();
    const transport = createTizenLanTransport(tz.api, 'PleioneLan');
    const events: unknown[] = [];
    const unsubscribe = transport.subscribe(e => events.push(e));
    await Promise.resolve();
    expect(tz.toService).toEqual([{ method: 'serviceEvents', id: 'ev1', subscribe: '1' }]);
    tz.reply('ev1', { subscribed: true });
    tz.reply('ev1', { event: 'setup-changed' });
    expect(events).toEqual([{ event: 'setup-changed' }]);
    unsubscribe();
    await Promise.resolve();
    tz.reply('ev1', { event: 'uploads-changed' });
    expect(events).toEqual([{ event: 'setup-changed' }]);
    expect(tz.toService.at(-1)).toEqual({ method: 'cancel', id: 'ev1' });
  });
});
