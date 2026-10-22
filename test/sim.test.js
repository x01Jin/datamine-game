import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, makeProcessor } from '../src/state.js';
import { step, simulate, nodeStatus, incomingFlow } from '../src/sim.js';
import { bufferCap } from '../src/gamedata.js';

function wired() {
  const state = createInitialState();
  const processor = makeProcessor(3, 1, 0, 160);
  state.nodes.push(processor);
  state.links.push(
    { id: 4, from: 1, to: processor.id, tier: 0 },
    { id: 5, from: processor.id, to: 2, tier: 1 },
  );
  return { state, processor };
}

test('an extractor wired to the vault banks raw data', () => {
  const state = createInitialState();
  state.bank[0] = 0;
  state.links.push({ id: 3, from: 1, to: 2, tier: 0 });
  const before = state.bank[0];
  simulate(state, 10, 0.5);
  assert.ok(state.bank[0] - before > 19);
  assert.ok(state.bank[0] - before < 21);
  assert.equal(state.stats.playTime, 0);
});

test('a tier one forge consumes raw and unlocks tier two', () => {
  const { state, processor } = wired();
  state.bank[0] = 100;
  simulate(state, 30, 0.1);
  assert.ok(state.bank[1] > 5, `expected clean bits, got ${state.bank[1]}`);
  assert.equal(state.unlockedTier, 2);
  assert.ok(processor.inputs[0] <= bufferCap(state, processor) + 1e-6);
  assert.equal(state.stats.deepestTier, 1);
});

test('telemetry records flow, utilization and play time', () => {
  const { state, processor } = wired();
  for (let i = 0; i < 20; i++) step(state, 0.1);
  assert.ok(processor._util > 0);
  assert.ok(processor._cycles > 0);
  assert.ok((state.links[0]._flow || 0) > 0);
  assert.ok(state.stats.playTime > 1.9);
});

test('producers stop at buffer capacity and report blocked', () => {
  const state = createInitialState();
  const processor = makeProcessor(3, 1, 0, 160);
  state.nodes.push(processor);
  state.links.push({ id: 4, from: 1, to: processor.id, tier: 0 });
  state.bank[0] = 1000;
  step(state, 100);
  assert.ok(processor.out.amount <= bufferCap(state, processor) + 1e-6);
  for (let i = 0; i < 80; i++) step(state, 1);
  const cap = bufferCap(state, processor);
  assert.ok(processor.out.amount >= cap - 1e-6);
  assert.equal(nodeStatus(state, processor), 'blocked');
});

test('deposits raise the unlocked tier only forward', () => {
  const state = createInitialState();
  state.links.push({ id: 3, from: 1, to: 2, tier: 0 });
  state.bank[2] = 0;
  state.unlockedTier = 4;
  simulate(state, 5);
  assert.equal(state.unlockedTier, 4);
});

test('incoming flow adds every wire into a node', () => {
  const state = createInitialState();
  const processor = makeProcessor(3, 2, 0, 160);
  state.nodes.push(processor);
  state.links.push(
    { id: 4, from: 1, to: processor.id, tier: 0, _flow: 1.5 },
    { id: 5, from: 1, to: processor.id, tier: 0, _flow: 2.5 },
  );
  assert.equal(incomingFlow(state, processor.id, 0), 4);
});
