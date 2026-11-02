import type { Platform } from './types';
import { tizen } from './tizen';
import { webos } from './webos';

export type { Platform } from './types';

// esbuild replaces __PLATFORM__, so a bundle keeps only its own adapter.
export const platform: Platform = __PLATFORM__ === 'tizen' ? tizen : webos;
