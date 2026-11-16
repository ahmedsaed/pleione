/**
 * Cap a string to `max` characters, appending an ellipsis when it overflows.
 * Counts by Unicode code point (via the string iterator) so a multi-code-unit
 * character — emoji, a CJK Extension-B ideograph — counts as one and is never
 * split across its surrogate pair. (Common CJK is in the BMP: one unit each.)
 */
export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max).join('') + '…' : s;
}

const MIN_KEPT_END = 3;
const TRAILING_JOINERS = /[\s|:,/·•_.\-–—]+$/;
// A cut can fall after a space or after a joiner inside a word, as in
// EN_ALPHA_2024 or Alpha-Bravo-2024. Each piece keeps the joiners after it.
const CUT_PIECES = /[^\s_.|\-]*[\s_.|\-]*/g;

/**
 * Shortens `s`, which is known not to fit, from the middle until `fits`
 * accepts it, keeping its start and its last piece: names that share a start
 * differ at the end (a year, a genre). With nowhere to cut, or when even the
 * end alone does not fit, `s` stays as is for the line clamp.
 */
export function cutMiddle(s: string, fits: (text: string) => boolean): string {
  const pieces = (s.trim().match(CUT_PIECES) ?? []).filter(piece => piece !== '');
  if (pieces.length < 2) return s;
  let kept = 1;
  const endOf = (n: number) => pieces.slice(-n).join('').replace(TRAILING_JOINERS, '');
  while (kept < pieces.length - 1 && Array.from(endOf(kept)).length < MIN_KEPT_END) kept++;
  const end = endOf(kept);
  const start = Array.from(pieces.slice(0, -kept).join(''));
  const cut = (n: number) => `${start.slice(0, n).join('').replace(TRAILING_JOINERS, '')}… ${end}`;
  let lo = 1;
  let hi = start.length - 1;
  let best = '';
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const text = cut(mid);
    if (fits(text)) {
      best = text;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best) return best;
  return fits(`… ${end}`) ? `… ${end}` : s;
}
