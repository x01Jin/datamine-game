import { CONFIG, recipeFor, offlineCap, normalizePriority } from './gamedata.js';
import { normalizeDirectives, generateDirectives } from './directives.js';

export const SAVE_KEY = 'datamine.save.v1';
export const SAVE_VERSION = 1;
const MAX_ID = 1e12;
const MAX_AMOUNT = 1e100;
const MAX_ANCHORS = 24;

export function createInitialState(vertical = false) {
  const extractorX = vertical ? 0 : -216;
  const extractorY = vertical ? -192 : 0;
  const vaultX = vertical ? 0 : 216;
  const vaultY = vertical ? 192 : 0;
  const state = {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    savedAt: Date.now(),
    nextId: 3,
    nodes: [
      {
        id: 1,
        kind: 'extractor',
        x: extractorX,
        y: extractorY,
        level: 1,
        out: { tier: 0, amount: 0 },
        invested: {},
      },
      {
        id: 2,
        kind: 'vault',
        x: vaultX,
        y: vaultY,
        level: 1,
        invested: {},
      },
    ],
    links: [],
    bank: { 0: CONFIG.startRaw },
    unlockedTier: 1,
    cores: 0,
    coreRanks: { momentum: 0, reservoir: 0, ledger: 0, survey: 0 },
    directives: [],
    stats: {
      totalBanked: 0,
      deepestTier: 0,
      built: 0,
      playTime: 0,
      bankedByTier: {},
      uptime: {},
      scans: 0,
      bestDeepest: 0,
    },
    camera: { x: -10, y: 0, zoom: 1 },
    muted: false,
    motion: true,
    snapGrid: true,
    hintDismissed: false,
  };
  state.directives = generateDirectives(state);
  return state;
}

export function makeProcessor(id, tier, x, y) {
  const recipe = recipeFor(tier);
  const inputs = {};
  for (const input of recipe.inputs) inputs[input.tier] = 0;
  return {
    id,
    kind: 'processor',
    tier,
    x,
    y,
    level: 1,
    inputs,
    out: { tier, amount: 0 },
    invested: {},
  };
}

export function addInvested(node, cost) {
  node.invested = node.invested || {};
  node.invested[cost.tier] = (node.invested[cost.tier] || 0) + cost.amount;
}

export function nodeById(state, id) {
  return state.nodes.find((node) => node.id === id) || null;
}

export function linkById(state, id) {
  return state.links.find((link) => link.id === id) || null;
}

function snapshot(state) {
  return {
    version: SAVE_VERSION,
    createdAt: state.createdAt,
    savedAt: Date.now(),
    nextId: state.nextId,
    nodes: state.nodes.map((node) => {
      const base = {
        id: node.id,
        kind: node.kind,
        x: node.x,
        y: node.y,
        level: node.level,
        invested: { ...node.invested },
      };
      if (node.kind === 'processor') {
        base.tier = node.tier;
        base.inputs = { ...node.inputs };
        base.out = { ...node.out };
      } else if (node.kind === 'extractor') {
        base.out = { ...node.out };
      }
      return base;
    }),
    links: state.links.map((link) => ({
      id: link.id,
      from: link.from,
      to: link.to,
      tier: link.tier,
      priority: normalizePriority(link.priority),
      side: link.side || null,
      anchors: (link.anchors || []).map((anchor) => ({ x: anchor.x, y: anchor.y })),
    })),
    bank: { ...state.bank },
    unlockedTier: state.unlockedTier,
    cores: state.cores || 0,
    coreRanks: { ...state.coreRanks },
    directives: (state.directives || []).map((directive) => ({ ...directive })),
    stats: {
      ...state.stats,
      bankedByTier: { ...(state.stats.bankedByTier || {}) },
      uptime: { ...(state.stats.uptime || {}) },
    },
    camera: { ...state.camera },
    muted: state.muted,
    motion: state.motion,
    snapGrid: state.snapGrid !== false,
    hintDismissed: state.hintDismissed,
  };
}

export function serialize(state) {
  return JSON.stringify(snapshot(state));
}

export function saveGame(state) {
  try {
    const clean = snapshot(state);
    localStorage.setItem(SAVE_KEY, JSON.stringify(clean));
    return clean.savedAt;
  } catch {
    return 0;
  }
}

