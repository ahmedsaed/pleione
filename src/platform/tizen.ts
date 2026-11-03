import { createLogger } from '../utils/logger';
import { createTizenLanTransport } from './tizen-lan';
import type { LanTransport, Platform } from './types';

// The web service's name in config.xml (scripts/tizen-config.mjs).
const TIZEN_LAN_SERVICE = 'PleioneLan';
let transport: LanTransport | null = null;

// Created on use, so a webOS bundle can drop this module whole.
const log = () => createLogger('Platform');

// The Tizen Web Device API, as far as the app uses it.
interface TizenHost {
  tizen?: {
    tvinputdevice: {
      getSupportedKeys(): { name: string; code: number }[];
      registerKey(name: string): void;
    };
    application: { getCurrentApplication(): { exit(): void } };
  };
  webapis?: {
    appcommon?: {
      AppCommonScreenSaverState: { SCREEN_SAVER_OFF: number; SCREEN_SAVER_ON: number };
      setScreenSaver(state: number, ok?: () => void, fail?: (e: { name?: string }) => void): void;
    };
  };
}

let awake: boolean | null = null;
let awakeFailureLogged = false;

// Keys a Tizen app receives only after registering them. Arrows, OK and
// Return always arrive. Exit and a long press of Return are never
// registered: Samsung requires the system to handle both.
const REGISTERED_KEYS = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
  'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward',
  'ChannelUp', 'ChannelDown', 'MediaPlayPause', 'Info', 'Guide',
];


function host(): TizenHost['tizen'] {
  return (window as unknown as TizenHost).tizen;
}

export const tizen: Platform = {
  name: 'tizen',
  start(): void {
    const api = host();
    if (!api) return;
    const supported = new Set(api.tvinputdevice.getSupportedKeys().map(k => k.name));
    const missing: string[] = [];
    for (const name of REGISTERED_KEYS) {
      if (!supported.has(name)) { missing.push(name); continue; }
      try {
        api.tvinputdevice.registerKey(name);
      } catch {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      log().warn('Remote keys unavailable', 'event=platform.keys.missing', `count=${missing.length}`,
        `keys=${missing.join(',')}`);
    }
  },
  keys: {
    // Return, CH+ and CH-, and the keys webOS remotes lack: Play/Pause as one
    // key, Info, and Guide. Literal keys keep this object free of side
    // effects, so a webOS bundle can drop it.
    back: 10009,
    actions: {
      10009: 'back', 427: 'channel_up', 428: 'channel_down',
      10252: 'play_pause', 457: 'info', 458: 'guide',
    },
  },
  exit(): void {
    log().info('Closing the app', 'event=app.exit', 'method=tizen');
    host()?.application.getCurrentApplication().exit();
  },
  // The LAN service runs as this package's web service (config.xml).
  lanSetup: true,
  lanTransport(): LanTransport | null {
    const api = host();
    if (!api) return null;
    if (!transport) transport = createTizenLanTransport(api as unknown as Parameters<typeof createTizenLanTransport>[0], TIZEN_LAN_SERVICE);
    return transport;
  },
  confirmExitAtHome: true,
  // Reminders are in-app only on Tizen (docs/tizen-port-plan.md, D5), so
  // nothing launches the app with parameters.
  coldLaunchParams(): unknown {
    return undefined;
  },
  onRelaunch(): void {},
  media: {
    nativePipeline: () => true,
    // No Luna compositor; the native element neither shows nor exposes 608.
    nativeCaptionCompositor: () => false,
    // No Luna DRM service; the TV's EME grants com.microsoft.playready,
    // which Shaka drives (docs/tizen.md).
    nativePlayReady: () => false,
    // The TV's screensaver also starts over a playing video, so the app holds
    // it off while one plays and hands it back on pause or stop.
    keepAwake(on: boolean): void {
      if (awake === on) return;
      const appcommon = (window as unknown as TizenHost).webapis?.appcommon;
      if (!appcommon) return;
      awake = on;
      const state = appcommon.AppCommonScreenSaverState;
      const fail = (e: { name?: string }) => {
        awake = null;
        if (awakeFailureLogged) return;
        awakeFailureLogged = true;
        log().warn('Screensaver switch failed', 'event=platform.screensaver.failed', `error=${e?.name ?? 'unknown'}`);
      };
      try {
        appcommon.setScreenSaver(on ? state.SCREEN_SAVER_OFF : state.SCREEN_SAVER_ON, undefined, fail);
      } catch (e) {
        fail(e as { name?: string });
      }
    },
    // Live DVR stays off: live HLS reports a finite duration here, which
    // dvrWindow() reads as not live, and native seeks to the live edge freeze
    // on Tizen 5.5 (docs/tizen.md). Timeshift waits for an MSE or AVPlay path.
  },
};
