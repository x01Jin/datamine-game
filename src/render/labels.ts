import { BitmapFont, BitmapText } from 'pixi.js';
import { FONT_MONO, FONT_SANS } from './theme.ts';

export const FONT_RESOLUTION = 2;

export const MONO = 'datamine-mono';
export const MONO_SM = 'datamine-mono-sm';
export const MONO_LG = 'datamine-mono-lg';
export const SANS = 'datamine-sans';

const CHARS: (string | string[])[] = [[' ', '~'], '×', '→', '←', '↑', '↓', '·', '×', '°', '±', '✓'];

export function installFonts(): void {
  const base = { fontFamily: FONT_MONO, fill: 0xffffff };
  BitmapFont.install({
    name: MONO,
    style: { ...base, fontSize: 11 },
    chars: CHARS,
    resolution: FONT_RESOLUTION,
    padding: 2,
  });
  BitmapFont.install({
    name: MONO_SM,
    style: { ...base, fontSize: 9 },
    chars: CHARS,
    resolution: FONT_RESOLUTION,
    padding: 2,
  });
  BitmapFont.install({
    name: MONO_LG,
    style: { ...base, fontSize: 13 },
    chars: CHARS,
    resolution: FONT_RESOLUTION,
    padding: 2,
  });
  BitmapFont.install({
    name: SANS,
    style: { fontFamily: FONT_SANS, fontSize: 11, fill: 0xffffff },
    chars: CHARS,
    resolution: FONT_RESOLUTION,
    padding: 2,
  });
}

export async function waitForFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  await Promise.all([
    document.fonts.load(`11px "${FONT_MONO}"`),
    document.fonts.load(`11px "${FONT_SANS}"`),
  ]).catch(() => undefined);
  await document.fonts.ready.catch(() => undefined);
}

export interface LabelOptions {
  font?: string;
  size?: number;
  color?: number;
  anchorX?: number;
  anchorY?: number;
  alpha?: number;
  letterSpacing?: number;
}

export function label(text: string, options: LabelOptions = {}): BitmapText {
  const font = options.font ?? MONO;
  const size = options.size ?? 11;
  const node = new BitmapText({
    text,
    style: {
      fontFamily: font,
      fontSize: size,
      fill: options.color ?? 0xffffff,
      letterSpacing: options.letterSpacing ?? 0,
    },
  });
  node.anchor.set(options.anchorX ?? 0, options.anchorY ?? 0);
  if (options.alpha !== undefined) node.alpha = options.alpha;
  node.roundPixels = true;
  return node;
}