export function loadGame() {
  let raw;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return { state: createInitialState(), fresh: true, elapsed: 0, error: null };
  }
  if (!raw) return { state: createInitialState(), fresh: true, elapsed: 0, error: null };

  try {
    const parsed = JSON.parse(raw);
    const state = normalize(parsed);
    const elapsed = Math.max(0, Math.min(offlineCap(state), (Date.now() - (state.savedAt || Date.now())) / 1000));
    return { state, fresh: false, elapsed, error: null };
  } catch (error) {
    return {
      state: createInitialState(),
      fresh: true,
      elapsed: 0,
      error: error instanceof Error ? error.message : 'Save could not be read',
    };
  }
}

export function importGame(text) {
  const parsed = JSON.parse(text);
  const state = normalize(parsed);
  state.savedAt = Date.now();
  return state;
}

function normalize(data) {
  if (!data || typeof data !== 'object') throw new Error('Empty save');
  if (!Array.isArray(data.nodes) || data.nodes.length === 0) throw new Error('Save has no machines');
  if (!Array.isArray(data.links)) throw new Error('Save has no link table');

  const state = {
    version: SAVE_VERSION,
    createdAt: finite(data.createdAt, Date.now()),
    savedAt: finite(data.savedAt, Date.now()),
    nextId: 1,
    nodes: [],
    links: [],
    bank: {},
    unlockedTier: clamp(Math.floor(finite(data.unlockedTier, 1)), 1, CONFIG.maxTier),
    cores: Math.max(0, Math.floor(finite(data.cores, 0))),
    coreRanks: {
      momentum: 0,
      reservoir: 0,
      ledger: 0,
      survey: 0,
    },
    directives: [],
    stats: {
      totalBanked: Math.max(0, finite(data.stats?.totalBanked, 0)),
      deepestTier: clamp(Math.floor(finite(data.stats?.deepestTier, 0)), 0, CONFIG.maxTier),
      built: Math.max(0, Math.floor(finite(data.stats?.built, 0))),
      playTime: Math.max(0, finite(data.stats?.playTime, 0)),
      bankedByTier: {},
      uptime: {},
      scans: Math.max(0, Math.floor(finite(data.stats?.scans, 0))),
      bestDeepest: clamp(Math.floor(finite(data.stats?.bestDeepest, 0)), 0, CONFIG.maxTier),
    },
    camera: {
      x: finite(data.camera?.x, -10),
      y: finite(data.camera?.y, 0),
      zoom: clamp(finite(data.camera?.zoom, 1), 0.35, 2.2),
    },
    muted: Boolean(data.muted),
    motion: data.motion !== false,
    snapGrid: data.snapGrid !== false,
    hintDismissed: Boolean(data.hintDismissed),
  };

  for (const [rank, value] of Object.entries(data.coreRanks || {})) {
    if (rank in state.coreRanks) {
      state.coreRanks[rank] = clamp(Math.floor(finite(value, 0)), 0, 40);
    }
  }

  for (const [tier, amount] of Object.entries(data.stats?.bankedByTier || {})) {
    const t = Number(tier);
    if (Number.isInteger(t) && t >= 0 && t <= CONFIG.maxTier && Number.isFinite(amount) && amount > 0) {
      state.stats.bankedByTier[t] = Math.min(MAX_AMOUNT, amount);
    }
  }

  for (const [tier, seconds] of Object.entries(data.stats?.uptime || {})) {
    const t = Number(tier);
    if (Number.isInteger(t) && t >= 0 && t <= CONFIG.maxTier && Number.isFinite(seconds) && seconds > 0) {
      state.stats.uptime[t] = Math.min(MAX_AMOUNT, seconds);
    }
  }

  let maxId = 0;
  const seenNodes = new Set();
  for (const source of data.nodes) {
    if (state.nodes.length >= CONFIG.maxNodes) break;
    if (!source || !['extractor', 'processor', 'vault'].includes(source.kind)) continue;
    const id = Number.isSafeInteger(source.id) && source.id > 0 && source.id < MAX_ID
      ? source.id : null;
    if (id === null || seenNodes.has(id)) continue;
    const node = {
      id,
      kind: source.kind,
      x: clamp(finite(source.x, 0), -1e6, 1e6),
      y: clamp(finite(source.y, 0), -1e6, 1e6),
      level: clamp(Math.floor(finite(source.level, 1)), 1, CONFIG.maxLevel),
      invested: {},
    };
    if (source.kind === 'processor') {
      const tier = Math.floor(finite(source.tier, 1));
      if (tier < 1 || tier > state.unlockedTier || tier > CONFIG.maxTier) continue;
      node.tier = tier;
      const recipe = recipeFor(node.tier);
      node.out = { tier: node.tier, amount: Math.min(MAX_AMOUNT, Math.max(0, finite(source.out?.amount, 0))) };
      node.inputs = {};
      for (const input of recipe.inputs) {
        node.inputs[input.tier] = Math.min(MAX_AMOUNT, Math.max(0, finite(source.inputs?.[input.tier], 0)));
      }
    } else if (source.kind === 'extractor') {
      node.out = { tier: 0, amount: Math.min(MAX_AMOUNT, Math.max(0, finite(source.out?.amount, 0))) };
    }
    if (source.invested && typeof source.invested === 'object') {
      for (const [tier, amount] of Object.entries(source.invested)) {
        const t = Number(tier);
        if (Number.isInteger(t) && t >= 0 && t <= CONFIG.maxTier && Number.isFinite(amount) && amount > 0) {
          node.invested[t] = Math.min(MAX_AMOUNT, amount);
        }
      }
    }
    seenNodes.add(node.id);
    maxId = Math.max(maxId, node.id);
    state.nodes.push(node);
  }

  const nodeIndex = new Map(state.nodes.map((node) => [node.id, node]));
  if (!state.nodes.some((node) => node.kind === 'extractor')) throw new Error('Save has no extractor');
  if (!state.nodes.some((node) => node.kind === 'vault')) throw new Error('Save has no vault');

  const seenLinks = new Set();
  const seenRoutes = new Set();
  for (const source of data.links) {
    if (state.links.length >= CONFIG.maxLinks) break;
    if (!source) continue;
    const id = Number.isSafeInteger(source.id) && source.id > 0 && source.id < MAX_ID
      ? source.id : null;
    if (id === null || seenLinks.has(id)) continue;
    const from = nodeIndex.get(source.from);
    const to = nodeIndex.get(source.to);
    if (!from || !to || from.kind === 'vault') continue;
    if (!from.out || from.out.tier !== source.tier) continue;
    if (to.kind === 'processor' && to.inputs[source.tier] === undefined) continue;
    if (to.kind !== 'processor' && to.kind !== 'vault') continue;
    const route = `${from.id}>${to.id}:${from.out.tier}`;
    if (seenRoutes.has(route)) continue;
    const side = to.kind === 'vault' && ['n', 's', 'e', 'w'].includes(source.side) ? source.side : null;
    const link = {
      id,
      from: from.id,
      to: to.id,
      tier: from.out.tier,
      priority: normalizePriority(source.priority, to.kind === 'vault' ? 0.5 : 1),
      side,
      anchors: normalizeAnchors(source.anchors),
    };
    seenLinks.add(link.id);
    seenRoutes.add(route);
    maxId = Math.max(maxId, link.id);
    state.links.push(link);
  }

  if (data.bank && typeof data.bank === 'object') {
    for (const [tier, amount] of Object.entries(data.bank)) {
      const t = Number(tier);
      if (Number.isInteger(t) && t >= 0 && t <= state.unlockedTier && Number.isFinite(amount) && amount > 0) {
        state.bank[t] = Math.min(MAX_AMOUNT, amount);
      }
    }
  }
  const requestedNext = Number.isSafeInteger(data.nextId) && data.nextId > 0
    ? Math.min(data.nextId, MAX_ID) : 1;
  state.nextId = Math.min(MAX_ID, Math.max(maxId + 1, requestedNext));
  state.directives = normalizeDirectives(data.directives, state);
  return state;
}

function normalizeAnchors(list) {
  if (!Array.isArray(list)) return [];
  const anchors = [];
  for (const anchor of list) {
    if (anchors.length >= MAX_ANCHORS) break;
    if (!anchor || typeof anchor !== 'object') continue;
    const x = finite(anchor.x, null);
    const y = finite(anchor.y, null);
    if (x === null || y === null) continue;
    anchors.push({ x: clamp(x, -1e6, 1e6), y: clamp(y, -1e6, 1e6) });
  }
  return anchors;
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function processorCopyCount(state, tier) {
  let count = 0;
  for (const node of state.nodes) {
    if (node.kind === 'processor' && node.tier === tier) count++;
  }
  return count;
}
