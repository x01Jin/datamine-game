import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, makeProcessor } from '../src/game/state.ts';
import {
  connectNodes,
  addLinkAnchor,
  setLinkAnchor,
  removeLinkAnchor,
  clearLinkAnchors,
  setLinkPriority,
} from '../src/game/actions.ts';
import { snapNode, snapAnchor, linkPath, GRID, inputPorts, portWorldPos } from '../src/layout/geometry.ts';
import { step } from '../src/game/sim.ts';
import type { App, State, ToastOptions } from '../src/game/types.ts';

function appFor(state: State = createInitialState()): App {
  const calls = { toast: [] as unknown[], deny: 0 };
  return {
    state,
    view: { selection: null },
    calls,
    audio: {
      place() {},
      deny() {
        calls.deny++;
      },
      connect() {},
      disconnect() {},
      upgrade() {},
      dismantle() {},
      click() {},
    },
    toast(options: ToastOptions) {
      calls.toast.push(options);
    },
    afterChange() {},
    setPendingBuild() {},
  } as unknown as App;
}

test('machines and wire points share one grid', () => {
  assert.deepEqual(snapNode(10, 10), { x: 0, y: 0 });
  assert.deepEqual(snapNode(GRID.cell + 4, 0), { x: GRID.cell, y: 0 });
  assert.deepEqual(snapNode(-4, -GRID.cell - 4), { x: 0, y: -GRID.cell });
  assert.equal(snapNode(GRID.cell * 3, GRID.cell * 2).x % GRID.cell, 0);

  const node = snapNode(31, 47);
  const anchor = snapAnchor(31, 47, { xs: [], ys: [] }, 10);
  assert.deepEqual(anchor, node);
});

test('anchors magnet onto port lines', () => {
  const guided = snapAnchor(100, 200, { xs: [100], ys: [] }, 8);
  assert.equal(guided.x, 100);
});

test('the vault takes a wire on every side', () => {
  const state = createInitialState();
  const vault = state.nodes[1];
  const ports = inputPorts(vault);
  assert.equal(ports.length, 4);
  assert.deepEqual(ports.map((port) => port.face).toSorted(), ['e', 'n', 's', 'w']);
  for (const port of ports) {
    assert.equal(port.universal, true);
    const pos = portWorldPos(vault, port);
    assert.ok(pos.x % GRID.cell === 0 && pos.y % GRID.cell === 0);
  }
});

test('a wire lands on the vault side it approaches from', () => {
  const state = createInitialState();
  const extractor = state.nodes[0];
  const vault = state.nodes[1];
  const link = { id: 9, from: extractor.id, to: vault.id, tier: 0, anchors: [] };

  const west = linkPath(link as never, extractor, vault);
  assert.ok(west);
  assert.equal(west.curve?.d.x, vault.x - 96);
  assert.equal(west.curve?.d.y, vault.y);

  extractor.x = vault.x;
  extractor.y = vault.y - 240;
  const north = linkPath(link as never, extractor, vault);
  assert.equal(north?.curve?.d.x, vault.x);
  assert.equal(north?.curve?.d.y, vault.y - 96);
});

test('a pinned side overrides the approach', () => {
  const state = createInitialState();
  const extractor = state.nodes[0];
  const vault = state.nodes[1];
  const link = { id: 9, from: extractor.id, to: vault.id, tier: 0, anchors: [], side: 's' };
  const path = linkPath(link as never, extractor, vault);
  assert.equal(path?.curve?.d.x, vault.x);
  assert.equal(path?.curve?.d.y, vault.y + 96);
});

test('a wire is created with its route and pinned side', () => {
  const state = createInitialState();
  const app = appFor(state);
  const link = connectNodes(app, 1, 2, {
    points: [
      { x: 0, y: 48 },
      { x: 96, y: 48 },
    ],
    side: 'n',
  });
  assert.ok(link);
  assert.equal(link.anchors.length, 2);
  assert.deepEqual(link.anchors[0], { x: 0, y: 48 });
  assert.deepEqual(link.anchors[1], { x: 96, y: 48 });
  assert.equal(link.side, 'n');
});

