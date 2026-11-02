import { CONFIG } from '../config';

// Back as a text field's own listener sees it: the remote's Back key, or
// Escape on a desktop keyboard.
export function isBackKey(e: KeyboardEvent): boolean {
  return e.keyCode === CONFIG.KEYS.BACK || e.keyCode === CONFIG.KEYS.ESC || e.key === 'Escape';
}
