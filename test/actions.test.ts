import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, makeProcessor } from '../src/game/state.ts';
import {
  placeExtractor,
  placeProcessor,
  connectNodes,
  upgradeNode,
  dismantleNode,
  currentCost,
  canAfford,
  extractorCount,
} from '../src/game/actions.ts';
import { CONFIG } from '../src/game/gamedata.ts';
import type { App, Link, State, ToastOptions } from '../src/game/types.ts';

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

const FORGE_A = { x: 0, y: 430 };
const FORGE_B = { x: 0, y: 690 };

test('placing machines spends currency and records the investment', () => {
  const state = createInitialState();
  state.bank[0] = 100_010;
  const app = appFor(state);
  assert.deepEqual(currentCost(state, 'extractor'), [{ tier: 0, amount: CONFIG.machineTierCost }]);
  const extractor = placeExtractor(app, 0, 300);
  assert.ok(extractor);
  assert.equal(extractorCount(state), 2);
  assert.equal(state.bank[0], 10);
  assert.equal(extractor.invested[0], CONFIG.machineTierCost);
  const forge = placeProcessor(app, 1, FORGE_A.x, FORGE_A.y);
  assert.ok(forge);
  assert.equal(forge.invested[0], 10);
});

test('placement rejects overlap and unaffordable machines', () => {
  const state = createInitialState();
  state.bank[0] = 5;
  const app = appFor(state);
  assert.equal(placeProcessor(app, 1, FORGE_A.x, FORGE_A.y), null);
  state.bank[0] = 100_000;
  assert.equal(placeExtractor(app, -190, 0), null);
});

test('wiring validates tiers and duplicates', () => {
  const state = createInitialState();
  state.bank[0] = 100;
  const app = appFor(state);
  const forge = placeProcessor(app, 1, FORGE_A.x, FORGE_A.y);
  assert.ok(forge);
  const second = makeProcessor(99, 1, FORGE_B.x, FORGE_B.y);
  state.nodes.push(second);

  assert.ok(connectNodes(app, 1, forge.id));
  assert.equal(connectNodes(app, 1, forge.id), null);
  assert.equal(connectNodes(app, forge.id, forge.id), null);
  assert.equal(connectNodes(app, forge.id, 1), null);
  assert.ok(connectNodes(app, forge.id, 2));
  assert.equal(connectNodes(app, forge.id, second.id), null);
  assert.equal(state.links.length, 2);
  assert.ok(app.calls.deny > 0);
});

test('a tier one wire is valid for a tier three forge', () => {
  const state = createInitialState();
  state.bank[0] = 100;
  const app = appFor(state);
  const forge = placeProcessor(app, 1, FORGE_A.x, FORGE_A.y);
  assert.ok(forge);
  const deeper = makeProcessor(99, 3, FORGE_B.x, FORGE_B.y);
  state.nodes.push(deeper);
  assert.ok(connectNodes(app, forge.id, deeper.id));
  assert.equal(state.links.length, 1);
  assert.equal(app.calls.deny, 0);
});

test('upgrading raises level and costs output data', () => {
  const state = createInitialState();
  state.bank[0] = 100;
  state.bank[1] = 100;
  const app = appFor(state);
  const forge = placeProcessor(app, 1, FORGE_A.x, FORGE_A.y);
  assert.ok(forge);
  assert.equal(upgradeNode(app, forge.id), true);
  assert.equal(forge.level, 2);
  assert.equal(state.bank[1], 94);
  assert.equal(forge.invested[1], 6);
});

test('dismantling refunds everything and removes attached wires', () => {
  const state = createInitialState();
  state.bank[0] = 100;
  const app = appFor(state);
  const forge = placeProcessor(app, 1, FORGE_A.x, FORGE_A.y);
  assert.ok(forge);
  connectNodes(app, 1, forge.id);
  const beforeRaw = state.bank[0];
  assert.equal(dismantleNode(app, forge.id), true);
  assert.equal(state.bank[0], beforeRaw + 10);
  assert.equal(state.links.length, 0);
  assert.equal(state.nodes.length, 2);
});

test('the vault and final extractor are protected', () => {
  const state = createInitialState();
  const app = appFor(state);
  assert.equal(dismantleNode(app, 2), false);
  assert.equal(dismantleNode(app, 1), false);
  assert.equal(state.nodes.length, 2);
});

