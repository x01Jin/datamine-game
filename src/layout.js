import { recipeFor } from './gamedata.js';

export const SIZES = {
  extractor: { w: 188, h: 104 },
  processor: { w: 196, h: 116 },
  vault: { w: 168, h: 168 },
};

export const GRID = Object.freeze({
  cellW: 232,
  cellH: 190,
  fine: 24,
  margin: 12,
});

const PORT_STUB = 26;

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
    return [{ dir: 'in', tier: null, index: 0, dx: -SIZES.vault.w / 2, dy: 0, universal: true }];
  }
  if (node.kind !== 'processor') return [];
  const recipe = recipeFor(node.tier);
  const start = recipe.inputs.length === 1 ? 14 : -2;
  const gap = 28;
  return recipe.inputs.map((input, index) => ({
    dir: 'in',
    tier: input.tier,
    index,
    dx: -SIZES.processor.w / 2,
    dy: start + index * gap,
    universal: false,
    amount: input.amount,
  }));
}

export function outputPort(node) {
  if (node.kind === 'vault') return null;
  const size = nodeSize(node);
  return { dir: 'out', tier: node.kind === 'extractor' ? 0 : node.tier, dx: size.w / 2, dy: 10 };
}

export function portWorldPos(node, port) {
  return { x: node.x + port.dx, y: node.y + port.dy };
}

export function findInputPort(node, tier) {
  if (node.kind === 'vault') return inputPorts(node)[0];
  return inputPorts(node).find((port) => port.tier === tier) || null;
}

export function hitNode(node, wx, wy) {
  const b = nodeBounds(node);
  return wx >= b.left && wx <= b.right && wy >= b.top && wy <= b.bottom;
}

export function hitPort(node, wx, wy, radius) {
  const ports = [...inputPorts(node)];
  const output = outputPort(node);
  if (output) ports.push(output);
  for (const port of ports) {
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
    x: Math.round(x / GRID.cellW) * GRID.cellW + 0,
    y: Math.round(y / GRID.cellH) * GRID.cellH + 0,
  };
}

function snapFine(x, y) {
  return {
    x: Math.round(x / GRID.fine) * GRID.fine + 0,
    y: Math.round(y / GRID.fine) * GRID.fine + 0,
  };
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

function targetPortFor(node, tier) {
  if (!node) return null;
  return tier === null ? inputPorts(node)[0] : findInputPort(node, tier);
}

export function linkPath(link, from, to) {
  const outPort = outputPort(from);
  const inPort = targetPortFor(to, link.tier);
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

  const points = [
    a,
    { x: a.x + PORT_STUB, y: a.y },
    ...anchors.map((anchor) => ({ x: anchor.x, y: anchor.y })),
    { x: d.x - PORT_STUB, y: d.y },
    d,
  ];
  return {
    kind: 'route',
    points,
    at: (t) => pointAlongPolyline(points, t),
    distance: (x, y) => distanceToPolyline(points, x, y),
  };
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
  const inPort = targetPortFor(to, link.tier);
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

export function snapAnchor(x, y, guides, threshold) {
  const snapped = snapFine(x, y);
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
