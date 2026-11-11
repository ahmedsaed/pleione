// Theme registry — metadata only. The color values live in `css/themes.css`
// as `[data-theme="<id>"]` blocks (single source of truth); the Settings swatch
// grid reads them back through each tile's own `data-theme`.

export interface ThemeMeta {
  id: string;
  name: string;
  isLight: boolean;
}

export const DEFAULT_THEME = 'midnight';

// Display order in the picker.
export const THEMES: ThemeMeta[] = [
  { id: 'midnight', name: 'Midnight', isLight: false },
  { id: 'ember', name: 'Ember', isLight: false },
  { id: 'emerald', name: 'Emerald', isLight: false },
  { id: 'burgundy', name: 'Burgundy', isLight: false },
  { id: 'daylight', name: 'Daylight', isLight: true },
  { id: 'paper-light', name: 'Paper Light', isLight: true },
];

// Retired themes, each mapped to the kept theme closest to it. index.html
// carries a copy for the first paint; a test keeps the two in sync.
export const RETIRED_THEMES: Record<string, string> = {
  'amethyst': 'midnight',
  'plum-night': 'midnight',
  'pastel-mocha': 'midnight',
  'neon-night': 'midnight',
  'cobalt-slate': 'midnight',
  'arctic': 'midnight',
  'ocean-dark': 'midnight',
  'vintage-amber': 'ember',
  'pastel-latte': 'daylight',
};

export function isValidTheme(id: string | null | undefined): id is string {
  return !!id && THEMES.some(t => t.id === id);
}

export function migrateThemeId(id: string): string {
  return Object.prototype.hasOwnProperty.call(RETIRED_THEMES, id) ? RETIRED_THEMES[id] : id;
}

// App-wide text size, as a percentage id. The scale factors live in
// `css/main.css` as `[data-text-size="<id>"]` blocks driving `--font-scale`,
// which PostCSS multiplies into pixel `font-size` declarations at build time.
// 100 is the baseline and needs no block.
export const TEXT_SIZES = ['80', '90', '100', '110', '120', '130', '140', '150'] as const;
export type TextSize = typeof TEXT_SIZES[number];
export const DEFAULT_TEXT_SIZE: TextSize = '100';

export function isValidTextSize(v: string | null | undefined): v is TextSize {
  return TEXT_SIZES.indexOf(v as TextSize) !== -1;
}

// App-wide interface size, as a percentage id: `[data-interface-size="<id>"]`
// blocks in `css/main.css` drive `--ui-scale`, which PostCSS multiplies into
// every px length at build time; JS layout math reads it through uiPx().
export const INTERFACE_SIZES = ['90', '100', '110', '120', '130'] as const;
export type InterfaceSize = typeof INTERFACE_SIZES[number];
export const DEFAULT_INTERFACE_SIZE: InterfaceSize = '100';

export function isValidInterfaceSize(v: string | null | undefined): v is InterfaceSize {
  return INTERFACE_SIZES.indexOf(v as InterfaceSize) !== -1;
}
