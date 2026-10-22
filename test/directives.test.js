import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/state.js';
import {
  generateDirectives, directiveProgress, directiveComplete, normalizeDirectives,
} from '../src/directives.js';
import { checkDirectives } from '../src/actions.js';

function appFor(state) {
  const calls = { toast: [], discover: 0 };
  return {
    state,
    view: { selection: null },
    calls,
    audio: {
      place() {}, deny() {}, connect() {}, disconnect() {}, upgrade() {},
      dismantle() {}, click() {}, discover() { calls.discover++; },
    },
    toast(options) { calls.toast.push(options); },
    afterChange() {},
    setPendingBuild() {},
  };
}

test('a fresh instance carries three directives', () => {
  const state = createInitialState();
  assert.equal(state.directives.length, 3);
  for (const directive of state.directives) {
    assert.ok(directive.goal > 0);
    assert.ok(directive.title);
    assert.ok(directive.brief);
    assert.equal(directiveProgress(state, directive), 0);
  }
});

test('generated directives never repeat a kind and tier pair', () => {
  const state = createInitialState();
  const directives = generateDirectives(state, 3);
  const keys = directives.map((directive) => `${directive.kind}:${directive.tier}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('directive progress is measured from the snapshot taken when it was issued', () => {
  const state = createInitialState();
  const directive = { kind: 'bank', tier: 0, goal: 10, base: 4 };
  state.stats.bankedByTier[0] = 9;
  assert.equal(directiveProgress(state, directive), 5);
  assert.equal(directiveComplete(state, directive), false);
  state.stats.bankedByTier[0] = 14;
  assert.equal(directiveComplete(state, directive), true);
});

test('completing a directive pays out and issues a replacement', () => {
  const state = createInitialState();
  const app = appFor(state);
  state.directives = [{
    kind: 'bank',
    tier: 0,
    goal: 5,
    base: 0,
    title: 'Test order',
    brief: 'Bank 5 Raw Noise.',
    reward: { tier: 0, amount: 20 },
    cores: 1,
  }];
  state.stats.bankedByTier[0] = 5;

  const completed = checkDirectives(app);
  assert.ok(completed);
  assert.equal(state.bank[0], 6 + 20);
  assert.equal(state.cores, 1);
  assert.equal(state.directives.length, 1);
  assert.notEqual(state.directives[0].title, 'Test order');
  assert.equal(app.calls.discover, 1);
});

test('the ledger rank makes directive rewards richer', () => {
  const state = createInitialState();
  const app = appFor(state);
  state.coreRanks.ledger = 2;
  state.directives = [{
    kind: 'bank', tier: 0, goal: 1, base: 0, title: 'x', brief: 'x',
    reward: { tier: 0, amount: 10 }, cores: 0,
  }];
  state.stats.bankedByTier[0] = 1;
  checkDirectives(app);
  assert.equal(state.bank[0], 6 + 15);
});

test('malformed directive lists are replaced with fresh ones', () => {
  const state = createInitialState();
  const cleaned = normalizeDirectives([{ kind: 'nonsense' }, null, 7], state);
  assert.equal(cleaned.length, 3);
  for (const directive of cleaned) {
    assert.ok(['bank', 'uptime', 'types', 'fleet', 'depth'].includes(directive.kind));
  }
});
