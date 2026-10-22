import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState,
  makeProcessor,
  serialize,
  importGame,
  addInvested,
  SAVE_VERSION,
} from '../src/game/state.ts';
import { recipeFor, CONFIG } from '../src/game/gamedata.ts';
import type { Link, ProcessorNode } from '../src/game/types.ts';

test('initial state has one extractor, one vault and starting raw', () => {
  const state = createInitialState();
  assert.equal(state.version, SAVE_VERSION);
  assert.equal(state.nodes.length, 2);
  assert.equal(state.nodes.filter((node) => node.kind === 'extractor').length, 1);
  assert.equal(state.nodes.filter((node) => node.kind === 'vault').length, 1);
  assert.equal(state.unlockedTier, 1);
  assert.deepEqual(state.links, []);
  assert.equal(state.bank[0], 6);
});

test('serialized state round-trips through import and drops transients', () => {
  const state = createInitialState();
  const processor = makeProcessor(3, 4, 40, 80);
  processor.inputs[3] = 1.25;
  processor.out.amount = 2.5;
  (processor as unknown as { _util: number })._util = 0.9;
  addInvested(processor, { tier: 3, amount: 100 });
  state.nodes.push(processor);
  state.links.push({ id: 4, from: 3, to: 2, tier: 4, _flow: 12 } as unknown as Link);
  state.bank[1] = 7;
  state.unlockedTier = 5;

  const imported = importGame(serialize(state));
  assert.equal(imported.nodes.length, 3);
  assert.equal(imported.links.length, 1);
  assert.equal(imported.bank[1], 7);
  assert.equal(imported.unlockedTier, 5);
  const node = imported.nodes.find((candidate) => candidate.id === 3) as ProcessorNode & {
    _util?: number;
  };
  assert.equal(node.tier, 4);
  assert.equal(node.inputs[3], 1.25);
  assert.equal(node.out.amount, 2.5);
  assert.equal(node._util, undefined);
  assert.equal((imported.links[0] as unknown as { _flow?: number })._flow, undefined);
  assert.equal(recipeFor(4)!.inputs.length, 2);
});

test('routes, priorities, cores and directives survive a save', () => {
  const state = createInitialState();
  state.links.push({
    id: 3,
    from: 1,
    to: 2,
    tier: 0,
    priority: 2,
    side: 'n',
    anchors: [{ x: 48, y: -24 }],
  });
  state.cores = 12;
  state.coreRanks.momentum = 3;
  state.snapGrid = false;
  state.stats.bankedByTier[0] = 400;
  state.stats.uptime[1] = 90;
  state.stats.scans = 2;

  const imported = importGame(serialize(state));
  assert.equal(imported.links[0].priority, 2);
  assert.equal(imported.links[0].side, 'n');
  assert.deepEqual(imported.links[0].anchors, [{ x: 48, y: -24 }]);
  assert.equal(imported.cores, 12);
  assert.equal(imported.coreRanks.momentum, 3);
  assert.equal(imported.snapGrid, false);
  assert.equal(imported.stats.bankedByTier[0], 400);
  assert.equal(imported.stats.uptime[1], 90);
  assert.equal(imported.stats.scans, 2);
  assert.equal(imported.directives.length, state.directives.length);
});

test('an invalid priority falls back to the default and anchors are bounded', () => {
  const state = createInitialState();
  state.links.push({
    id: 3,
    from: 1,
    to: 2,
    tier: 0,
    priority: 9,
    side: 'z',
    anchors: Array.from({ length: 40 }, (_, index) => ({ x: index, y: 0 })),
  } as unknown as Link);
  const imported = importGame(serialize(state));
  assert.equal(imported.links[0].priority, 0.5);
  assert.equal(imported.links[0].side, null);
  assert.equal(imported.links[0].anchors.length, 24);
});

test('import rejects malformed saves', () => {
  assert.throws(() => importGame('null'), /Empty save/);
  assert.throws(() => importGame('{}'), /no machines/);
  assert.throws(
    () => importGame(JSON.stringify({ nodes: [{ id: 1, kind: 'extractor' }], links: [] })),
    /no vault/,
  );
});

