import { recipeFor } from '../game/gamedata.ts';
import type { Face, Link, MachineNode, Point, Rot, Vector } from '../game/types.ts';

export const SIZES = {
  extractor: { w: 192, h: 96 },
  processor: { w: 192, h: 96 },
  vault: { w: 192, h: 192 },
} as const;

export const GRID = Object.freeze({
  cell: 24,
  margin: 12,
});

export const PORT_STUB = 24;

const NORMALS: Record<Face, Vector> = {
  e: { dx: 1, dy: 0 },
  w: { dx: -1, dy: 0 },
  n: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
};

// A quarter turn of the machine: the input face and the output face move together.
const ROTATION_FACES: { in: Face; out: Face }[] = [
  { in: 'w', out: 'e' },
  { in: 'n', out: 's' },
  { in: 'e', out: 'w' },
  { in: 's', out: 'n' },
];

export const FACE_LABEL: Record<Face, string> = {
  n: 'north',
  s: 'south',
  e: 'east',
  w: 'west',
};

export function rotationOf(node: MachineNode): Rot {
  return node.kind === 'processor' || node.kind === 'extractor' ? (node.rot ?? 0) : 0;
}

// Extractors have no inputs, so only `out` matters for them.
export function rotationFaces(node: MachineNode): { in: Face; out: Face } {
  if (node.kind === 'processor' || node.kind === 'extractor') return ROTATION_FACES[rotationOf(node)];
  return { in: 'w', out: 'e' };
}

export interface Port {
  dir: 'in' | 'out';
  tier: number | null;
  index: number;
  face: Face;
  dx: number;
  dy: number;
  universal: boolean;
  amount?: number;
}

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
}

export interface SegmentLengths {
  list: number[];
  total: number;
}

export interface WirePath {
  kind: 'curve' | 'route';
  points?: Point[];
  curve?: { a: Point; b: Point; c: Point; d: Point };
  lengths?: SegmentLengths;
  at: (t: number) => Point;
  distance: (x: number, y: number) => number;
}

export function nodeSize(node: MachineNode): { w: number; h: number } {
  return SIZES[node.kind] ?? SIZES.processor;
}

export function nodeBounds(node: MachineNode): Bounds {
  const size = nodeSize(node);
  return {
    left: node.x - size.w / 2,
    right: node.x + size.w / 2,
    top: node.y - size.h / 2,
    bottom: node.y + size.h / 2,
    w: size.w,
    h: size.h,
  };
}

const PORT_CACHE = new Map<string, Port[]>();

export function inputPorts(node: MachineNode): Port[] {
  const key = node.kind === 'processor' ? `p:${node.tier}:${rotationOf(node)}` : node.kind;
  const cached = PORT_CACHE.get(key);
  if (cached) return cached;
  const ports = buildInputPorts(node);
  PORT_CACHE.set(key, ports);
  return ports;
}

function faceOffset(face: Face, along: number, w: number, h: number): { dx: number; dy: number } {
  if (face === 'e') return { dx: w / 2, dy: along };
  if (face === 'w') return { dx: -w / 2, dy: along };
  if (face === 'n') return { dx: along, dy: -h / 2 };
  return { dx: along, dy: h / 2 };
}

function buildInputPorts(node: MachineNode): Port[] {
  if (node.kind === 'vault') {
    const half = SIZES.vault.w / 2;
    return [
      { dir: 'in', tier: null, index: 0, face: 'w', dx: -half, dy: 0, universal: true },
      { dir: 'in', tier: null, index: 1, face: 'e', dx: half, dy: 0, universal: true },
      { dir: 'in', tier: null, index: 2, face: 'n', dx: 0, dy: -half, universal: true },
      { dir: 'in', tier: null, index: 3, face: 's', dx: 0, dy: half, universal: true },
    ];
  }
  if (node.kind !== 'processor') return [];
  const recipe = recipeFor(node.tier);
  if (!recipe) return [];
  const face = rotationFaces(node).in;
  const count = recipe.inputs.length;
  const spread = count === 1 ? 0 : 48;
  const first = -((count - 1) * spread) / 2;
  return recipe.inputs.map((input, index) => {
    const offset = faceOffset(face, first + index * spread, SIZES.processor.w, SIZES.processor.h);
    return {
      dir: 'in',
      tier: input.tier,
      index,
      face,
      dx: offset.dx,
      dy: offset.dy,
      universal: false,
      amount: input.amount,
    };
  });
}

const OUTPUT_CACHE = new Map<string, Port>();

export function outputPort(node: MachineNode): Port | null {
  if (node.kind === 'vault') return null;
  const key = node.kind === 'extractor' ? `e:${rotationOf(node)}` : `p:${node.tier}:${rotationOf(node)}`;
  const cached = OUTPUT_CACHE.get(key);
  if (cached) return cached;
  const size = nodeSize(node);
  const face = rotationFaces(node).out;
  const offset = faceOffset(face, 0, size.w, size.h);
  const port: Port = {
    dir: 'out',
    tier: node.kind === 'extractor' ? 0 : node.tier,
    index: 0,
    face,
    dx: offset.dx,
    dy: offset.dy,
    universal: false,
  };
  OUTPUT_CACHE.set(key, port);
  return port;
}