test('affordability compares each line against its own bank', () => {
  const state = createInitialState();
  state.bank[0] = 10;
  state.bank[1] = 0;
  assert.equal(canAfford(state, { tier: 0, amount: 10 }), true);
  assert.equal(canAfford(state, { tier: 0, amount: 11 }), false);
  const forge = makeProcessor(3, 1, 0, 0);
  state.nodes.push(forge);
  state.bank[1] = 5;
  assert.equal(canAfford(state, { tier: 1, amount: 6 }), false);
});

test('a multi-line price needs every line and spends nothing when short', () => {
  const state = createInitialState();
  state.bank[0] = 200_000;
  const app = appFor(state);
  const second = placeExtractor(app, 0, 300);
  assert.ok(second);
  assert.deepEqual(currentCost(state, 'extractor'), [
    { tier: 0, amount: 100_000 },
    { tier: 1, amount: 100_000 },
  ]);
  state.bank[0] = 100_000;
  state.bank[1] = 99_999;
  assert.equal(canAfford(state, currentCost(state, 'extractor')), false);
  assert.equal(placeExtractor(app, 0, 700), null);
  assert.equal(state.bank[0], 100_000);
  assert.equal(state.bank[1], 99_999);
  state.bank[1] = 100_000;
  const third = placeExtractor(app, 0, 700);
  assert.ok(third);
  assert.equal(state.bank[0], 0);
  assert.equal(state.bank[1], 0);
  assert.equal(third.invested[0], 100_000);
  assert.equal(third.invested[1], 100_000);
});

test('same-tier lines aggregate before checking affordability', () => {
  const state = createInitialState();
  state.bank[0] = 150;
  assert.equal(
    canAfford(state, [
      { tier: 0, amount: 100 },
      { tier: 0, amount: 100 },
    ]),
    false,
  );
  state.bank[0] = 200;
  assert.equal(
    canAfford(state, [
      { tier: 0, amount: 100 },
      { tier: 0, amount: 100 },
    ]),
    true,
  );
});

test('upgrading stops at the maximum level and spends nothing', () => {
  const state = createInitialState();
  state.bank[0] = 100;
  state.bank[1] = 1000;
  const app = appFor(state);
  const forge = placeProcessor(app, 1, FORGE_A.x, FORGE_A.y);
  assert.ok(forge);
  forge.level = CONFIG.maxLevel;
  assert.equal(upgradeNode(app, forge.id), false);
  assert.equal(state.bank[1], 1000);
  assert.ok(app.calls.deny > 0);
});

test('placement stops at the machine limit and spends nothing', () => {
  const state = createInitialState();
  state.bank[0] = 100000;
  const app = appFor(state);
  while (state.nodes.length < CONFIG.maxNodes) {
    const node = makeProcessor(state.nextId++, 1, state.nextId * 40, 900);
    state.nodes.push(node);
  }
  const before = state.bank[0];
  assert.equal(placeExtractor(app, 0, 1500), null);
  assert.equal(state.bank[0], before);
});

test('wiring stops at the link limit and spends nothing', () => {
  const state = createInitialState();
  state.bank[0] = 100;
  const app = appFor(state);
  const forge = placeProcessor(app, 1, FORGE_A.x, FORGE_A.y);
  assert.ok(forge);
  while (state.links.length < CONFIG.maxLinks) {
    state.links.push({ id: state.nextId++, from: 1, to: 2, tier: 0 } as unknown as Link);
  }
  const before = state.links.length;
  assert.equal(connectNodes(app, forge.id, 2), null);
  assert.equal(state.links.length, before);
});

test('self wires and duplicates report feedback', () => {
  const state = createInitialState();
  state.bank[0] = 100;
  const app = appFor(state);
  const forge = placeProcessor(app, 1, FORGE_A.x, FORGE_A.y);
  assert.ok(forge);
  const before = app.calls.toast.length;
  assert.equal(connectNodes(app, forge.id, forge.id), null);
  assert.equal(app.calls.toast.length, before + 1);
  assert.ok(connectNodes(app, 1, forge.id));
  assert.equal(connectNodes(app, 1, forge.id), null);
  assert.equal(app.calls.toast.length, before + 2);
  assert.ok(app.calls.deny >= 2);
});
