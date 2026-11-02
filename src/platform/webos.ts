import { CONFIG } from '../config';
import { closeApp } from '../utils/platform-exit';
import { isWebOS } from '../utils/platform';
import type { Platform } from './types';

// The webOS build also serves the desktop preview, so media capabilities
// are read per call from the engine, not fixed at build time.
export const webos: Platform = {
  name: 'webos',
  start(): void {},
  keys: { back: CONFIG.KEYS.BACK, actions: {} },
  exit: closeApp,
  confirmExitAtHome: false,
  coldLaunchParams(): unknown {
    const w = window as unknown as { PalmSystem?: { launchParams?: string } };
    return w.PalmSystem?.launchParams;
  },
  onRelaunch(cb): void {
    document.addEventListener('webOSRelaunch', (e) => cb((e as CustomEvent).detail));
  },
  media: {
    nativePipeline: isWebOS,
    // setSubtitleEnable is a Luna verb on the native pipeline.
    nativeCaptionCompositor: isWebOS,
  },
};
