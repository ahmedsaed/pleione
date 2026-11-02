import { CONFIG } from '../config';
import { platform } from '../platform';

// Back as a text field's own listener sees it: the remote's Back key (on
// webOS, or Return on Samsung), or Escape on a desktop keyboard.
export function isBackKey(e: KeyboardEvent): boolean {
  return e.keyCode === CONFIG.KEYS.BACK || e.keyCode === platform.keys.back
    || e.keyCode === CONFIG.KEYS.ESC || e.key === 'Escape';
}
