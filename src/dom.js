import { dataInfo, recipeFor } from './gamedata.js';

export const STATUS_TEXT = {
  running: 'Running',
  limited: 'Limited',
  starved: 'Starved',
  blocked: 'Blocked',
  idle: 'Idle',
  receiving: 'Receiving',
};

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function shortName(name) {
  if (name.length <= 13) return name;
  const parts = name.split(' ');
  const tail = parts[parts.length - 1];
  const head = parts.slice(0, 2).join(' ');
  return /^\d+$/.test(tail) ? `${head} ${tail}` : head;
}

export function pct(value, max) {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(100, value / max * 100));
}

export function recipeHtml(tier) {
  const recipe = recipeFor(tier);
  const info = dataInfo(tier);
  const inputs = recipe.inputs.map((input) => {
    const inputInfo = dataInfo(input.tier);
    return `<span class="t" style="color:${inputInfo.color}">${input.amount}× ${escapeHtml(inputInfo.name)}</span>`;
  }).join('<span class="arrow">+</span>');
  return `${inputs}<span class="arrow">→</span><span class="out" style="color:${info.color}">${recipe.output.amount}× ${escapeHtml(info.name)}</span>`;
}