export function portWorldPos(node: MachineNode, port: Port): Point {
  return { x: node.x + port.dx, y: node.y + port.dy };
}

export function findInputPort(node: MachineNode, tier: number): Port | null {
  return inputPorts(node).find((port) => port.tier === tier) ?? null;
}

export function faceFor(dx: number, dy: number): Face {
  if (Math.abs(dx) + 1 > Math.abs(dy)) return dx < 0 ? 'w' : 'e';
  return dy < 0 ? 'n' : 's';
}

export function facePort(node: MachineNode, face: Face): Port | null {
  return inputPorts(node).find((port) => port.face === face) ?? null;
}

export function targetPortFor(link: Link, to: MachineNode | null, from: MachineNode | null): Port | null {
  if (!to) return null;
  if (to.kind !== 'vault') {
    const ports = inputPorts(to);
    if (ports.length === 0) return null;
    return link.tier === null ? ports[0] : findInputPort(to, link.tier);
  }
  const ports = inputPorts(to);
  if (link.side) {
    const pinned = ports.find((port) => port.face === link.side);
    if (pinned) return pinned;
  }
  const anchors = link.anchors ?? [];
  const last = anchors.length ? anchors[anchors.length - 1] : null;
  const out = from ? outputPort(from) : null;
  const approach = last ?? (out ? portWorldPos(from as MachineNode, out) : { x: to.x, y: to.y });
  const face = faceFor(approach.x - to.x, approach.y - to.y);
  return ports.find((port) => port.face === face) ?? ports[0];
}

export function hitNode(node: MachineNode, wx: number, wy: number): boolean {
  const b = nodeBounds(node);
  return wx >= b.left && wx <= b.right && wy >= b.top && wy <= b.bottom;
}

export function hitPort(node: MachineNode, wx: number, wy: number, radius: number): Port | null {
  for (const port of inputPorts(node)) {
    const pos = portWorldPos(node, port);
    if ((wx - pos.x) ** 2 + (wy - pos.y) ** 2 <= radius ** 2) return port;
  }
  const output = outputPort(node);
  if (output) {
    const pos = portWorldPos(node, output);
    if ((wx - pos.x) ** 2 + (wy - pos.y) ** 2 <= radius ** 2) return output;
  }
  return null;
}

export function overlapsNode(
  nodes: MachineNode[],
  x: number,
  y: number,
  kind: MachineNode['kind'],
  ignoreId: number | null = null,
): boolean {
  const size = SIZES[kind];
  const margin = GRID.margin;
  for (const node of nodes) {
    if (node.id === ignoreId) continue;
    const other = nodeBounds(node);
    const left = x - size.w / 2 - margin;
    const right = x + size.w / 2 + margin;
    const top = y - size.h / 2 - margin;
    const bottom = y + size.h / 2 + margin;
    if (right > other.left && left < other.right && bottom > other.top && top < other.bottom) return true;
  }
  return false;
}

export function snapNode(x: number, y: number): Point {
  return {
    x: Math.round(x / GRID.cell) * GRID.cell + 0,
    y: Math.round(y / GRID.cell) * GRID.cell + 0,
  };
}

export function snapAnchor(
  x: number,
  y: number,
  guides: { xs: number[]; ys: number[] },
  threshold: number,
): Point {
  const snapped = snapNode(x, y);
  let px = snapped.x;
  let py = snapped.y;
  for (const guide of guides.xs) {
    if (Math.abs(guide - x) <= threshold) {
      px = guide;
      break;
    }
  }
  for (const guide of guides.ys) {
    if (Math.abs(guide - y) <= threshold) {
      py = guide;
      break;
    }
  }
  return { x: px, y: py };
}

export function bezierPoints(from: Point, to: Point, fromFace: Face = 'e', toFace: Face = 'w') {
  const fromNormal = NORMALS[fromFace] ?? NORMALS.e;
  const toNormal = NORMALS[toFace] ?? NORMALS.w;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  // A capped, distance-proportional reach keeps long wires from ballooning into loops
  // while still clearing the machine body on short runs.
  const fromOffset = Math.max(32, Math.min(104, (fromNormal.dx !== 0 ? dx : dy) * 0.34));
  const toOffset = Math.max(32, Math.min(104, (toNormal.dx !== 0 ? dx : dy) * 0.34));
  return {
    a: from,
    b: { x: from.x + fromNormal.dx * fromOffset, y: from.y + fromNormal.dy * fromOffset },
    c: { x: to.x + toNormal.dx * toOffset, y: to.y + toNormal.dy * toOffset },
    d: to,
  };
}

export function bezierAt(points: { a: Point; b: Point; c: Point; d: Point }, t: number): Point {
  const inv = 1 - t;
  const a = inv * inv * inv;
  const b = 3 * inv * inv * t;
  const c = 3 * inv * t * t;
  const d = t * t * t;
  return {
    x: a * points.a.x + b * points.b.x + c * points.c.x + d * points.d.x,
    y: a * points.a.y + b * points.b.y + c * points.c.y + d * points.d.y,
  };
}

