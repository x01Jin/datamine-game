export const FONT_SANS = 'Plex Sans';
export const FONT_MONO = 'Plex Mono';

export const CHROME = {
  void: 0x080a0d,
  deck: 0x0e1218,
  plate: 0x141a22,
  plateHi: 0x1b222c,
  inset: 0x090c11,
  rule: 0x232c38,
  ruleSoft: 0x171e26,
  ink: 0xe7eaed,
  inkDim: 0x94a1ae,
  inkFaint: 0x596572,
  warn: 0xd9a441,
  bad: 0xd9564f,
} as const;

export const CSS_VARS: Record<string, string> = {
  '--void': '#080a0d',
  '--deck': '#0e1218',
  '--plate': '#141a22',
  '--plate-hi': '#1b222c',
  '--inset': '#090c11',
  '--rule': '#232c38',
  '--rule-soft': '#171e26',
  '--ink': '#e7eaed',
  '--ink-dim': '#94a1ae',
  '--ink-faint': '#596572',
  '--warn': '#d9a441',
  '--bad': '#d9564f',
  '--font-sans': `'${FONT_SANS}', ui-sans-serif, system-ui, sans-serif`,
  '--font-mono': `'${FONT_MONO}', ui-monospace, 'Cascadia Mono', Consolas, monospace`,
};

export { tierColor, tierBright, tierDim, tierSoft, tierFaint, hex } from '../game/palette.ts';

export function applyCssVars(root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(CSS_VARS)) {
    root.style.setProperty(name, value);
  }
}

export const STATUS_COLOR: Record<string, number> = {
  running: CHROME.ink,
  receiving: CHROME.ink,
  limited: CHROME.warn,
  starved: CHROME.warn,
  blocked: CHROME.bad,
  idle: CHROME.inkFaint,
};

export const METRICS = {
  cardRadius: 3,
  portRadius: 5,
  wireWidth: 1.6,
  wireWidthBusy: 2.4,
  gridAlpha: 0.1,
} as const;
