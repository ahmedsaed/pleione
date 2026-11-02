import type { Platform } from './types';
import { webos } from './webos';

export type { Platform } from './types';

// esbuild replaces __PLATFORM__, so a bundle keeps only its own adapter.
function adapter(): Platform {
  if (__PLATFORM__ === 'webos') return webos;
  throw new Error(`No platform adapter for ${__PLATFORM__}`);
}

export const platform: Platform = adapter();