function distanceToBezier(
  points: { a: Point; b: Point; c: Point; d: Point },
  x: number,
  y: number,
  samples = 26,
): number {
  let last = bezierAt(points, 0);
  let best = Infinity;
  for (let i = 1; i <= samples; i++) {
    const next = bezierAt(points, i / samples);
    best = Math.min(best, distanceToSegment(x, y, last.x, last.y, next.x, next.y));
    last = next;
  }
  return best;
}

export function distanceToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function boundsOfNodes(nodes: MachineNode[]) {
  if (nodes.length === 0) return { left: -200, right: 200, top: -120, bottom: 120 };
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const node of nodes) {
    const b = nodeBounds(node);
    left = Math.min(left, b.left);
    right = Math.max(right, b.right);
    top = Math.min(top, b.top);
    bottom = Math.max(bottom, b.bottom);
  }
  return { left, right, top, bottom };
}

export function stubPoint(pos: Point, port: Port): Point {
  const normal = NORMALS[port.face] ?? NORMALS.e;
  return { x: pos.x + normal.dx * PORT_STUB, y: pos.y + normal.dy * PORT_STUB };
}

export function routePath(points: Point[]): WirePath {
  const lengths = segmentLengths(points);
  return {
    kind: 'route',
    points,
    lengths,
    at: (t: number) => pointAlongPolyline(points, lengths, t),
    distance: (x: number, y: number) => distanceToPolyline(points, x, y),
  };
}

export function linkPath(link: Link, from: MachineNode, to: MachineNode): WirePath | null {
  const outPort = outputPort(from);
  const inPort = targetPortFor(link, to, from);
  if (!outPort || !inPort) return null;
  const a = portWorldPos(from, outPort);
  const d = portWorldPos(to, inPort);
  const anchors = link.anchors ?? [];

  if (anchors.length === 0) {
    const curve = bezierPoints(a, d, outPort.face, inPort.face);
    return {
      kind: 'curve',
      curve,
      at: (t: number) => bezierAt(curve, t),
      distance: (x: number, y: number) => distanceToBezier(curve, x, y),
    };
  }

  return routePath([
    a,
    stubPoint(a, outPort),
    ...anchors.map((anchor) => ({ x: anchor.x, y: anchor.y })),
    stubPoint(d, inPort),
    d,
  ]);
}

export interface Draft {
  fromId: number;
  tier: number;
  points: Point[];
  x: number;
  y: number;
  targetId: number | null;
  targetTier: number | null;
  targetFace: Face | null;
  targetPos: Point | null;
}

export function draftPath(draft: Draft, from: MachineNode): WirePath | null {
  const port = outputPort(from);
  if (!port) return null;
  const start = portWorldPos(from, port);
  const points: Point[] = [start, stubPoint(start, port)];
  for (const point of draft.points) points.push({ x: point.x, y: point.y });
  if (draft.targetFace && draft.targetPos) {
    const end = { x: draft.targetPos.x, y: draft.targetPos.y };
    points.push(stubPoint(end, { face: draft.targetFace } as Port));
    points.push(end);
  } else {
    points.push({ x: draft.x, y: draft.y });
  }
  return routePath(points);
}

export function pointAlongPolyline(points: Point[], lengths: SegmentLengths, t: number): Point {
  const total = lengths.total;
  if (total <= 0) return { ...points[0] };
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lengths.list.length; i++) {
    const length = lengths.list[i];
    if (target <= length || i === lengths.list.length - 1) {
      const f = length > 0 ? target / length : 0;
      const a = points[i];
      const b = points[i + 1];
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    target -= length;
  }
  return { ...points[points.length - 1] };
}

export function distanceToPolyline(points: Point[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    best = Math.min(
      best,
      distanceToSegment(x, y, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y),
    );
  }
  return best;
}

export function segmentLengths(points: Point[]): SegmentLengths {
  const list: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    list.push(length);
    total += length;
  }
  return { list, total };
}

export function projectToPath(path: WirePath, x: number, y: number, samples = 40): number {
  let bestT = 0;
  let bestDistance = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const point = path.at(t);
    const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestT = t;
    }
  }
  return bestT;
}

export function anchorGuides(link: Link, from: MachineNode, to: MachineNode, excludeIndex = -1) {
  const xs: number[] = [];
  const ys: number[] = [];
  const outPort = outputPort(from);
  const inPort = targetPortFor(link, to, from);
  if (outPort) {
    const pos = portWorldPos(from, outPort);
    xs.push(pos.x);
    ys.push(pos.y);
  }
  if (inPort) {
    const pos = portWorldPos(to, inPort);
    xs.push(pos.x);
    ys.push(pos.y);
  }
  const anchors = link.anchors ?? [];
  for (let i = 0; i < anchors.length; i++) {
    if (i === excludeIndex) continue;
    xs.push(anchors[i].x);
    ys.push(anchors[i].y);
  }
  return { xs, ys };
}
