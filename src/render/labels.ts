import { BitmapFont, BitmapText } from 'pixi.js';
import type { TextStyleFontWeight } from 'pixi.js';
import { FONT_MONO, FONT_SANS } from './theme.ts';

export type LabelRole = 'title' | 'meta' | 'status' | 'value' | 'compact';

interface RoleSpec {
  family: string;
  size: number;
  weight: TextStyleFontWeight;
  chars: string;
}

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

const ROLES: Record<LabelRole, RoleSpec> = {
  title: {
    family: FONT_SANS,
    size: 14,
    weight: '500',
    chars: `${UPPER}${LOWER}${DIGITS} .'-/+…`,
  },
  meta: {
    family: FONT_MONO,
    size: 11,
    weight: '400',
    chars: `${UPPER}${DIGITS}% ×+→·-/`,
  },
  status: {
    family: FONT_SANS,
    size: 11,
    weight: '400',
    chars: `${UPPER}${LOWER} `,
  },
  value: {
    family: FONT_MONO,
    size: 28,
    weight: '500',
    chars: `${UPPER}${LOWER}${DIGITS}.,+-`,
  },
  compact: {
    family: FONT_MONO,
    size: 20,
    weight: '500',
    chars: `T${DIGITS}RAWN`,
  },
};

const BUCKETS = [0.5, 0.625, 0.75, 0.875, 1, 1.125, 1.25, 1.375, 1.5, 1.75, 2, 2.5, 3, 3.5, 4] as const;

const installed = new Set<number>();
const live = new Map<BitmapText, LabelRole>();
let bucket = 1;

function fontName(role: LabelRole, resolution: number): string {
  return `${role}@${resolution}`;
}

function installBucket(resolution: number): void {
  if (installed.has(resolution)) return;
  installed.add(resolution);
  for (const [role, spec] of Object.entries(ROLES) as [LabelRole, RoleSpec][]) {
    BitmapFont.install({
      name: fontName(role, resolution),
      style: {
        fontFamily: spec.family,
        fontSize: spec.size,
        fontWeight: spec.weight,
        fill: 0xffffff,
      },
      chars: Array.from(spec.chars),
      resolution,
      padding: 2,
      skipKerning: true,
    });
  }
}

function pickBucket(scale: number): number {
  const target = Math.max(BUCKETS[0], Math.min(BUCKETS[BUCKETS.length - 1], scale));
  for (const option of BUCKETS) {
    if (option >= target) return option;
  }
  return BUCKETS[BUCKETS.length - 1];
}

export function setFontScale(scale: number): void {
  const next = pickBucket(scale);
  if (next === bucket) return;
  bucket = next;
  installBucket(next);
  for (const [node, role] of live) {
    if (node.destroyed) {
      live.delete(node);
      continue;
    }
    node.style.fontFamily = fontName(role, next);
  }
}

export async function waitForFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  await Promise.all([
    document.fonts.load(`400 11px "${FONT_MONO}"`),
    document.fonts.load(`500 28px "${FONT_MONO}"`),
    document.fonts.load(`500 14px "${FONT_SANS}"`),
  ]).catch(() => undefined);
  await document.fonts.ready.catch(() => undefined);
}

export interface LabelOptions {
  role: LabelRole;
  color?: number;
  anchorX?: number;
  anchorY?: number;
  alpha?: number;
}

export function label(text: string, options: LabelOptions): BitmapText {
  const spec = ROLES[options.role];
  if (!installed.has(bucket)) installBucket(bucket);
  const node = new BitmapText({
    text,
    style: {
      fontFamily: fontName(options.role, bucket),
      fontSize: spec.size,
      fill: options.color ?? 0xffffff,
    },
  });
  node.anchor.set(options.anchorX ?? 0, options.anchorY ?? 0);
  if (options.alpha !== undefined) node.alpha = options.alpha;
  node.roundPixels = true;
  live.set(node, options.role);
  node.once('destroyed', () => live.delete(node));
  return node;
}