test('a side is only kept for a vault', () => {
  const state = createInitialState();
  const app = appFor(state);
  const forge = makeProcessor(state.nextId++, 1, 0, 240);
  state.nodes.push(forge);
  const link = connectNodes(app, 1, forge.id, { side: 'n' });
  assert.ok(link);
  assert.equal(link.side, undefined);
});

test('a wire carries anchors and they can be moved and removed', () => {
  const state = createInitialState();
  const app = appFor(state);
  const link = connectNodes(app, 1, 2);
  assert.ok(link);
  assert.deepEqual(link.anchors, []);

  const anchor = addLinkAnchor(app, link.id, 48, 24);
  assert.ok(anchor);
  assert.equal(link.anchors.length, 1);

  assert.equal(setLinkAnchor(app, link.id, 0, 96, -48), true);
  assert.deepEqual(link.anchors[0], { x: 96, y: -48 });

  assert.equal(removeLinkAnchor(app, link.id, 0), true);
  assert.equal(link.anchors.length, 0);
  assert.equal(removeLinkAnchor(app, link.id, 0), false);
});

test('clearing a route removes every anchor at once', () => {
  const state = createInitialState();
  const app = appFor(state);
  const link = connectNodes(app, 1, 2);
  assert.ok(link);
  addLinkAnchor(app, link.id, 0, 0);
  addLinkAnchor(app, link.id, 24, 0);
  assert.equal(clearLinkAnchors(app, link.id), true);
  assert.equal(link.anchors.length, 0);
  assert.equal(clearLinkAnchors(app, link.id), false);
});

test('wire priority only accepts low, normal and high', () => {
  const state = createInitialState();
  const app = appFor(state);
  const link = connectNodes(app, 1, 2);
  assert.ok(link);
  assert.equal(link.priority, 0.5);
  assert.equal(setLinkPriority(app, link.id, 2), true);
  assert.equal(link.priority, 2);
  assert.equal(setLinkPriority(app, link.id, 0.5), true);
  assert.equal(link.priority, 0.5);
  assert.equal(setLinkPriority(app, link.id, 7), true);
  assert.equal(link.priority, 1);
});

test('a high priority wire is served before a low priority one', () => {
  const state = createInitialState();
  const extractor = state.nodes[0];
  const forge = makeProcessor(3, 1, 0, 160);
  state.nodes.push(forge);
  state.links.push(
    { id: 4, from: 1, to: forge.id, tier: 0, priority: 2, anchors: [] } as never,
    { id: 5, from: 1, to: 2, tier: 0, priority: 0.5, anchors: [] } as never,
  );
  for (let i = 0; i < 40; i++) step(state, 0.1);
  const forgeFlow = state.links[0]._flow || 0;
  const vaultFlow = state.links[1]._flow || 0;
  assert.ok(forgeFlow > vaultFlow * 2, `forge ${forgeFlow} vs vault ${vaultFlow}`);
  assert.ok((extractor.out?.amount ?? 0) >= 0);
});

test('a routed wire is drawn through its anchors', () => {
  const state = createInitialState();
  const link = { id: 3, from: 1, to: 2, tier: 0, priority: 1 as const, anchors: [{ x: 0, y: 120 }] };
  const path = linkPath(link as never, state.nodes[0], state.nodes[1]);
  assert.ok(path);
  assert.equal(path.kind, 'route');
  assert.ok(path.points?.some((point) => point.x === 0 && point.y === 120));

  const straight = linkPath({ ...link, anchors: [] }, state.nodes[0], state.nodes[1]);
  assert.equal(straight?.kind, 'curve');
});

test('a new anchor is inserted at its place along the route', () => {
  const state = createInitialState();
  const app = appFor(state);
  const link = connectNodes(app, 1, 2);
  assert.ok(link);
  const from = state.nodes[0];
  const to = state.nodes[1];
  const path = linkPath(link, from, to);
  assert.ok(path);
  const end = path.at(1);

  addLinkAnchor(app, link.id, end.x - 24, end.y, 0);
  const early = path.at(0.2);
  addLinkAnchor(app, link.id, early.x, early.y, 0);
  assert.equal(link.anchors.length, 2);
  assert.equal(link.anchors[0].x, early.x);
  assert.equal(link.anchors[1].x, end.x - 24);
});
