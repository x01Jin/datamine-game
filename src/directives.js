import { CONFIG, dataInfo, fmt, tierLabel } from './gamedata.js';

const MAX_DIRECTIVE_TIER = 8;

const BUILDERS = [
  { kind: 'bank', weight: 3, build: buildBank },
  { kind: 'uptime', weight: 2, build: buildUptime },
  { kind: 'types', weight: 2, build: buildTypes },
  { kind: 'fleet', weight: 2, build: buildFleet },
  { kind: 'depth', weight: 2, build: buildDepth },
];

function directiveMetric(state, directive) {
  switch (directive.kind) {
    case 'bank':
      return state.stats.bankedByTier?.[directive.tier] || 0;
    case 'uptime':
      return state.stats.uptime?.[directive.tier] || 0;
    case 'types': {
      let count = 0;
      for (const amount of Object.values(state.stats.bankedByTier || {})) {
        if (amount > 0) count++;
      }
      return count;
    }
    case 'fleet':
      return state.nodes.filter((node) => node.kind !== 'vault').length;
    case 'depth':
      return state.stats.deepestTier || 0;
    default:
      return 0;
  }
}

export function directiveProgress(state, directive) {
  return Math.max(0, directiveMetric(state, directive) - (directive.base || 0));
}

export function directiveComplete(state, directive) {
  return directiveProgress(state, directive) >= directive.goal;
}

export function generateDirective(state, taken = []) {
  for (let attempt = 0; attempt < 16; attempt++) {
    const builder = weightedPick(BUILDERS.filter((entry) => entry.kind !== 'uptime' || state.unlockedTier >= 1));
    const directive = builder.build(state);
    if (!directive) continue;
    const clash = taken.some((other) => other.kind === directive.kind && other.tier === directive.tier);
    if (!clash) return sealDirective(state, directive);
  }
  return sealDirective(state, buildBank(state));
}

export function generateDirectives(state, count = CONFIG.directiveCount) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push(generateDirective(state, list));
  }
  return list;
}

export function normalizeDirectives(list, state) {
  const clean = [];
  const seen = new Set();
  if (Array.isArray(list)) {
    for (const raw of list) {
      if (clean.length >= CONFIG.directiveCount) break;
      const directive = sanitize(raw);
      if (!directive) continue;
      const key = `${directive.kind}:${directive.tier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      clean.push(directive);
    }
  }
  while (clean.length < CONFIG.directiveCount) {
    const directive = generateDirective(state, clean);
    const key = `${directive.kind}:${directive.tier}`;
    if (seen.has(key)) break;
    seen.add(key);
    clean.push(directive);
  }
  return clean;
}

function sanitize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind;
  if (!BUILDERS.some((entry) => entry.kind === kind)) return null;
  const tier = Number.isInteger(raw.tier) ? raw.tier : 0;
  const goal = Number.isFinite(raw.goal) && raw.goal > 0 ? raw.goal : 1;
  const base = Number.isFinite(raw.base) ? raw.base : 0;
  return {
    kind,
    tier,
    goal,
    base,
    title: typeof raw.title === 'string' ? raw.title : kind,
    brief: typeof raw.brief === 'string' ? raw.brief : '',
    reward: {
      tier: Number.isInteger(raw.reward?.tier) ? raw.reward.tier : 0,
      amount: Number.isFinite(raw.reward?.amount) ? raw.reward.amount : 0,
    },
    cores: Number.isFinite(raw.cores) ? Math.max(0, Math.floor(raw.cores)) : 0,
  };
}

function sealDirective(state, directive) {
  return {
    ...directive,
    base: directiveMetric(state, directive),
  };
}

function weightedPick(entries) {
  let total = 0;
  for (const entry of entries) total += entry.weight;
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}

function pickTier(state, taken, kind, maxTier, minTier = 0) {
  const options = [];
  for (let tier = minTier; tier <= maxTier; tier++) {
    if (taken.some((other) => other.kind === kind && other.tier === tier)) continue;
    options.push(tier);
  }
  if (options.length === 0) return Math.min(maxTier, Math.max(minTier, state.unlockedTier));
  const bias = options.indexOf(Math.min(maxTier, state.unlockedTier));
  const index = bias >= 0 && Math.random() < 0.5
    ? bias
    : Math.floor(Math.random() * options.length);
  return options[index];
}

function buildBank(state) {
  const tier = pickTier(state, [], 'bank', Math.min(state.unlockedTier, MAX_DIRECTIVE_TIER));
  const goal = Math.ceil(6 * Math.pow(1.75, tier));
  const info = dataInfo(tier);
  return {
    kind: 'bank',
    tier,
    goal,
    title: `Salvage ${info.name}`,
    brief: `Bank ${fmt(goal)} ${info.name}.`,
    reward: { tier: Math.max(0, tier - 1), amount: Math.ceil(goal * 2) },
    cores: 0,
  };
}

function buildUptime(state) {
  const tier = pickTier(state, [], 'uptime', Math.min(state.unlockedTier, MAX_DIRECTIVE_TIER), 1);
  const goal = 40 + tier * 25;
  const info = dataInfo(tier);
  return {
    kind: 'uptime',
    tier,
    goal,
    title: `Steady hand on ${info.name}`,
    brief: `Keep a ${info.name} forge above 95% load for ${goal}s.`,
    reward: { tier: Math.max(0, tier - 1), amount: 8 + tier * 6 },
    cores: tier >= 4 ? 1 : 0,
  };
}

function buildTypes(state) {
  const goal = 2;
  return {
    kind: 'types',
    tier: 0,
    goal,
    title: 'Broad spectrum',
    brief: `Bank units of ${goal} new signal types.`,
    reward: { tier: 0, amount: 30 },
    cores: 0,
  };
}

function buildFleet(state) {
  const fleet = state.nodes.filter((node) => node.kind !== 'vault').length;
  const goal = Math.max(3, Math.ceil(fleet * 0.6) + 2);
  return {
    kind: 'fleet',
    tier: 0,
    goal,
    title: 'Expand the floor',
    brief: `Run ${goal} machines at once.`,
    reward: { tier: 0, amount: 24 + goal * 5 },
    cores: 0,
  };
}

function buildDepth(state) {
  const deepest = state.stats.deepestTier || 0;
  const goal = deepest < 4 ? 1 : 2;
  const target = Math.min(CONFIG.maxTier, deepest + goal);
  return {
    kind: 'depth',
    tier: target,
    goal,
    title: 'Deeper strata',
    brief: `Reach tier ${tierLabel(target)} in the archive.`,
    reward: { tier: Math.max(0, target - 1), amount: 6 + goal * 4 },
    cores: 1,
  };
}
