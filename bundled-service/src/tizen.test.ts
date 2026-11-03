import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_PORT, serveOverMessagePort, SERVICE_PORT, type TizenServiceApi } from './tizen';

interface Sent { to: string; data: { key: string; value: string | string[] }[] }

// A Tizen messageport in memory: the app's messages reach the service's
// listener as on Tizen 9, with no reply port, and its replies to each app's
// trusted port are recorded.
function fakeTizen(packageId = 'pkgAAAAAAA') {
  let listener: ((data: { key: string; value: string }[], remote: unknown) => void) | null = null;
  const sent: Sent[] = [];
  const api: TizenServiceApi = {
    application: { getCurrentApplication: () => ({ appInfo: { id: `${packageId}.Service`, packageId } }) },
    messageport: {
      requestTrustedLocalMessagePort: (name) => {
        expect(name).toBe(SERVICE_PORT);
        return { addMessagePortListener: (l) => { listener = l as typeof listener; return 1; } };
      },
      requestTrustedRemoteMessagePort: (appId, name) => {
        expect(name).toBe(APP_PORT);
        return { appId, sendMessage: (d: Sent['data']) => { sent.push({ to: appId, data: d }); } };
      },
    },
  };
  const call = (appId: string | null, fields: Record<string, string>) => {
    const all: Record<string, string> = appId ? { from: appId, ...fields } : fields;
    listener!(Object.keys(all).map(key => ({ key, value: all[key] })), null);
  };
  const replies = (id: string) => sent
    .filter(s => s.data.some(d => d.key === 'id' && d.value === id))
    .map(s => JSON.parse(String(s.data.find(d => d.key === 'payload')!.value)) as Record<string, unknown>);
  return { api, call, replies, sent };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 20));
};

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function dataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pleione-tizen-'));
  dirs.push(dir);
  return dir;
}

describe('serveOverMessagePort', () => {
  it('answers start with the bound port and the app key, like Luna on webOS', async () => {
    const tz = fakeTizen();
    serveOverMessagePort(tz.api, dataDir());
    tz.call('pkgAAAAAAA.PleioneIPTV', { method: 'start', id: 'r1' });
    await until(() => tz.replies('r1').length > 0);
    const [reply] = tz.replies('r1');
    expect(tz.sent[0].to).toBe('pkgAAAAAAA.PleioneIPTV');
    expect(reply.running).toBe(true);
    expect(typeof reply.port).toBe('number');
    expect(String(reply.key)).toMatch(/^[A-Za-z0-9]{32}$/);
    tz.call('pkgAAAAAAA.PleioneIPTV', { method: 'stop', id: 'r2' });
    await until(() => tz.replies('r2').length > 0);
  });

  it('ignores an app from another package, and a message that names no app', async () => {
    const tz = fakeTizen();
    serveOverMessagePort(tz.api, dataDir());
    tz.call('otherPkg01.App', { method: 'start', id: 'r1' });
    tz.call(null, { method: 'start', id: 'r2' });
    await new Promise(r => setTimeout(r, 200));
    expect(tz.sent).toEqual([]);
  });

  it('keeps a serviceEvents subscription until the app cancels it', async () => {
    const tz = fakeTizen();
    serveOverMessagePort(tz.api, dataDir());
    tz.call('pkgAAAAAAA.PleioneIPTV', { method: 'serviceEvents', id: 'ev', subscribe: '1' });
    expect(tz.replies('ev')).toEqual([{ subscribed: true }]);
    tz.call('pkgAAAAAAA.PleioneIPTV', { method: 'cancel', id: 'ev' });
    tz.call('pkgAAAAAAA.PleioneIPTV', { method: 'stop', id: 'r9' });
    await until(() => tz.replies('r9').length > 0);
  });

  it('says so for a method it does not serve', () => {
    const tz = fakeTizen();
    serveOverMessagePort(tz.api, dataDir());
    tz.call('pkgAAAAAAA.PleioneIPTV', { method: 'nope', id: 'r1' });
    expect(tz.replies('r1')).toEqual([{ returnValue: false, errorText: 'Unknown method nope' }]);
    tz.call('pkgAAAAAAA.PleioneIPTV', { method: 'stop', id: 'r2' });
  });
});
