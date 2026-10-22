export const FONT_SANS = 'Plex Sans';
export const FONT_MONO = 'Plex Mono';

export const CHROME = {
  void: 0x080a0d,
  deck: 0x0e1218,
  plate: 0x151b23,
  plateHi: 0x1d242e,
  inset: 0x0a0d12,
  rule: 0x242d39,
  ruleSoft: 0x1a212b,
  ink: 0xeceff2,
  inkDim: 0xa9b4c0,
  inkFaint: 0x7b8794,
  warn: 0xd9a441,
  bad: 0xd9564f,
} as const;

export const CSS_VARS: Record<string, string> = {
  '--void': '#080a0d',
  '--deck': '#0e1218',
  '--plate': '#151b23',
  '--plate-hi': '#1d242e',
  '--inset': '#0a0d12',
  '--rule': '#242d39',
  '--rule-soft': '#1a212b',
  '--ink': '#eceff2',
  '--ink-dim': '#a9b4c0',
  '--ink-faint': '#7b8794',
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
  wireWidth: 1.5,
  wireWidthBusy: 2.2,
  gridAlpha: 0.07,
} as const;
