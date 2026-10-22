const TIER_RAMP = [
  0x5a6472, 0x4c8fa8, 0x3fb0a0, 0x5fb85a, 0x9fb84a, 0xc9a63c, 0xde8a38, 0xe0653c, 0xce4a6a, 0xf2e6cf,
];

const RAMP_SIZE = TIER_RAMP.length;

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function tierColor(tier: number): number {
  const index = ((tier % RAMP_SIZE) + RAMP_SIZE) % RAMP_SIZE;
  const cycle = Math.floor(Math.max(0, tier) / RAMP_SIZE);
  const base = TIER_RAMP[index];
  if (cycle === 0) return base;
  return mix(base, 0xffffff, Math.min(0.4, cycle * 0.13));
}

export function tierBright(tier: number): number {
  return mix(tierColor(tier), 0xffffff, 0.28);
}

export function tierDim(tier: number): number {
  return mix(tierColor(tier), 0x000000, 0.42);
}

export function tierSoft(tier: number): number {
  return mix(tierColor(tier), 0x000000, 0.82);
}

export function tierFaint(tier: number): number {
  return mix(tierColor(tier), 0x000000, 0.9);
}

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
