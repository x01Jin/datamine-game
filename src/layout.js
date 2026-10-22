import { recipeFor } from './gamedata.js';

export const SIZES = {
  extractor: { w: 192, h: 96 },
  processor: { w: 192, h: 96 },
  vault: { w: 192, h: 192 },
};

export const GRID = Object.freeze({
  cell: 24,
  margin: 12,
});

const PORT_STUB = 24;

const NORMALS = {
  e: { dx: 1, dy: 0 },
  w: { dx: -1, dy: 0 },
  n: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
};

function nodeSize(node) {
  return SIZES[node.kind] || SIZES.processor;
}

export function nodeBounds(node) {
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

export function inputPorts(node) {
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
  const dx = -SIZES.processor.w / 2;
  return recipe.inputs.map((input, index) => ({
    dir: 'in',
    tier: input.tier,
    index,
    face: 'w',
    dx,
    dy: recipe.inputs.length === 1 ? 0 : -24 + index * 48,
    universal: false,
    amount: input.amount,
  }));
}

export function outputPort(node) {
  if (node.kind === 'vault') return null;
  const size = nodeSize(node);
  return {
    dir: 'out',
    tier: node.kind === 'extractor' ? 0 : node.tier,
    index: 0,
    face: 'e',
    dx: size.w / 2,
    dy: 0,
  };
}

export function portWorldPos(node, port) {
  return { x: node.x + port.dx, y: node.y + port.dy };
}

export function findInputPort(node, tier) {
  return inputPorts(node).find((port) => port.tier === tier) || null;
}

export function faceFor(dx, dy) {
  if (Math.abs(dx) + 1 > Math.abs(dy)) return dx < 0 ? 'w' : 'e';
  return dy < 0 ? 'n' : 's';
}

export function facePort(node, face) {
  return inputPorts(node).find((port) => port.face === face) || null;
}

export function targetPortFor(link, to, from) {
  if (!to) return null;
  if (to.kind !== 'vault') {
    const ports = inputPorts(to);
    if (ports.length === 0) return null;
    return link.tier === null ? ports[0] : (findInputPort(to, link.tier) || null);
  }
  const ports = inputPorts(to);
  if (link.side) {
    const pinned = ports.find((port) => port.face === link.side);
    if (pinned) return pinned;
  }
  const anchors = link.anchors || [];
  const last = anchors.length ? anchors[anchors.length - 1] : null;
  const out = from ? outputPort(from) : null;
  const approach = last || (out ? portWorldPos(from, out) : { x: to.x, y: to.y });
  const face = faceFor(approach.x - to.x, approach.y - to.y);
  return ports.find((port) => port.face === face) || ports[0];
}

export function hitNode(node, wx, wy) {
  const b = nodeBounds(node);
  return wx >= b.left && wx <= b.right && wy >= b.top && wy <= b.bottom;
}

export function hitPort(node, wx, wy, radius) {
  const all = [...inputPorts(node)];
  const output = outputPort(node);
  if (output) all.push(output);
  for (const port of all) {
    const pos = portWorldPos(node, port);
    if ((wx - pos.x) ** 2 + (wy - pos.y) ** 2 <= radius ** 2) return port;
  }
  return null;
}

export function overlapsNode(nodes, x, y, kind, ignoreId = null) {
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

export function snapNode(x, y) {
  return {
    x: Math.round(x / GRID.cell) * GRID.cell + 0,
    y: Math.round(y / GRID.cell) * GRID.cell + 0,
  };
}

export function snapAnchor(x, y, guides, threshold) {
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

export function bezierPoints(from, to) {
  const dx = to.x - from.x;
  const offset = Math.max(54, Math.abs(dx) * 0.46);
  return {
    a: from,
    b: { x: from.x + offset, y: from.y },
    c: { x: to.x - offset, y: to.y },
    d: to,
  };
}

export function bezierAt(points, t) {
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

function distanceToBezier(points, x, y, samples = 26) {
  let last = bezierAt(points, 0);
  let best = Infinity;
  for (let i = 1; i <= samples; i++) {
    const next = bezierAt(points, i / samples);
    best = Math.min(best, distanceToSegment(x, y, last.x, last.y, next.x, next.y));
    last = next;
  }
  return best;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function boundsOfNodes(nodes) {
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

function stubPoint(pos, port) {
  const normal = NORMALS[port.face] || NORMALS.e;
  return { x: pos.x + normal.dx * PORT_STUB, y: pos.y + normal.dy * PORT_STUB };
}

export function routePath(points) {
  return {
    kind: 'route',
    points,
    at: (t) => pointAlongPolyline(points, t),
    distance: (x, y) => distanceToPolyline(points, x, y),
  };
}

export function linkPath(link, from, to) {
  const outPort = outputPort(from);
  const inPort = targetPortFor(link, to, from);
  if (!outPort || !inPort) return null;
  const a = portWorldPos(from, outPort);
  const d = portWorldPos(to, inPort);
  const anchors = link.anchors || [];

  if (anchors.length === 0) {
    const curve = bezierPoints(a, d);
    return {
      kind: 'curve',
      curve,
      at: (t) => bezierAt(curve, t),
      distance: (x, y) => distanceToBezier(curve, x, y),
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

export function draftPath(draft, from) {
  const port = outputPort(from);
  if (!port) return null;
  const start = portWorldPos(from, port);
  const points = [start, stubPoint(start, port)];
  for (const point of draft.points || []) points.push({ x: point.x, y: point.y });
  if (draft.targetFace && draft.targetPos) {
    const end = { x: draft.targetPos.x, y: draft.targetPos.y };
    points.push(stubPoint(end, { face: draft.targetFace }));
    points.push(end);
  } else {
    points.push({ x: draft.x, y: draft.y });
  }
  return routePath(points);
}

function pointAlongPolyline(points, t) {
  const lengths = segmentLengths(points);
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

function distanceToPolyline(points, x, y) {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    best = Math.min(best, distanceToSegment(x, y, points[i].x, points[i].y, points[i + 1].x, points[i + 1].y));
  }
  return best;
}

function segmentLengths(points) {
  const list = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    list.push(length);
    total += length;
  }
  return { list, total };
}

export function projectToPath(path, x, y, samples = 40) {
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

export function anchorGuides(link, from, to, excludeIndex = -1) {
  const xs = [];
  const ys = [];
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
  const anchors = link.anchors || [];
  for (let i = 0; i < anchors.length; i++) {
    if (i === excludeIndex) continue;
    xs.push(anchors[i].x);
    ys.push(anchors[i].y);
  }
  return { xs, ys };
}
