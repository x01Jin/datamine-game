import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, importGame, makeProcessor, serialize } from '../src/game/state.ts';
import { connectNodes, rotateNode } from '../src/game/actions.ts';
import {
  GRID,
  inputPorts,
  linkPath,
  outputPort,
  portWorldPos,
  rotationFaces,
} from '../src/layout/geometry.ts';
import type { App, ProcessorNode, State, ToastOptions } from '../src/game/types.ts';

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

const FACES = [
  { in: 'w', out: 'e' },
  { in: 'n', out: 's' },
  { in: 'e', out: 'w' },
  { in: 's', out: 'n' },
] as const;

test('a forge turns a quarter at a time', () => {
  const state = createInitialState();
  const app = appFor(state);
  const forge = makeProcessor(state.nextId++, 1, 0, 0);
  state.nodes.push(forge);

  for (let turn = 0; turn < 4; turn++) {
    const faces = FACES[turn];
    assert.equal(forge.rot, turn);
    assert.deepEqual(rotationFaces(forge), { in: faces.in, out: faces.out });
    assert.equal(outputPort(forge)?.face, faces.out);
    assert.ok(inputPorts(forge).every((port) => port.face === faces.in));
    rotateNode(app, forge.id);
  }
  assert.equal(forge.rot, 0);
});

test('rotated ports stay on the shared grid', () => {
  const state = createInitialState();
  const forge = makeProcessor(state.nextId++, 2, 48, 48);
  state.nodes.push(forge);
  for (let turn = 0; turn < 4; turn++) {
    forge.rot = turn as ProcessorNode['rot'];
    for (const port of inputPorts(forge)) {
      const pos = portWorldPos(forge, port);
      assert.ok(pos.x % GRID.cell === 0 && pos.y % GRID.cell === 0, `${turn}: ${pos.x},${pos.y}`);
    }
    const out = outputPort(forge);
    assert.ok(out);
    const pos = portWorldPos(forge, out);
    assert.ok(pos.x % GRID.cell === 0 && pos.y % GRID.cell === 0, `${turn}: ${pos.x},${pos.y}`);
  }
});

test('two forges of one tier keep their own ports', () => {
  const state = createInitialState();
  const straight = makeProcessor(state.nextId++, 2, 0, 0, 0);
  const turned = makeProcessor(state.nextId++, 2, 240, 0, 1);
  state.nodes.push(straight, turned);

  assert.equal(outputPort(straight)?.face, 'e');
  assert.equal(outputPort(turned)?.face, 's');
  assert.equal(inputPorts(straight)[0].face, 'w');
  assert.equal(inputPorts(turned)[0].face, 'n');
});

test('a wire follows a forge onto its new face', () => {
  const state = createInitialState();
  const app = appFor(state);
  const extractor = state.nodes[0];
  const forge = makeProcessor(state.nextId++, 1, 0, 0);
  state.nodes.push(forge);
  const link = connectNodes(app, extractor.id, forge.id);
  assert.ok(link);

  const before = linkPath(link, extractor, forge);
  assert.equal(before?.curve?.d.x, forge.x - 96);
  assert.equal(before?.curve?.d.y, forge.y);

  rotateNode(app, forge.id);
  const after = linkPath(link, extractor, forge);
  assert.equal(after?.curve?.d.x, forge.x);
  assert.equal(after?.curve?.d.y, forge.y - 48);
  assert.equal(after?.curve?.a.x, extractor.x + 96);
  assert.equal(after?.curve?.a.y, extractor.y);
});

test('only a forge can be turned', () => {
  const state = createInitialState();
  const app = appFor(state);
  assert.equal(rotateNode(app, state.nodes[0].id), false);
  assert.equal(rotateNode(app, state.nodes[1].id), false);
});

test('the orientation survives a save', () => {
  const state = createInitialState();
  state.unlockedTier = 3;
  const forge = makeProcessor(state.nextId++, 3, 120, 240, 2);
  state.nodes.push(forge);
  const imported = importGame(serialize(state));
  const restored = imported.nodes.find((node) => node.id === forge.id) as ProcessorNode;
  assert.equal(restored.rot, 2);
  assert.equal(outputPort(restored)?.face, 'w');
});

test('a broken orientation falls back to the first turn', () => {
  const state = createInitialState();
  const forge = makeProcessor(state.nextId++, 1, 0, 0);
  state.nodes.push(forge);
  const raw = JSON.parse(serialize(state)) as { nodes: Record<string, unknown>[] };
  raw.nodes[2].rot = 99;
  const imported = importGame(JSON.stringify(raw));
  const restored = imported.nodes.find((node) => node.id === forge.id) as ProcessorNode;
  assert.equal(restored.rot, 3);
  assert.equal(outputPort(restored)?.face, 'n');
});
