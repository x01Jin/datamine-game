import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, makeProcessor } from '../src/state.js';
import {
  connectNodes, addLinkAnchor, setLinkAnchor, removeLinkAnchor, clearLinkAnchors,
  setLinkPriority,
} from '../src/actions.js';
import { snapNode, snapAnchor, linkPath, GRID } from '../src/layout.js';
import { step } from '../src/sim.js';

function appFor(state = createInitialState()) {
  const calls = { toast: [], deny: 0 };
  return {
    state,
    view: { selection: null },
    calls,
    audio: {
      place() {}, deny() { calls.deny++; }, connect() {}, disconnect() {},
      upgrade() {}, dismantle() {}, click() {},
    },
    toast(options) { calls.toast.push(options); },
    afterChange() {},
    setPendingBuild() {},
  };
}

test('machines snap to the floor lattice', () => {
  assert.deepEqual(snapNode(10, 10), { x: 0, y: 0 });
  assert.deepEqual(snapNode(GRID.cellW + 4, 0), { x: GRID.cellW, y: 0 });
  assert.deepEqual(snapNode(-4, -GRID.cellH - 4), { x: 0, y: -GRID.cellH });
  assert.equal(snapNode(GRID.cellW * 3, GRID.cellH * 2).x % GRID.cellW, 0);
});

test('anchors snap to the fine grid and magnet onto port lines', () => {
  const snapped = snapAnchor(5, 5, { xs: [], ys: [] }, 10);
  assert.equal(snapped.x % GRID.fine, 0);
  assert.equal(snapped.y % GRID.fine, 0);

  const guided = snapAnchor(100, 200, { xs: [100], ys: [] }, 8);
  assert.equal(guided.x, 100);
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
    { id: 4, from: 1, to: forge.id, tier: 0, priority: 2, anchors: [] },
    { id: 5, from: 1, to: 2, tier: 0, priority: 0.5, anchors: [] },
  );
  for (let i = 0; i < 40; i++) step(state, 0.1);
  const forgeFlow = state.links[0]._flow || 0;
  const vaultFlow = state.links[1]._flow || 0;
  assert.ok(forgeFlow > vaultFlow * 2, `forge ${forgeFlow} vs vault ${vaultFlow}`);
  assert.ok(extractor.out.amount >= 0);
});

test('a routed wire is drawn through its anchors', () => {
  const state = createInitialState();
  const link = { id: 3, from: 1, to: 2, tier: 0, priority: 1, anchors: [{ x: 0, y: 120 }] };
  const path = linkPath(link, state.nodes[0], state.nodes[1]);
  assert.equal(path.kind, 'route');
  assert.ok(path.points.some((point) => point.x === 0 && point.y === 120));

  const straight = linkPath({ ...link, anchors: [] }, state.nodes[0], state.nodes[1]);
  assert.equal(straight.kind, 'curve');
});

test('a new anchor is inserted at its place along the route', () => {
  const state = createInitialState();
  const app = appFor(state);
  const link = connectNodes(app, 1, 2);
  const from = state.nodes[0];
  const to = state.nodes[1];
  const path = linkPath(link, from, to);
  const end = path.at(1);

  addLinkAnchor(app, link.id, end.x - 24, end.y, 0);
  const early = path.at(0.2);
  addLinkAnchor(app, link.id, early.x, early.y, 0);
  assert.equal(link.anchors.length, 2);
  assert.equal(link.anchors[0].x, early.x);
  assert.equal(link.anchors[1].x, end.x - 24);
});
