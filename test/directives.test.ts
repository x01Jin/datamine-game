import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/game/state.ts';
import {
  generateDirectives,
  directiveProgress,
  directiveComplete,
  normalizeDirectives,
} from '../src/game/directives.ts';
import { checkDirectives } from '../src/game/actions.ts';
import type { App, Directive, State, ToastOptions } from '../src/game/types.ts';

interface TestDirective {
  kind: string;
  tier: number;
  goal: number;
  base: number;
  title: string;
  brief: string;
  reward: { tier: number; amount: number };
  cores: number;
}

interface Calls {
  toast: ToastOptions[];
  discover: number;
}

interface TestApp extends App {
  calls: Calls;
}

function appFor(state: State): TestApp {
  const calls: Calls = { toast: [], discover: 0 };
  return {
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
      place() {},
      deny() {},
      connect() {},
      disconnect() {},
      upgrade() {},
      dismantle() {},
      click() {},
      discover() {
        calls.discover++;
      },
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
}

test('a fresh instance carries three directives', () => {
  const state = createInitialState();
  assert.equal(state.directives.length, 3);
  for (const directive of state.directives as unknown as TestDirective[]) {
    assert.ok(directive.goal > 0);
    assert.ok(directive.title);
    assert.ok(directive.brief);
    assert.equal(directiveProgress(state, directive as unknown as Directive), 0);
  }
});

test('generated directives never repeat a kind and tier pair', () => {
  const state = createInitialState();
  const directives = generateDirectives(state, 3);
  const keys = (directives as unknown as TestDirective[]).map(
    (directive) => `${directive.kind}:${directive.tier}`,
  );
  assert.equal(new Set(keys).size, keys.length);
});

test('directive progress is measured from the snapshot taken when it was issued', () => {
  const state = createInitialState();
  const directive = {
    kind: 'bank',
    tier: 0,
    goal: 10,
    base: 4,
  } as unknown as Directive;
  state.stats.bankedByTier[0] = 9;
  assert.equal(directiveProgress(state, directive), 5);
  assert.equal(directiveComplete(state, directive), false);
  state.stats.bankedByTier[0] = 14;
  assert.equal(directiveComplete(state, directive), true);
});

test('completing a directive pays out and issues a replacement', () => {
  const state = createInitialState();
  const app = appFor(state);
  state.directives = [
    {
      kind: 'bank',
      tier: 0,
      goal: 5,
      base: 0,
      title: 'Test order',
      brief: 'Bank 5 Raw Data.',
      reward: { tier: 0, amount: 20 },
      cores: 1,
    },
  ] as unknown as Directive[];
  state.stats.bankedByTier[0] = 5;

  const completed = checkDirectives(app);
  assert.ok(completed);
  assert.equal(state.bank[0], 6 + 20);
  assert.equal(state.cores, 1);
  assert.equal(state.directives.length, 1);
  assert.notEqual((state.directives[0] as unknown as TestDirective).title, 'Test order');
  assert.equal(app.calls.discover, 1);
});

test('the ledger rank makes directive rewards richer', () => {
  const state = createInitialState();
  const app = appFor(state);
  state.coreRanks.ledger = 2;
  state.directives = [
    {
      kind: 'bank',
      tier: 0,
      goal: 1,
      base: 0,
      title: 'x',
      brief: 'x',
      reward: { tier: 0, amount: 10 },
      cores: 0,
    },
  ] as unknown as Directive[];
  state.stats.bankedByTier[0] = 1;
  checkDirectives(app);
  assert.equal(state.bank[0], 6 + 15);
});

test('malformed directive lists are replaced with fresh ones', () => {
  const state = createInitialState();
  const cleaned = normalizeDirectives([{ kind: 'nonsense' }, null, 7], state);
  assert.equal(cleaned.length, 3);
  for (const directive of cleaned as unknown as TestDirective[]) {
    assert.ok(['bank', 'uptime', 'types', 'fleet', 'depth'].includes(directive.kind));
  }
});
