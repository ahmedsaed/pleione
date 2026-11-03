/**
 * Samsung Tizen web service entry (`<tizen:service>` in the app's
 * config.xml). The LAN feature runs unchanged; this replaces the Luna bus
 * with a trusted message port, which only apps signed with this package's
 * certificate can reach (no web page, not even the TV's browser). The app
 * key it hands out stays as private as it is over Luna on webOS.
 *
 * Messages are arrays of {key, value} pairs, Tizen's message format:
 *   app -> service  from, method, id, [subscribe "1"]   or   from, method "cancel", id
 *   service -> app  id, payload (the JSON a Luna handler would respond)
 *
 * The app names itself in `from` rather than passing a reply port: Tizen 9's
 * service runtime drops a message that carries one (docs/tizen.md). Replies
 * go to the app's trusted APP_PORT, which only reaches this certificate.
 */

import * as path from 'path';
import { registerLanService } from './lan/service';
import { resolveDataDir } from './upload/store';

export const SERVICE_PORT = 'pleione.lan';
export const APP_PORT = 'pleione.app';

interface MessageData { key: string; value: string | string[] }
interface RemoteMessagePort {
  readonly appId: string;
  sendMessage(data: MessageData[], local?: LocalMessagePort): void;
}
interface LocalMessagePort {
  addMessagePortListener(listener: (data: MessageData[], remote: RemoteMessagePort | null) => void): number;
}
export interface TizenServiceApi {
  application: { getCurrentApplication(): { appInfo: { id: string; packageId: string } } };
  messageport: {
    requestTrustedLocalMessagePort(name: string): LocalMessagePort;
    requestTrustedRemoteMessagePort(appId: string, name: string): RemoteMessagePort;
  };
}

type Handler = (msg: {
  respond: (r: unknown) => void;
  isSubscription?: boolean;
  on?: (event: 'cancel', listener: () => void) => void;
}) => void;

function field(data: MessageData[], key: string): string | null {
  for (const item of data) {
    if (item.key === key) return Array.isArray(item.value) ? item.value[0] : item.value;
  }
  return null;
}

/** Serve the LAN feature's Luna methods over a trusted message port. */
export function serveOverMessagePort(api: TizenServiceApi, dataDir: string): void {
  const self = api.application.getCurrentApplication().appInfo;
  const handlers: { [method: string]: Handler } = {};
  const cancels: { [id: string]: () => void } = {};
  registerLanService({
    register: (method, handler) => { handlers[method] = handler as Handler; },
    // The app owns the service's lifetime on Tizen; nothing to hold open.
    activityManager: { create: (_name, cb) => cb(), complete: (_name, cb) => cb() },
  }, dataDir);

  const local = api.messageport.requestTrustedLocalMessagePort(SERVICE_PORT);
  local.addMessagePortListener((data) => {
    // The trusted port already limits callers to this certificate; take
    // only this package's own apps on top.
    const from = field(data, 'from');
    if (!from || from.indexOf(self.packageId + '.') !== 0) return;
    const method = field(data, 'method');
    const id = field(data, 'id');
    if (!method || !id) return;
    if (method === 'cancel') {
      const cancel = cancels[id];
      delete cancels[id];
      if (cancel) cancel();
      return;
    }
    const handler = handlers[method];
    const reply = (payload: unknown): void => {
      try {
        api.messageport.requestTrustedRemoteMessagePort(from, APP_PORT)
          .sendMessage([{ key: 'id', value: id }, { key: 'payload', value: JSON.stringify(payload) }]);
      } catch (e) {
        console.warn('[tizen] reply to ' + from + ' failed:', e);
        throw e;
      }
    };
    if (!handler) {
      reply({ returnValue: false, errorText: 'Unknown method ' + method });
      return;
    }
    handler({
      respond: reply,
      isSubscription: field(data, 'subscribe') === '1',
      on: (event, listener) => { if (event === 'cancel') cancels[id] = listener; },
    });
  });
  console.log('[tizen] serving ' + SERVICE_PORT + ' for ' + self.packageId + ', DATA_DIR=' + dataDir);
}

/** The app's private, persistent folder (/opt/usr/home/owner/apps_rw/<pkg>/data). */
export function tizenDataDir(packageId: string): string {
  return resolveDataDir(path.join('/opt/usr/home/owner/apps_rw', packageId, 'data', 'iptv-uploads'));
}

declare const tizen: TizenServiceApi;
let started = false;

export function onStart(): void {
  if (started) return;
  started = true;
  const packageId = tizen.application.getCurrentApplication().appInfo.packageId;
  serveOverMessagePort(tizen, tizenDataDir(packageId));
}

// Each launch from the app arrives here; onStart already serves the port.
export function onRequest(): void {}

export function onExit(): void {}
