import { createLogger } from '../utils/logger';
import type { Platform } from './types';

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
}

// Keys a Tizen app receives only after registering them. Arrows, OK and
// Return always arrive. Exit and a long press of Return are never
// registered: Samsung requires the system to handle both.
const REGISTERED_KEYS = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
  'MediaPlay', 'MediaPause', 'MediaStop', 'MediaRewind', 'MediaFastForward',
  'ChannelUp', 'ChannelDown',
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
    // Return, CH+ and CH-. Literal keys keep this object free of side
    // effects, so a webOS bundle can drop it.
    back: 10009,
    actions: { 10009: 'back', 427: 'channel_up', 428: 'channel_down' },
  },
  exit(): void {
    log().info('Closing the app', 'event=app.exit', 'method=tizen');
    host()?.application.getCurrentApplication().exit();
  },
  // The LAN service is not ported yet (docs/tizen-port-plan.md, Phase 6).
  lanSetup: false,
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
    // Live DVR stays off: live HLS reports a finite duration here, which
    // dvrWindow() reads as not live, and native seeks to the live edge freeze
    // on Tizen 5.5 (docs/tizen.md). Timeshift waits for an MSE or AVPlay path.
  },
};
