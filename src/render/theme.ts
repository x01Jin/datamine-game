export const FONT_SANS = 'Plex Sans';
export const FONT_MONO = 'Plex Mono';
export const FONT_DISPLAY = 'Saira Condensed';

export const CHROME = {
  void: 0x12110d,
  deck: 0x1b1a14,
  plate: 0x27251c,
  plateHi: 0x353226,
  inset: 0x0f0e0a,
  rule: 0x4b4634,
  ruleSoft: 0x322f23,
  ink: 0xf2e8cf,
  inkDim: 0xc6ba9c,
  inkFaint: 0x958a6f,
  paper: 0xe7dcc0,
  paperHi: 0xf0e6cd,
  paperInk: 0x211f17,
  paperDim: 0x625a47,
  accent: 0xe8782c,
  good: 0xa7c46a,
  warn: 0xe6b23e,
  bad: 0xd95a3d,
} as const;

export const CSS_VARS: Record<string, string> = {
  '--void': '#12110d',
  '--deck': '#1b1a14',
  '--deck-2': '#22211a',
  '--plate': '#27251c',
  '--plate-hi': '#353226',
  '--inset': '#0f0e0a',
  '--rule': '#4b4634',
  '--rule-soft': '#322f23',
  '--ink': '#f2e8cf',
  '--ink-dim': '#c6ba9c',
  '--ink-faint': '#958a6f',
  '--paper': '#e7dcc0',
  '--paper-hi': '#f0e6cd',
  '--paper-ink': '#211f17',
  '--paper-dim': '#625a47',
  '--accent': '#e8782c',
  '--accent-hi': '#ff9243',
  '--good': '#a7c46a',
  '--warn': '#e6b23e',
  '--bad': '#d95a3d',
  '--font-display': `'${FONT_DISPLAY}', '${FONT_SANS}', ui-sans-serif, sans-serif`,
  '--font-sans': `'${FONT_SANS}', ui-sans-serif, system-ui, sans-serif`,
  '--font-mono': `'${FONT_MONO}', ui-monospace, 'Cascadia Mono', Consolas, monospace`,
};

export { tierColor, tierBright, tierDim, tierSoft, tierFaint, hex } from '../game/palette.ts';

export function applyCssVars(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(CSS_VARS)) {
    root.style.setProperty(name, value);
  }
}

// Status lamps sit on the cream machine plates, so they use ink-side colours rather
// than the bright HUD tones.
export const STATUS_COLOR: Record<string, number> = {
  running: 0x3f6231,
  receiving: 0x3f6231,
  limited: 0x8a5a12,
  starved: 0x8a5a12,
  blocked: 0x9b3423,
  idle: 0x6f6753,
};

export const METRICS = {
  cardRadius: 2,
  portRadius: 5,
  wireWidth: 2,
  wireWidthBusy: 2.6,
  gridAlpha: 0.06,
} as const;
