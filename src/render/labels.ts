import { BitmapFont, BitmapText } from 'pixi.js';
import { FONT_MONO, FONT_SANS } from './theme.ts';

export const MONO = 'datamine-mono';
export const MONO_SM = 'datamine-mono-sm';
export const MONO_LG = 'datamine-mono-lg';
export const MONO_XL = 'datamine-mono-xl';

const CHARS: (string | string[])[] = [[' ', '~'], '×', '→', '←', '↑', '↓', '·', '×', '°', '±', '✓'];

const BUCKETS = [0.4, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

interface FontSpec {
  base: string;
  size: number;
}

const SPECS: FontSpec[] = [
  { base: MONO, size: 11 },
  { base: MONO_SM, size: 10 },
  { base: MONO_LG, size: 13 },
  { base: MONO_XL, size: 17 },
];

const installed = new Set<number>();
const live = new Set<BitmapText>();
let bucket: number = 1;

function fontName(base: string, resolution: number): string {
  return `${base}@${resolution}`;
}

function installBucket(resolution: number): void {
  if (installed.has(resolution)) return;
  installed.add(resolution);
  for (const spec of SPECS) {
    BitmapFont.install({
      name: fontName(spec.base, resolution),
      style: { fontFamily: FONT_MONO, fontSize: spec.size, fill: 0xffffff },
      chars: CHARS,
      resolution,
      padding: 2,
      skipKerning: true,
    });
  }
}

// The atlas must be rasterised at the size the glyphs land on screen, otherwise the
// sampler minifies a high-resolution atlas into a small box and the type turns to mush.
function pickBucket(scale: number): number {
  const target = Math.max(BUCKETS[0], Math.min(BUCKETS[BUCKETS.length - 1], scale));
  let best: number = BUCKETS[0];
  let error = Infinity;
  for (const option of BUCKETS) {
    const delta = Math.abs(option - target);
    if (delta < error) {
      best = option;
      error = delta;
    }
  }
  return best;
}

export function installFonts(): void {
  bucket = pickBucket(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  installBucket(bucket);
}

export function setFontScale(scale: number): void {
  const next = pickBucket(scale);
  if (next === bucket) return;
  bucket = next;
  installBucket(next);
  for (const node of live) {
    if (node.destroyed) {
      live.delete(node);
      continue;
    }
    const current = node.style.fontFamily;
    const mark = current.lastIndexOf('@');
    if (mark < 0) continue;
    node.style.fontFamily = `${current.slice(0, mark)}@${next}`;
  }
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
  const base = options.font ?? MONO;
  const size = options.size ?? 11;
  const node = new BitmapText({
    text,
    style: {
      fontFamily: fontName(base, bucket),
      fontSize: size,
      fill: options.color ?? 0xffffff,
      letterSpacing: options.letterSpacing ?? 0,
    },
  });
  node.anchor.set(options.anchorX ?? 0, options.anchorY ?? 0);
  if (options.alpha !== undefined) node.alpha = options.alpha;
  node.roundPixels = true;
  live.add(node);
  node.once('destroyed', () => live.delete(node));
  return node;
}
