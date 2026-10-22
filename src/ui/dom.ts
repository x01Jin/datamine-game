import { dataInfo, recipeFor } from '../game/gamedata.ts';
import { hex, tierBright, tierColor, tierDim, tierSoft } from '../game/palette.ts';

export const STATUS_TEXT: Record<string, string> = {
  running: 'Running',
  limited: 'Limited',
  starved: 'Starved',
  blocked: 'Blocked',
  idle: 'Idle',
  receiving: 'Receiving',
};

export function escapeHtml(value: string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function shortName(name: string): string {
  if (name.length <= 13) return name;
  const parts = name.split(' ');
  const tail = parts[parts.length - 1];
  const head = parts.slice(0, 2).join(' ');
  return /^\d+$/.test(tail) ? `${head} ${tail}` : head;
}

export function pct(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

export function sortedBy<T>(values: readonly T[], compare: (a: T, b: T) => number): T[] {
  const out = values.slice();
  for (let i = 1; i < out.length; i++) {
    const item = out[i];
    let j = i - 1;
    while (j >= 0 && compare(out[j], item) > 0) {
      out[j + 1] = out[j];
      j--;
    }
    out[j + 1] = item;
  }
  return out;
}

export function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setText(node: HTMLElement | null | undefined, text: string): void {
  if (node && node.textContent !== text) node.textContent = text;
}

export function tierHex(tier: number): string {
  return hex(tierColor(tier));
}

export function tierVars(target: HTMLElement, tier: number): void {
  target.style.setProperty('--tier', hex(tierColor(tier)));
  target.style.setProperty('--tier-bright', hex(tierBright(tier)));
  target.style.setProperty('--tier-dim', hex(tierDim(tier)));
  target.style.setProperty('--tier-soft', hex(tierSoft(tier)));
}

const GLYPHS: Record<string, string> = {
  square: '<rect x="4" y="4" width="8" height="8"/>',
  diamond: '<path d="M8 1.8 14.2 8 8 14.2 1.8 8Z"/>',
  circle: '<circle cx="8" cy="8" r="5.3"/>',
  hex: '<path d="M8 1.6 13.6 4.8v6.4L8 14.4 2.4 11.2V4.8Z"/>',
  triangle: '<path d="M8 2 14 13H2Z"/>',
  ring: '<circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  bars: '<rect x="3.5" y="2.5" width="3.2" height="11"/><rect x="9.3" y="2.5" width="3.2" height="11"/>',
  cross: '<path d="M6.6 2h2.8v4.6H14v2.8H9.4V14H6.6V9.4H2V6.6h4.6Z"/>',
};

export function glyphSvg(tier: number): string {
  const shape = dataInfo(tier).shape;
  const markup = GLYPHS[shape] ?? GLYPHS.square;
  return `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${markup}</svg>`;
}

export function recipeMarkup(tier: number): string {
  const recipe = recipeFor(tier);
  if (!recipe) return '';
  const inputs = recipe.inputs
    .map((input) => {
      const info = dataInfo(input.tier);
      return `<span class="r-in" style="color:${tierHex(input.tier)}">${input.amount}× ${escapeHtml(info.name)}</span>`;
    })
    .join('<span class="r-op">+</span>');
  const output = `<span class="r-out" style="color:${tierHex(tier)}">${recipe.output.amount}× ${escapeHtml(dataInfo(tier).name)}</span>`;
  return `${inputs}<span class="r-op">→</span>${output}`;
}

export function statusLabel(status: string): string {
  return STATUS_TEXT[status] ?? status;
}
