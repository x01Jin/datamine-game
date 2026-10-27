import { CONFIG, recipeFor, offlineCap, normalizePriority } from './gamedata.ts';
import { normalizeDirectives, generateDirectives } from './directives.ts';
import { MAX_ANCHORS, SAVE_KEY, SAVE_VERSION } from './types.ts';
import type {
  Cost,
  Directive,
  ExtractorNode,
  Face,
  Invested,
  Link,
  MachineNode,
  Point,
  Price,
  ProcessorNode,
  Rot,
  SaveState,
  State,
  VaultNode,
} from './types.ts';

export { SAVE_KEY, SAVE_VERSION };

const MAX_ID = 1e12;
const MAX_AMOUNT = 1e100;

export function createInitialState(vertical = false): State {
  const extractorX = vertical ? 0 : -216;
  const extractorY = vertical ? -192 : 0;
  const vaultX = vertical ? 0 : 216;
  const vaultY = vertical ? 192 : 0;
  const nodes: MachineNode[] = [
    {
      id: 1,
      kind: 'extractor',
      rot: 0,
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
  ];
  const state: State = {
    version: SAVE_VERSION,
    createdAt: Date.now(),
    savedAt: Date.now(),
    nextId: 3,
    nodes,
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

export function makeExtractor(id: number, x: number, y: number, rot: Rot = 0): ExtractorNode {
  return {
    id,
    kind: 'extractor',
    rot,
    x,
    y,
    level: 1,
    out: { tier: 0, amount: 0 },
    invested: {},
  };
}

export function makeProcessor(id: number, tier: number, x: number, y: number, rot: Rot = 0): ProcessorNode {
  const recipe = recipeFor(tier);
  const inputs: { [tier: number]: number } = {};
  for (const input of recipe?.inputs ?? []) inputs[input.tier] = 0;
  return {
    id,
    kind: 'processor',
    tier,
    rot,
    x,
    y,
    level: 1,
    inputs,
    out: { tier, amount: 0 },
    invested: {},
  };
}

export function addInvested(node: MachineNode, cost: Cost | Price): void {
  node.invested = node.invested || {};
  for (const line of Array.isArray(cost) ? cost : [cost]) {
    node.invested[line.tier] = (node.invested[line.tier] || 0) + line.amount;
  }
}

export function nodeById(state: State, id: number): MachineNode | null {
  return state.nodes.find((node) => node.id === id) || null;
}

export function linkById(state: State, id: number): Link | null {
  return state.links.find((link) => link.id === id) || null;
}

interface SnapshotNode {
  id: number;
  kind: MachineNode['kind'];
  x: number;
  y: number;
  level: number;
  invested: Invested;
  tier?: number;
  rot?: Rot;
  inputs?: { [tier: number]: number };
  out?: { tier: number; amount: number };
}

function snapshot(state: State) {
  return {
    version: SAVE_VERSION,
    createdAt: state.createdAt,
    savedAt: Date.now(),
    nextId: state.nextId,
    nodes: state.nodes.map((node): SnapshotNode => {
      const base: SnapshotNode = {
        id: node.id,
        kind: node.kind,
        x: node.x,
        y: node.y,
        level: node.level,
        invested: { ...node.invested },
      };
      if (node.kind === 'processor') {
        base.tier = node.tier;
        base.rot = node.rot ?? 0;
        base.inputs = { ...node.inputs };
        base.out = { ...node.out };
      } else if (node.kind === 'extractor') {
        base.rot = node.rot ?? 0;
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
    directives: (state.directives || []).map((directive: Directive) => Object.assign({}, directive)),
    stats: {
      ...state.stats,
      bankedByTier: { ...state.stats.bankedByTier },
      uptime: { ...state.stats.uptime },
    },
    camera: { ...state.camera },
    muted: state.muted,
    motion: state.motion,
    snapGrid: state.snapGrid !== false,
    hintDismissed: state.hintDismissed,
  };
}

export function serialize(state: State): string {
  return JSON.stringify(snapshot(state));
}

export function saveGame(state: State): number {
  try {
    const clean = snapshot(state);
    localStorage.setItem(SAVE_KEY, JSON.stringify(clean));
    return clean.savedAt;
  } catch {
    return 0;
  }
}

export function loadGame(): SaveState {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return { state: createInitialState(), fresh: true, elapsed: 0, error: null };
  }
  if (!raw) return { state: createInitialState(), fresh: true, elapsed: 0, error: null };

  try {
    const parsed: unknown = JSON.parse(raw);
    const state = normalize(parsed);
    const elapsed = Math.max(
      0,
      Math.min(offlineCap(state), (Date.now() - (state.savedAt || Date.now())) / 1000),
    );
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

export function importGame(text: string): State {
  const parsed: unknown = JSON.parse(text);
  const state = normalize(parsed);
  state.savedAt = Date.now();
  return state;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isFace(value: unknown): value is Face {
  return value === 'n' || value === 's' || value === 'e' || value === 'w';
}

function normalizeRot(value: unknown): Rot {
  const raw = finite(value, 0);
  if (!Number.isFinite(raw)) return 0;
  return (((Math.floor(raw) % 4) + 4) % 4) as Rot;
}

function normalize(data: unknown): State {
  if (!data || typeof data !== 'object') throw new Error('Empty save');
  const raw = data as Record<string, unknown>;
  const version = Math.floor(finite(raw.version, 1));
  if (version > SAVE_VERSION) throw new Error('Save is from a newer version');
  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) throw new Error('Save has no machines');
  if (!Array.isArray(raw.links)) throw new Error('Save has no link table');

  const rawStats = asRecord(raw.stats);
  const state: State = {
    version: SAVE_VERSION,
    createdAt: finite(raw.createdAt, Date.now()),
    savedAt: finite(raw.savedAt, Date.now()),
    nextId: 1,
    nodes: [],
    links: [],
    bank: {},
    unlockedTier: clamp(Math.floor(finite(raw.unlockedTier, 1)), 1, CONFIG.maxTier),
    cores: Math.max(0, Math.floor(finite(raw.cores, 0))),
    coreRanks: {
      momentum: 0,
      reservoir: 0,
      ledger: 0,
      survey: 0,
    },
    directives: [],
    stats: {
      totalBanked: Math.max(0, finite(rawStats?.totalBanked, 0)),
      deepestTier: clamp(Math.floor(finite(rawStats?.deepestTier, 0)), 0, CONFIG.maxTier),
      built: Math.max(0, Math.floor(finite(rawStats?.built, 0))),
      playTime: Math.max(0, finite(rawStats?.playTime, 0)),
      bankedByTier: {},
      uptime: {},
      scans: Math.max(0, Math.floor(finite(rawStats?.scans, 0))),
      bestDeepest: clamp(Math.floor(finite(rawStats?.bestDeepest, 0)), 0, CONFIG.maxTier),
    },
    camera: {
      x: finite(asRecord(raw.camera)?.x, -10),
      y: finite(asRecord(raw.camera)?.y, 0),
      zoom: clamp(finite(asRecord(raw.camera)?.zoom, 1), CONFIG.zoomMin, CONFIG.zoomMax),
    },
    muted: Boolean(raw.muted),
    motion: raw.motion !== false,
    snapGrid: raw.snapGrid !== false,
    hintDismissed: Boolean(raw.hintDismissed),
  };

  for (const [rank, value] of Object.entries(asRecord(raw.coreRanks) ?? {})) {
    if (rank in state.coreRanks) {
      state.coreRanks[rank as keyof State['coreRanks']] = clamp(Math.floor(finite(value, 0)), 0, 40);
    }
  }

  for (const [tier, amount] of Object.entries((rawStats?.bankedByTier as Record<string, unknown>) ?? {})) {
    const t = Number(tier);
    if (Number.isInteger(t) && t >= 0 && t <= CONFIG.maxTier && isFiniteNumber(amount) && amount > 0) {
      state.stats.bankedByTier[t] = Math.min(MAX_AMOUNT, amount);
    }
  }

  for (const [tier, seconds] of Object.entries((rawStats?.uptime as Record<string, unknown>) ?? {})) {
    const t = Number(tier);
    if (Number.isInteger(t) && t >= 0 && t <= CONFIG.maxTier && isFiniteNumber(seconds) && seconds > 0) {
      state.stats.uptime[t] = Math.min(MAX_AMOUNT, seconds);
    }
  }

  let maxId = 0;
  const seenNodes = new Set<number>();
  for (const source of raw.nodes) {
    if (state.nodes.length >= CONFIG.maxNodes) break;
    const record = asRecord(source);
    if (!record) continue;
    const kind = record.kind;
    if (kind !== 'extractor' && kind !== 'processor' && kind !== 'vault') continue;
    const id = isSafeInteger(record.id) && record.id > 0 && record.id < MAX_ID ? record.id : null;
    if (id === null || seenNodes.has(id)) continue;
    const x = clamp(finite(record.x, 0), -1e6, 1e6);
    const y = clamp(finite(record.y, 0), -1e6, 1e6);
    const level = clamp(Math.floor(finite(record.level, 1)), 1, CONFIG.maxLevel);
    const invested: Invested = {};
    if (record.invested && typeof record.invested === 'object') {
      for (const [tier, amount] of Object.entries(record.invested as Record<string, unknown>)) {
        const t = Number(tier);
        if (Number.isInteger(t) && t >= 0 && t <= CONFIG.maxTier && isFiniteNumber(amount) && amount > 0) {
          invested[t] = Math.min(MAX_AMOUNT, amount);
        }
      }
    }
    let node: MachineNode;
    if (kind === 'processor') {
      const tier = Math.floor(finite(record.tier, 1));
      if (tier < 1 || tier > state.unlockedTier || tier > CONFIG.maxTier) continue;
      const recipe = recipeFor(tier);
      if (!recipe) continue;
      const inputs: { [tier: number]: number } = {};
      for (const input of recipe.inputs) {
        inputs[input.tier] = Math.min(
          MAX_AMOUNT,
          Math.max(0, finite(asRecord(record.inputs)?.[input.tier], 0)),
        );
      }
      const processor: ProcessorNode = {
        id,
        kind: 'processor',
        x,
        y,
        level,
        invested,
        tier,
        rot: normalizeRot(record.rot),
        out: { tier, amount: Math.min(MAX_AMOUNT, Math.max(0, finite(asRecord(record.out)?.amount, 0))) },
        inputs,
      };
      node = processor;
    } else if (kind === 'extractor') {
      const extractor: ExtractorNode = {
        id,
        kind: 'extractor',
        rot: normalizeRot(record.rot),
        x,
        y,
        level,
        invested,
        out: { tier: 0, amount: Math.min(MAX_AMOUNT, Math.max(0, finite(asRecord(record.out)?.amount, 0))) },
      };
      node = extractor;
    } else {
      const vault: VaultNode = {
        id,
        kind: 'vault',
        x,
        y,
        level,
        invested,
      };
      node = vault;
    }
    seenNodes.add(node.id);
    maxId = Math.max(maxId, node.id);
    state.nodes.push(node);
  }

  const nodeIndex = new Map(state.nodes.map((node) => [node.id, node]));
  if (!state.nodes.some((node) => node.kind === 'extractor')) throw new Error('Save has no extractor');
  if (!state.nodes.some((node) => node.kind === 'vault')) throw new Error('Save has no vault');

  const seenLinks = new Set<number>();
  const seenRoutes = new Set<string>();
  for (const source of raw.links) {
    if (state.links.length >= CONFIG.maxLinks) break;
    const record = asRecord(source);
    if (!record) continue;
    const id = isSafeInteger(record.id) && record.id > 0 && record.id < MAX_ID ? record.id : null;
    if (id === null || seenLinks.has(id)) continue;
    const fromId = record.from;
    const toId = record.to;
    const from = isFiniteNumber(fromId) ? nodeIndex.get(fromId) : undefined;
    const to = isFiniteNumber(toId) ? nodeIndex.get(toId) : undefined;
    if (!from || !to || from.kind === 'vault') continue;
    if (!from.out) continue;
    const tier = record.tier;
    if (!isFiniteNumber(tier) || from.out.tier !== tier) continue;
    if (to.kind === 'processor' && lookup(to.inputs, tier) === undefined) continue;
    if (to.kind !== 'processor' && to.kind !== 'vault') continue;
    const route = `${from.id}>${to.id}:${from.out.tier}`;
    if (seenRoutes.has(route)) continue;
    const side: Face | null = to.kind === 'vault' && isFace(record.side) ? record.side : null;
    const link: Link = {
      id,
      from: from.id,
      to: to.id,
      tier: from.out.tier,
      priority: normalizePriority(record.priority, to.kind === 'vault' ? 0.5 : 1),
      side,
      anchors: normalizeAnchors(record.anchors),
    };
    seenLinks.add(link.id);
    seenRoutes.add(route);
    maxId = Math.max(maxId, link.id);
    state.links.push(link);
  }

  if (raw.bank && typeof raw.bank === 'object') {
    for (const [tier, amount] of Object.entries(raw.bank as Record<string, unknown>)) {
      const t = Number(tier);
      if (Number.isInteger(t) && t >= 0 && t <= state.unlockedTier && isFiniteNumber(amount) && amount > 0) {
        state.bank[t] = Math.min(MAX_AMOUNT, amount);
      }
    }
  }
  const rawNext = raw.nextId;
  const requestedNext = isSafeInteger(rawNext) && rawNext > 0 ? Math.min(rawNext, MAX_ID) : 1;
  state.nextId = Math.min(MAX_ID, Math.max(maxId + 1, requestedNext));
  state.directives = normalizeDirectives(raw.directives, state);
  return state;
}

function normalizeAnchors(list: unknown): Point[] {
  if (!Array.isArray(list)) return [];
  const anchors: Point[] = [];
  for (const anchor of list) {
    if (anchors.length >= MAX_ANCHORS) break;
    const record = asRecord(anchor);
    if (!record) continue;
    const x = finite(record.x, null);
    const y = finite(record.y, null);
    if (x === null || y === null) continue;
    anchors.push({ x: clamp(x, -1e6, 1e6), y: clamp(y, -1e6, 1e6) });
  }
  return anchors;
}

function lookup(map: { [tier: number]: number }, key: number): number | undefined {
  return map[key] as number | undefined;
}

function finite<T>(value: unknown, fallback: T): number | T {
  return isFiniteNumber(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function processorCopyCount(state: State, tier: number): number {
  let count = 0;
  for (const node of state.nodes) {
    if (node.kind === 'processor' && node.tier === tier) count++;
  }
  return count;
}
