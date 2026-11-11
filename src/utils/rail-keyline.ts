import { uiPx } from './ui-scale';

// Rails start on the view's 80px keyline, and their focused item stops on
// the matching keyline at the end. A virtualized rail's spacer carries that
// end gutter itself: an engine before Chromium 91 leaves a scroller's end
// padding out of its scroll width.
const RAIL_KEYLINE = 80;

export function railKeyline(): number {
  return uiPx(RAIL_KEYLINE);
}

/** The width a virtualized rail keeps its focused item inside: past the
 *  start padding and short of the end keyline. */
export function railViewport(rail: HTMLElement | null, fallback: number): number {
  if (!rail?.clientWidth) return fallback;
  const style = getComputedStyle(rail);
  return rail.clientWidth - (parseFloat(style.paddingLeft) || 0)
    - (parseFloat(style.paddingRight) || 0) - railKeyline();
}
