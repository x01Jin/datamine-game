import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, makeExtractor, makeProcessor } from '../src/game/state.ts';
import {
  placeExtractor,
  placeProcessor,
  dismantleNode,
  currentCost,
  extractorCount,
} from '../src/game/actions.ts';
import { CONFIG, upgradeCost } from '../src/game/gamedata.ts';
import type { App, State, ToastOptions } from '../src/game/types.ts';

interface Calls {
  toast: ToastOptions[];
  deny: number;
  place: number;
  refund: number;
}

interface TestApp extends App {
  calls: Calls;
}

function appFor(state: State = createInitialState()): TestApp {
  const calls: Calls = { toast: [], deny: 0, place: 0, refund: 0 };
  const app: TestApp = {
    state,
    view: {
      selection: null,
      hoverNode: null,
      hoverPort: null,
      hoverAnchor: null,
      ghost: null,
      linkDraft: null,
      pendingBuild: null,
      dragCell: null,
      motion: true,
      paused: false,
    },
    calls,
    audio: {
      place() {
        calls.place++;
      },
      deny() {
        calls.deny++;
      },
      connect() {},
      disconnect() {},
      upgrade() {},
      dismantle() {
        calls.refund++;
      },
      click() {},
      discover() {},
      setMuted() {},
    },
    toast(options) {
      calls.toast.push(options);
    },
    afterChange() {},
    setPendingBuild() {},
    saveSoon() {},
    saveNow() {
      return true;
    },
    replaceState() {},
  };
  return app;
}

// Kept clear of the starter machines (extractor -216,0; vault 216,0) and of each other.
const FORGE_A = { x: 0, y: 430 };
const FORGE_B = { x: 0, y: 690 };
const FORGE_C = { x: 0, y: 950 };

function pushExtractor(state: State): void {
  state.nodes.push({
    id: state.nextId++,
    kind: 'extractor',
    rot: 0,
    x: 600 + state.nodes.length * 240,
    y: 600,
    level: 1,
    out: { tier: 0, amount: 0 },
    invested: {},
  });
}

test('placement forwards rotation while the defaults stay unrotated', () => {
  const state = createInitialState();
  state.bank[0] = 200_000;
  const app = appFor(state);

  assert.equal(makeProcessor(99, 1, 900, 900).rot, 0);

  const turned = placeProcessor(app, 1, FORGE_A.x, FORGE_A.y, false, 2);
  assert.ok(turned);
  assert.equal(turned.rot, 2);

  const plain = placeProcessor(app, 1, FORGE_B.x, FORGE_B.y);
  assert.ok(plain);
  assert.equal(plain.rot, 0);

  const miner = placeExtractor(app, 600, 900, false, 3);
  assert.ok(miner);
  assert.equal(miner.rot, 3);

  const plainMiner = makeExtractor(100, 0, 0);
  assert.equal(plainMiner.rot, 0);
});

test('the third tier one processor is a single shifted line and refunds in full', () => {
  const state = createInitialState();
  state.nodes.push(makeProcessor(state.nextId++, 1, FORGE_A.x, FORGE_A.y));
  state.nodes.push(makeProcessor(state.nextId++, 1, FORGE_B.x, FORGE_B.y));
  const app = appFor(state);

  assert.deepEqual(currentCost(state, 'processor', 1), [{ tier: 1, amount: 1550 }]);

  state.bank[1] = 1550;
  const processor = placeProcessor(app, 1, FORGE_C.x, FORGE_C.y);
  assert.ok(processor);
  assert.deepEqual(processor.invested, { 1: 1550 });
  assert.equal(state.bank[1], 0);

  const before = state.nodes.length;
  assert.equal(dismantleNode(app, processor.id), true);
  assert.equal(state.nodes.length, before - 1);
  assert.equal(state.bank[1], 1550);

  state.nodes.push(makeProcessor(state.nextId++, 1, FORGE_C.x, FORGE_C.y));
  assert.deepEqual(currentCost(state, 'processor', 1), [{ tier: 2, amount: 2403 }]);
});

test('processor copies shift one tier at a time as single lines', () => {
  const state = createInitialState();
  const seen = [currentCost(state, 'processor', 1)];
  for (const cell of [FORGE_A, FORGE_B, FORGE_C]) {
    state.nodes.push(makeProcessor(state.nextId++, 1, cell.x, cell.y));
    seen.push(currentCost(state, 'processor', 1));
  }
  assert.deepEqual(seen[1], [{ tier: 0, amount: 1000 }]);
  assert.deepEqual(seen[2], [{ tier: 1, amount: 1550 }]);
  assert.deepEqual(seen[3], [{ tier: 2, amount: 2403 }]);
  for (const price of seen) {
    assert.equal(price.length, 1);
    for (const line of price) assert.notEqual(line.amount, 100_000);
  }
});

test('the second paid extractor needs 130k raw and 100k clean bits', () => {
  const state = createInitialState();
  state.bank[0] = 100_000;
  const app = appFor(state);

  const firstPaid = placeExtractor(app, 300, 430);
  assert.ok(firstPaid);
  assert.equal(extractorCount(state), 2);
  assert.deepEqual(currentCost(state, 'extractor'), [
    { tier: 0, amount: 130_000 },
    { tier: 1, amount: CONFIG.machineTierCost },
  ]);

  state.bank[0] = 130_000;
  state.bank[1] = 99_999;
  const before = { ...state.bank };
  assert.equal(placeExtractor(app, 0, 430), null);
  assert.deepEqual(state.bank, before);
  assert.equal(extractorCount(state), 2);

  state.bank[1] = 100_000;
  const secondPaid = placeExtractor(app, 0, 430);
  assert.ok(secondPaid);
  assert.equal(extractorCount(state), 3);
  assert.equal(state.bank[0], 0);
  assert.equal(state.bank[1], 0);
});

test('extractor lines enter at the base and compound behind it', () => {
  const state = createInitialState();
  assert.equal(extractorCount(state), 1);
  assert.deepEqual(currentCost(state, 'extractor'), [{ tier: 0, amount: CONFIG.machineTierCost }]);

  pushExtractor(state);
  assert.equal(extractorCount(state), 2);
  assert.deepEqual(currentCost(state, 'extractor'), [
    { tier: 0, amount: 130_000 },
    { tier: 1, amount: 100_000 },
  ]);

  pushExtractor(state);
  assert.equal(extractorCount(state), 3);
  assert.deepEqual(currentCost(state, 'extractor'), [
    { tier: 0, amount: 169_000 },
    { tier: 1, amount: 130_000 },
    { tier: 2, amount: 100_000 },
  ]);

  state.unlockedTier = 2;
  const deeper = currentCost(state, 'extractor');
  assert.deepEqual(deeper, [
    { tier: 0, amount: 216_320 },
    { tier: 1, amount: 166_400 },
    { tier: 2, amount: 128_000 },
  ]);
});

test('upgrades still cost a single line', () => {
  assert.deepEqual(upgradeCost({ kind: 'extractor', level: 1 }), { tier: 0, amount: 6 });
  assert.deepEqual(upgradeCost({ kind: 'processor', tier: 3, level: 2 }), { tier: 3, amount: 12 });
});
