import { Texture } from 'pixi.js';

function canvasOf(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  return { canvas, ctx };
}

export function backgroundTexture(): Texture {
  const { canvas, ctx } = canvasOf(8, 256);
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#1d1b14');
  gradient.addColorStop(0.55, '#171610');
  gradient.addColorStop(1, '#12110d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 8, 256);
  return Texture.from(canvas);
}

export function vignetteTexture(): Texture {
  const size = 256;
  const { canvas, ctx } = canvasOf(size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.18, size / 2, size / 2, size * 0.62);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
  gradient.addColorStop(0.72, 'rgba(0, 0, 0, 0.24)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.64)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

export function latticeTexture(step = 32): Texture {
  const { canvas, ctx } = canvasOf(step, step);
  ctx.fillStyle = 'rgba(214, 198, 158, 0.12)';
  ctx.fillRect(0, 0, 1.3, 1.3);
  return Texture.from(canvas);
}

export function glowTexture(size = 32): Texture {
  const { canvas, ctx } = canvasOf(size, size);
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.32, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

const GLYPH_SHAPES = ['square', 'diamond', 'circle', 'hex', 'triangle', 'ring', 'bars', 'cross'] as const;

export type GlyphShape = (typeof GLYPH_SHAPES)[number];

function drawGlyph(ctx: CanvasRenderingContext2D, shape: string, size: number): void {
  const c = size / 2;
  const r = size * 0.34;
  ctx.beginPath();
  switch (shape) {
    case 'square':
      ctx.rect(c - r * 0.8, c - r * 0.8, r * 1.6, r * 1.6);
      break;
    case 'diamond':
      ctx.moveTo(c, c - r);
      ctx.lineTo(c + r, c);
      ctx.lineTo(c, c + r);
      ctx.lineTo(c - r, c);
      ctx.closePath();
      break;
    case 'circle':
      ctx.arc(c, c, r * 0.82, 0, Math.PI * 2);
      break;
    case 'hex':
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const x = c + Math.cos(angle) * r;
        const y = c + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    case 'triangle':
      ctx.moveTo(c, c - r);
      ctx.lineTo(c + r * 0.92, c + r * 0.65);
      ctx.lineTo(c - r * 0.92, c + r * 0.65);
      ctx.closePath();
      break;
    case 'ring':
      ctx.arc(c, c, r * 0.75, 0, Math.PI * 2);
      break;
    case 'bars':
      ctx.rect(c - r * 0.72, c - r * 0.8, r * 0.5, r * 1.6);
      ctx.rect(c + r * 0.22, c - r * 0.8, r * 0.5, r * 1.6);
      break;
    default:
      ctx.rect(c - r * 0.25, c - r, r * 0.5, r * 2);
      ctx.rect(c - r, c - r * 0.25, r * 2, r * 0.5);
      break;
  }
}

const glyphCache = new Map<string, Texture>();

export function glyphTexture(shape: string, size = 28): Texture {
  const key = `${shape}:${size}`;
  const cached = glyphCache.get(key);
  if (cached) return cached;
  const { canvas, ctx } = canvasOf(size, size);
  drawGlyph(ctx, shape, size);
  const texture = Texture.from(canvas);
  glyphCache.set(key, texture);
  return texture;
}