test('import sanitizes invalid links and restores nextId', () => {
  const state = createInitialState();
  const processor = makeProcessor(8, 2, 100, 100);
  state.nodes.push(processor);
  state.unlockedTier = 3;
  state.nextId = 9;
  const raw = JSON.parse(serialize(state));
  raw.links = [
    { id: 20, from: 1, to: 8, tier: 0 },
    { id: 21, from: 8, to: 2, tier: 2 },
    { id: 22, from: 2, to: 1, tier: 0 },
    { id: 23, from: 1, to: 8, tier: 7 },
    { id: 21, from: 8, to: 2, tier: 2 },
  ];
  raw.nodes.find((node: { id: number }) => node.id === 8).inputs = { 0: 999 };

  const imported = importGame(JSON.stringify(raw));
  assert.deepEqual(
    imported.links.map((link) => link.id),
    [20, 21],
  );
  assert.equal(imported.nextId, 22);
  assert.equal((imported.nodes.find((node) => node.id === 8) as ProcessorNode).inputs[1], 0);
});

test('import drops duplicate routes even when ids differ', () => {
  const state = createInitialState();
  state.unlockedTier = 2;
  const raw = JSON.parse(serialize(state));
  raw.links = [
    { id: 30, from: 1, to: 2, tier: 0 },
    { id: 31, from: 1, to: 2, tier: 0 },
  ];
  const imported = importGame(JSON.stringify(raw));
  assert.deepEqual(
    imported.links.map((link) => link.id),
    [30],
  );
});

test('import drops bank entries above the unlocked tier', () => {
  const state = createInitialState();
  state.unlockedTier = 2;
  const raw = JSON.parse(serialize(state));
  raw.bank = { 0: 12, 1: 5, 2: 900, 3: 4000 };
  const imported = importGame(JSON.stringify(raw));
  assert.equal(imported.bank[0], 12);
  assert.equal(imported.bank[1], 5);
  assert.equal(imported.bank[2], 900);
  assert.equal(imported.bank[3], undefined);
});

test('import caps node counts and levels', () => {
  const raw: {
    nodes: Record<string, unknown>[];
    links: Record<string, unknown>[];
    bank: Record<string, number>;
    unlockedTier: number;
    nextId: number;
  } = {
    nodes: [
      { id: 1, kind: 'extractor', x: 0, y: 0, level: 9999, out: { tier: 0, amount: 0 }, invested: {} },
      { id: 2, kind: 'vault', x: 200, y: 0, level: 1, invested: {} },
    ],
    links: [],
    bank: {},
    unlockedTier: 1,
    nextId: 3,
  };
  for (let id = 3; id < 3 + CONFIG.maxNodes + 20; id++) {
    raw.nodes.push({
      id,
      kind: 'extractor',
      x: id * 10,
      y: 400,
      level: 1,
      out: { tier: 0, amount: 0 },
      invested: {},
    });
  }
  const imported = importGame(JSON.stringify(raw));
  assert.equal(imported.nodes.length, CONFIG.maxNodes);
  assert.equal(imported.nodes[0].level, CONFIG.maxLevel);
});

test('import caps the link table', () => {
  const raw: {
    nodes: Record<string, unknown>[];
    links: Record<string, unknown>[];
    bank: Record<string, number>;
    unlockedTier: number;
    nextId: number;
  } = {
    nodes: [],
    links: [],
    bank: {},
    unlockedTier: 1,
    nextId: 1,
  };
  const extractors = 25;
  for (let id = 1; id <= extractors; id++) {
    raw.nodes.push({
      id,
      kind: 'extractor',
      x: id * 10,
      y: 0,
      level: 1,
      out: { tier: 0, amount: 0 },
      invested: {},
    });
  }
  let vaultId = 100;
  for (let i = 0; i < 475; i++) {
    raw.nodes.push({ id: vaultId++, kind: 'vault', x: i * 10, y: 400, level: 1, invested: {} });
  }
  let linkId = 1;
  for (let from = 1; from <= extractors; from++) {
    for (let to = 100; to < 100 + 475; to++) {
      raw.links.push({ id: linkId++, from, to, tier: 0 });
    }
  }
  const imported = importGame(JSON.stringify(raw));
  assert.equal(imported.links.length, CONFIG.maxLinks);
});

test('invested costs accumulate for refunds', () => {
  const state = createInitialState();
  const node = state.nodes[0];
  addInvested(node, { tier: 0, amount: 8 });
  addInvested(node, { tier: 0, amount: 6 });
  assert.equal(node.invested[0], 14);
});
