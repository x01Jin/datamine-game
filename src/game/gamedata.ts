import { hex, tierBright, tierColor, tierDim, tierFaint, tierSoft } from './palette.ts';
import type { CoreUpgrade, Cost, MachineNode, NodeKind, Priority, Recipe, State, TierInfo } from './types.ts';

export const CONFIG = Object.freeze({
  extractorRate: 2,
  extractorBaseCost: 8,
  extractorCostGrowth: 1.45,
  processorCycle: 2,
  processorBaseCost: 10,
  processorTierGrowth: 1.62,
  processorCopyGrowth: 1.55,
  upgradeBase: 6,
  upgradeGrowth: 2,
  speedGrowth: 1.5,
  bufferSeconds: 8,
  globalGrowth: 1.22,
  startRaw: 6,
  offlineCap: 8 * 60 * 60,
  maxTier: 1024,
  maxLevel: 200,
  maxNodes: 500,
  maxLinks: 1500,
  directiveCount: 3,
  coreSpeedPerRank: 0.08,
  reservoirSecondsPerRank: 1.5,
  ledgerBonusPerRank: 0.25,
  surveyHoursPerRank: 1,
  deepScanTier: 6,
  deepScanBase: 2,
  deepScanTierRate: 0.6,
  deepScanBankRate: 1.5,
  zoomMin: 0.35,
  zoomMax: 2.2,
});

export const CORE_UPGRADES: CoreUpgrade[] = [
  {
    id: 'momentum',
    name: 'Momentum',
    effect: 'Every machine runs 8% faster per rank.',
    baseCost: 1,
    growth: 1.4,
    max: 40,
  },
  {
    id: 'reservoir',
    name: 'Reservoir',
    effect: 'Buffers hold 1.5s more per rank.',
    baseCost: 2,
    growth: 1.7,
    max: 12,
  },
  {
    id: 'ledger',
    name: 'Ledger',
    effect: 'Directive rewards are 25% richer per rank.',
    baseCost: 2,
    growth: 1.8,
    max: 12,
  },
  {
    id: 'survey',
    name: 'Deep Survey',
    effect: 'Offline catch-up runs one hour longer per rank.',
    baseCost: 3,
    growth: 2,
    max: 8,
  },
];

const CURATED = [
  'Raw Noise',
  'Clean Bits',
  'Signals',
  'Patterns',
  'Context',
  'Insights',
  'Models',
  'Cognition',
  'Emergence',
  'Singularity',
];

const PREFIXES = [
  'Latent',
  'Fractal',
  'Synthetic',
  'Recursive',
  'Quantum',
  'Spectral',
  'Crystalline',
  'Neural',
  'Phantom',
  'Hyper',
  'Entropic',
  'Harmonic',
  'Encrypted',
  'Sentient',
  'Parallel',
  'Hollow',
  'Obsidian',
  'Lucid',
  'Pale',
  'Orbital',
  'Resonant',
  'Feral',
  'Dormant',
  'Drifting',
];

const CORES = [
  'Signal',
  'Pattern',
  'Lattice',
  'Vector',
  'Memory',
  'Concept',
  'Schema',
  'Cipher',
  'Nexus',
  'Archive',
  'Kernel',
  'Domain',
  'Relay',
  'Prism',
  'Echo',
  'Thread',
  'Current',
  'Index',
  'Membrane',
  'Cluster',
  'Protocol',
  'Glyph',
  'Field',
  'Fold',
];

const SHAPES = ['square', 'diamond', 'circle', 'hex', 'triangle', 'ring', 'bars', 'cross'];

const INFO = new Map<number, TierInfo>();

export function dataInfo(tier: number): TierInfo {
  const cached = INFO.get(tier);
  if (cached) return cached;
  let name: string;
  if (tier < CURATED.length) {
    name = CURATED[tier];
  } else {
    const i = tier - CURATED.length;
    const prefix = PREFIXES[(i * 7 + 3) % PREFIXES.length];
    const core = CORES[(i * 11 + 5) % CORES.length];
    name = `${prefix} ${core} ${tier}`;
  }
  const info: TierInfo = {
    tier,
    name,
    shape: SHAPES[tier % SHAPES.length],
    color: hex(tierColor(tier)),
    bright: hex(tierBright(tier)),
    dim: hex(tierDim(tier)),
    soft: hex(tierSoft(tier)),
    faint: hex(tierFaint(tier)),
  };
  INFO.set(tier, info);
  return info;
}

const RECIPES = new Map<number, Recipe>();

export function recipeFor(tier: number): Recipe | null {
  if (tier < 1) return null;
  const cached = RECIPES.get(tier);
  if (cached) return cached;
  const inputs =
    tier === 1
      ? [{ tier: 0, amount: 2 }]
      : [
          { tier: tier - 1, amount: 1 },
          { tier: tier - 2, amount: 1 },
        ];
  const recipe: Recipe = {
    tier,
    cycle: CONFIG.processorCycle,
    inputs,
    output: { tier, amount: 1 },
  };
  RECIPES.set(tier, recipe);
  return recipe;
}

