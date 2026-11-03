import { createLogger } from '../utils/logger';
import type { LanServiceStart, LanTransport } from './types';

// The app's side of the LAN service on Tizen (bundled-service/src/tizen.ts):
// the service runs as this package's web service, and the Luna calls webOS
// makes travel over a pair of trusted message ports instead.

const SERVICE_PORT = 'pleione.lan';
const APP_PORT = 'pleione.app';
const START_TIMEOUT_MS = 4000;
const PORT_RETRY_MS = 150;

const log = () => createLogger('Lan');

interface MessageData { key: string; value: string | string[] }
interface RemotePort { sendMessage(data: MessageData[], local?: LocalPort): void }
interface LocalPort { addMessagePortListener(listener: (data: MessageData[]) => void): number }
interface TizenLanApi {
  application: {
    getCurrentApplication(): { appInfo: { id: string; packageId: string } };
    launchAppControl(control: unknown, appId: string, onSuccess: () => void, onError: (e: Error) => void): void;
  };
  ApplicationControl: new (operation: string) => unknown;
  messageport: {
    requestTrustedLocalMessagePort(name: string): LocalPort;
    requestTrustedRemoteMessagePort(appId: string, name: string): RemotePort;
  };
}

function field(data: MessageData[], key: string): string | null {
  for (const item of data) {
    if (item.key === key) return Array.isArray(item.value) ? item.value[0] : item.value;
  }
  return null;
}

export function createTizenLanTransport(api: TizenLanApi, serviceName: string): LanTransport {
  const appInfo = api.application.getCurrentApplication().appInfo;
  const serviceId = `${appInfo.packageId}.${serviceName}`;
  const pending = new Map<string, (payload: unknown) => void>();
  let local: LocalPort | null = null;
  let next = 0;

  function localPort(): LocalPort {
    if (local) return local;
    local = api.messageport.requestTrustedLocalMessagePort(APP_PORT);
    local.addMessagePortListener((data) => {
      const id = field(data, 'id');
      const payload = field(data, 'payload');
      const handler = id ? pending.get(id) : undefined;
      if (!handler || payload === null) return;
      try {
        handler(JSON.parse(payload));
      } catch (e) {
        log().warn('Unreadable reply from the LAN service', e);
      }
    });
    return local;
  }

  // The service's port exists only once its onStart ran, a moment after the
  // launch reports success: retry until it does or the time runs out. The
  // app names itself instead of passing its port, which Tizen 9's service
  // runtime cannot resolve (bundled-service/src/tizen.ts).
  function send(fields: Record<string, string>, deadline: number): Promise<void> {
    const data = [{ key: 'from', value: appInfo.id }]
      .concat(Object.keys(fields).map(key => ({ key, value: fields[key] })));
    return new Promise((resolve, reject) => {
      const attempt = (): void => {
        try {
          localPort();
          api.messageport.requestTrustedRemoteMessagePort(serviceId, SERVICE_PORT).sendMessage(data);
          resolve();
        } catch (e) {
          if (Date.now() + PORT_RETRY_MS > deadline) reject(e);
          else setTimeout(attempt, PORT_RETRY_MS);
        }
      };
      attempt();
    });
  }

  function launch(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        api.application.launchAppControl(
          new api.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
          serviceId, resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  }

  function request(method: string): Promise<unknown> {
    const id = `r${++next}`;
    const deadline = Date.now() + START_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, START_TIMEOUT_MS);
      pending.set(id, (payload) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(payload);
      });
      send({ method, id }, deadline).catch((e) => {
        clearTimeout(timer);
        pending.delete(id);
        reject(e);
      });
    });
  }

  return {
    async start(): Promise<LanServiceStart | null> {
      try {
        await launch();
        const reply = await request('start') as { running?: unknown; port?: unknown; key?: unknown };
        if (reply.running !== true || typeof reply.port !== 'number') {
          log().warn('LAN service did not start', 'event=lan.start.failed', 'reason=not-running');
          return null;
        }
        return { port: reply.port, key: typeof reply.key === 'string' ? reply.key : null };
      } catch (e) {
        log().warn('LAN service did not start', 'event=lan.start.failed', 'reason=unreachable', e);
        return null;
      }
    },
    stop(): void {
      void send({ method: 'stop', id: `r${++next}` }, Date.now()).catch(() => {});
    },
    subscribe(onEvent: (event: unknown) => void): () => void {
      const id = `ev${++next}`;
      pending.set(id, (payload) => {
        // The first reply only confirms the subscription.
        if (payload && typeof payload === 'object' && (payload as { subscribed?: unknown }).subscribed === true) {
          pending.set(id, onEvent);
          return;
        }
        onEvent(payload);
      });
      void send({ method: 'serviceEvents', id, subscribe: '1' }, Date.now() + START_TIMEOUT_MS)
        .catch((e) => log().warn('serviceEvents subscription failed', e));
      return () => {
        pending.delete(id);
        void send({ method: 'cancel', id }, Date.now()).catch(() => {});
      };
    },
  };
}
