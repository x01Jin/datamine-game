import { dataInfo } from './gamedata.js';

const GLYPHS = {
  square: '<rect x="4" y="4" width="8" height="8"/>',
  diamond: '<path d="M8 1.8 14.2 8 8 14.2 1.8 8Z"/>',
  circle: '<circle cx="8" cy="8" r="5.3"/>',
  hex: '<path d="M8 1.6 13.6 4.8v6.4L8 14.4 2.4 11.2V4.8Z"/>',
  triangle: '<path d="M8 2 14 13H2Z"/>',
  ring: '<circle cx="8" cy="8" r="4.6" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  bars: '<rect x="3.5" y="2.5" width="3.2" height="11"/><rect x="9.3" y="2.5" width="3.2" height="11"/>',
  cross: '<path d="M6.6 2h2.8v4.6H14v2.8H9.4V14H6.6V9.4H2V6.6h4.6Z"/>',
};

export function glyphSvg(tier) {
  const shape = dataInfo(tier).shape;
  return `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${GLYPHS[shape] || GLYPHS.square}</svg>`;
}