export function extractorCost(owned: number): Cost {
  return {
    tier: 0,
    amount: Math.ceil(CONFIG.extractorBaseCost * Math.pow(CONFIG.extractorCostGrowth, owned)),
  };
}

export function processorCost(tier: number | null, owned: number): Cost {
  const target = tier ?? 0;
  return {
    tier: Math.max(0, target - 1),
    amount: Math.ceil(
      CONFIG.processorBaseCost *
        Math.pow(CONFIG.processorTierGrowth, target - 1) *
        Math.pow(CONFIG.processorCopyGrowth, owned),
    ),
  };
}

export interface UpgradeTarget {
  kind: NodeKind;
  level: number;
  tier?: number;
}

export function upgradeCost(node: UpgradeTarget): Cost {
  const tier = node.kind === 'extractor' ? 0 : (node.tier as number);
  return {
    tier,
    amount: Math.ceil(CONFIG.upgradeBase * Math.pow(CONFIG.upgradeGrowth, node.level - 1)),
  };
}

export function levelSpeed(level: number): number {
  return Math.pow(CONFIG.speedGrowth, Math.max(0, level - 1));
}

export function globalSpeed(unlockedTier: number): number {
  return Math.pow(CONFIG.globalGrowth, Math.max(0, unlockedTier - 1));
}

function coreSpeed(state: State): number {
  const rank = state.coreRanks?.momentum || 0;
  return 1 + rank * CONFIG.coreSpeedPerRank;
}

function reservoirSeconds(state: State): number {
  const rank = state.coreRanks?.reservoir || 0;
  return CONFIG.bufferSeconds + rank * CONFIG.reservoirSecondsPerRank;
}

export function ledgerBonus(state: State): number {
  const rank = state.coreRanks?.ledger || 0;
  return 1 + rank * CONFIG.ledgerBonusPerRank;
}

export function offlineCap(state: State): number {
  const rank = state.coreRanks?.survey || 0;
  return CONFIG.offlineCap + rank * CONFIG.surveyHoursPerRank * 60 * 60;
}

export function speedOf(state: State, node: MachineNode): number {
  return levelSpeed(node.level) * globalSpeed(state.unlockedTier) * coreSpeed(state);
}

export function bufferCap(state: State, node: MachineNode): number {
  return reservoirSeconds(state) * speedOf(state, node);
}

export function coreUpgradeCost(upgrade: CoreUpgrade, rank: number): number {
  return Math.ceil(upgrade.baseCost * Math.pow(upgrade.growth, rank));
}

export function deepScanReward(state: State): number {
  const tier = state.stats.deepestTier || 0;
  const banked = state.stats.totalBanked || 0;
  return Math.max(
    1,
    Math.floor(
      CONFIG.deepScanBase + tier * CONFIG.deepScanTierRate + Math.log10(1 + banked) * CONFIG.deepScanBankRate,
    ),
  );
}

export function nominalRate(state: State, node: MachineNode): number {
  const speed = speedOf(state, node);
  if (node.kind === 'extractor') return CONFIG.extractorRate * speed;
  if (node.kind === 'processor') return speed / CONFIG.processorCycle;
  return 0;
}

const SUFFIXES = [
  '',
  'k',
  'M',
  'B',
  'T',
  'Qa',
  'Qi',
  'Sx',
  'Sp',
  'Oc',
  'No',
  'Dc',
  'UDc',
  'DDc',
  'TDc',
  'QaDc',
  'QiDc',
  'SxDc',
  'SpDc',
  'OcDc',
  'NoDc',
  'Vg',
];

export function fmt(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  if (value < 0) return '-' + fmt(-value);
  if (value < 1) return value === 0 ? '0' : value.toFixed(2);
  if (value < 10) return trimZero(value.toFixed(1));
  if (value < 1000) return Math.floor(value).toString();
  let magnitude = Math.floor(Math.log10(value) / 3);
  if (magnitude >= SUFFIXES.length) {
    return value.toExponential(2).replace('e+', 'e');
  }
  let scaled = value / Math.pow(1000, magnitude);
  let digits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  let rounded = scaled.toFixed(digits);
  if (Number(rounded) >= 1000 && magnitude + 1 < SUFFIXES.length) {
    magnitude += 1;
    scaled = value / Math.pow(1000, magnitude);
    digits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
    rounded = scaled.toFixed(digits);
  }
  return trimZero(rounded) + SUFFIXES[magnitude];
}

export function fmtRate(value: number): string {
  if (!Number.isFinite(value)) return '∞/s';
  if (value > 0 && value < 0.01) return '<0.01/s';
  return fmt(value) + '/s';
}

function trimZero(text: string): string {
  return text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function tierLabel(tier: number): string {
  return `T${String(tier).padStart(2, '0')}`;
}

export function costText(cost: Cost): string {
  return `${fmt(cost.amount)} ${dataInfo(cost.tier).name}`;
}

export function normalizePriority(value: unknown, fallback: Priority = 1): Priority {
  if (value === 0.5 || value === 2) return value;
  return fallback;
}
