import {
  dataInfo, recipeFor, bufferCap, fmt, fmtRate, tierLabel, withAlpha,
} from './gamedata.js';
import {
  nodeBounds, inputPorts, outputPort, portWorldPos,
  bezierPoints, bezierAt, boundsOfNodes, linkPath, draftPath, targetPortFor,
  GRID, SIZES,
} from './layout.js';
import { nodeStatus } from './sim.js';

const UI_FONT = '"Bahnschrift", "DIN Alternate", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
const MONO_FONT = '"Cascadia Mono", "Cascadia Code", Consolas, "SFMono-Regular", monospace';
const TAU = Math.PI * 2;

const COLORS = {
  cardTop: '#101a24',
  cardBottom: '#0b131b',
  cardEdge: '#22313f',
  cardEdgeHot: '#3c5165',
  ink: '#dbe6ed',
  muted: '#7f909e',
  dim: '#53616f',
  bone: '#e9dfc7',
  ok: '#7cdda6',
  warn: '#e6b35c',
  bad: '#e37b6f',
};

const STATUS_TONE = {
  running: COLORS.ok,
  receiving: COLORS.ok,
  limited: COLORS.warn,
  starved: COLORS.warn,
  blocked: COLORS.bad,
  idle: COLORS.dim,
};

export class Renderer {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.app = app;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.born = new Map();
    this.linkBorn = new Map();
    this.gradients = new Map();
    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
  }

  worldToScreen(x, y) {
    const cam = this.app.state.camera;
    return {
      x: (x - cam.x) * cam.zoom + this.w / 2,
      y: (y - cam.y) * cam.zoom + this.h / 2,
    };
  }

  screenToWorld(x, y) {
    const cam = this.app.state.camera;
    return {
      x: (x - this.w / 2) / cam.zoom + cam.x,
      y: (y - this.h / 2) / cam.zoom + cam.y,
    };
  }

  zoomAt(x, y, factor) {
    const cam = this.app.state.camera;
    const before = this.screenToWorld(x, y);
    cam.zoom = Math.min(2.2, Math.max(0.35, cam.zoom * factor));
    const after = this.screenToWorld(x, y);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  }

  fit(nodes = this.app.state.nodes) {
    if (!nodes.length) return;
    const cam = this.app.state.camera;
    const b = boundsOfNodes(nodes);
    const narrow = this.w <= 900;
    const inspectorOpen = Boolean(this.app.view.selection);
    const left = narrow ? 16 : 330;
    const right = narrow ? 16 : (inspectorOpen ? 340 : 90);
    const top = narrow ? 76 : 92;
    const bottom = narrow ? 150 : 60;
    const availW = Math.max(200, this.w - left - right);
    const availH = Math.max(240, this.h - top - bottom);
    const minZoom = 0.35;
    const zoom = Math.min(1.25, Math.max(minZoom, Math.min(
      availW / (b.right - b.left + 60),
      availH / (b.bottom - b.top + 60),
    )));
    cam.zoom = zoom;
    const targetScreenX = left + availW / 2;
    const targetScreenY = top + availH / 2;
    cam.x = (b.left + b.right) / 2 - (targetScreenX - this.w / 2) / zoom;
    cam.y = (b.top + b.bottom) / 2 - (targetScreenY - this.h / 2) / zoom;
  }

  draw(now) {
    const ctx = this.ctx;
    const state = this.app.state;
    const view = this.app.view;
    const animating = view.motion !== false && !view.paused;
    if (animating || this.animNow === undefined) this.animNow = now;
    const animNow = this.animNow;
    const t = animNow / 1000;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    this.drawBackground(ctx, state.camera, t);

    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(state.camera.zoom, state.camera.zoom);
    ctx.translate(-state.camera.x, -state.camera.y);

    const viewBox = this.viewBounds();
    const byId = new Map(state.nodes.map((node) => [node.id, node]));
    this.drawGrid(ctx, viewBox);
    if (view.dragCell) {
      this.drawFootprint(ctx, view.dragCell.x, view.dragCell.y, view.dragCell.kind, 'rgba(233, 223, 199, 0.26)');
    }
    for (const link of state.links) {
      const from = byId.get(link.from);
      const to = byId.get(link.to);
      if (!from || !to) continue;
      if (!this.linkVisible(link, from, to, viewBox)) continue;
      this.drawLink(ctx, link, from, to, animNow, view);
    }

    this.drawStarterGuide(ctx, state, animNow);
    if (view.linkDraft) this.drawDraft(ctx, view, animNow, byId);
    if (view.ghost) this.drawGhost(ctx, view.ghost, animNow);

    for (const node of state.nodes) {
      if (!this.nodeVisible(node, viewBox)) continue;
      this.drawNode(ctx, node, now, animNow, view, t);
    }

    ctx.restore();
  }

  viewBounds() {
    const cam = this.app.state.camera;
    const halfW = this.w / 2 / cam.zoom;
    const halfH = this.h / 2 / cam.zoom;
    return {
      left: cam.x - halfW - 240,
      right: cam.x + halfW + 240,
      top: cam.y - halfH - 240,
      bottom: cam.y + halfH + 240,
    };
  }

  nodeVisible(node, box) {
    const b = nodeBounds(node);
    return b.right >= box.left && b.left <= box.right && b.bottom >= box.top && b.top <= box.bottom;
  }

  linkVisible(link, from, to, box) {
    const outPort = outputPort(from);
    const inPort = targetPortFor(link, to, from);
    if (!outPort || !inPort) return false;
    const a = portWorldPos(from, outPort);
    const b = portWorldPos(to, inPort);
    const minX = Math.min(a.x, b.x) - 80;
    const maxX = Math.max(a.x, b.x) + 80;
    const minY = Math.min(a.y, b.y) - 80;
    const maxY = Math.max(a.y, b.y) + 80;
    let left = minX;
    let right = maxX;
    let top = minY;
    let bottom = maxY;
    for (const anchor of link.anchors || []) {
      left = Math.min(left, anchor.x - 80);
      right = Math.max(right, anchor.x + 80);
      top = Math.min(top, anchor.y - 80);
      bottom = Math.max(bottom, anchor.y + 80);
    }
    return right >= box.left && left <= box.right && bottom >= box.top && top <= box.bottom;
  }

  drawBackground(ctx, cam, t) {
    const { w, h } = this;
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#070c12');
    base.addColorStop(0.55, '#060a0f');
    base.addColorStop(1, '#04070a');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * 0.54, h * 0.42, 0, w * 0.54, h * 0.42, Math.max(w, h) * 0.65);
    glow.addColorStop(0, 'rgba(45, 72, 91, 0.16)');
    glow.addColorStop(0.55, 'rgba(24, 41, 53, 0.07)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    let step = 32;
    while (step * cam.zoom < 15) step *= 2;
    while (step * cam.zoom > 90) step /= 2;
    const gap = step * cam.zoom;
    const origin = this.worldToScreen(0, 0);
    const startX = ((origin.x % gap) + gap) % gap;
    const startY = ((origin.y % gap) + gap) % gap;

    ctx.fillStyle = 'rgba(118, 153, 177, 0.13)';
    ctx.beginPath();
    for (let x = startX; x < w; x += gap) {
      for (let y = startY; y < h; y += gap) {
        ctx.rect(x, y, 1.1, 1.1);
      }
    }
    ctx.fill();

    ctx.strokeStyle = 'rgba(120, 160, 185, 0.10)';
    ctx.lineWidth = 1;
    const ox = origin.x;
    const oy = origin.y;
    if (ox > 0 && ox < w) {
      ctx.beginPath();
      ctx.moveTo(ox, 0);
      ctx.lineTo(ox, h);
      ctx.stroke();
    }
    if (oy > 0 && oy < h) {
      ctx.beginPath();
      ctx.moveTo(0, oy);
      ctx.lineTo(w, oy);
      ctx.stroke();
    }

    const sweep = 0.5 + 0.5 * Math.sin(t * 0.24);
    ctx.strokeStyle = `rgba(124, 221, 166, ${0.018 + sweep * 0.012})`;
    ctx.beginPath();
    ctx.arc(ox, oy, 210 * cam.zoom, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ox, oy, 360 * cam.zoom, 0, TAU);
    ctx.stroke();
  }

  drawGrid(ctx, box) {
    const zoom = this.app.state.camera.zoom;
    let step = GRID.cell;
    while (step * zoom < 11) step *= 2;
    const startX = Math.floor(box.left / step) * step;
    const startY = Math.floor(box.top / step) * step;
    ctx.save();
    ctx.lineWidth = 1 / zoom;
    ctx.strokeStyle = 'rgba(122, 162, 186, 0.085)';
    ctx.beginPath();
    for (let x = startX; x <= box.right; x += step) {
      ctx.moveTo(x, box.top);
      ctx.lineTo(x, box.bottom);
    }
    for (let y = startY; y <= box.bottom; y += step) {
      ctx.moveTo(box.left, y);
      ctx.lineTo(box.right, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawFootprint(ctx, x, y, kind, color) {
    const zoom = this.app.state.camera.zoom;
    const size = SIZES[kind] || SIZES.processor;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.1 / zoom;
    ctx.setLineDash([5 / zoom, 5 / zoom]);
    ctx.strokeRect(x - size.w / 2, y - size.h / 2, size.w, size.h);
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawStarterGuide(ctx, state, now) {
    if (state.links.length > 0 || state.hintDismissed) return;
    if (this.app.view.linkDraft || this.app.view.pendingBuild) return;
    const extractor = state.nodes.find((node) => node.kind === 'extractor');
    const vault = state.nodes.find((node) => node.kind === 'vault');
    if (!extractor || !vault) return;
    const fromPort = outputPort(extractor);
    const toPort = targetPortFor({ tier: 0, anchors: [] }, vault, extractor);
    if (!fromPort || !toPort) return;
    const points = bezierPoints(portWorldPos(extractor, fromPort), portWorldPos(vault, toPort));
    const zoom = state.camera.zoom;
    const info = dataInfo(0);

    ctx.save();
    ctx.strokeStyle = 'rgba(230, 179, 92, 0.32)';
    ctx.lineWidth = 1.4 / zoom;
    ctx.setLineDash([5 / zoom, 8 / zoom]);
    ctx.lineDashOffset = -((now / 38) % (13 / zoom));
    ctx.beginPath();
    ctx.moveTo(points.a.x, points.a.y);
    ctx.bezierCurveTo(points.b.x, points.b.y, points.c.x, points.c.y, points.d.x, points.d.y);
    ctx.stroke();
    ctx.setLineDash([]);

    const t = (now / 2400) % 1;
    const pulse = bezierAt(points, t);
    const pulseRadius = 3.4 / zoom;
    ctx.fillStyle = info.color;
    ctx.globalAlpha = 0.5 + 0.4 * Math.sin(now / 260);
    ctx.beginPath();
    ctx.arc(pulse.x, pulse.y, pulseRadius, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    const angle = Math.atan2(points.d.y - points.c.y, points.d.x - points.c.x);
    const head = 8 / zoom;
    const spread = 2.55;
    const ax = points.d.x - Math.cos(angle) * head;
    const ay = points.d.y - Math.sin(angle) * head;
    ctx.strokeStyle = 'rgba(230, 179, 92, 0.55)';
    ctx.lineWidth = 1.5 / zoom;
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(angle + spread) * head, ay + Math.sin(angle + spread) * head);
    ctx.lineTo(points.d.x, points.d.y);
    ctx.lineTo(ax + Math.cos(angle - spread) * head, ay + Math.sin(angle - spread) * head);
    ctx.stroke();
    ctx.restore();
  }

  drawLink(ctx, link, from, to, now, view) {
    const path = linkPath(link, from, to);
    if (!path) return;
    const info = dataInfo(link.tier);
    const zoom = this.app.state.camera.zoom;
    const flow = link._flow || 0;
    const priority = link.priority === 0.5 ? 0.5 : link.priority === 2 ? 2 : 1;
    const selected = (view.selection?.kind === 'link' && view.selection.id === link.id) ||
      (view.selection?.kind === 'anchor' && view.selection.linkId === link.id);
    const routed = path.kind === 'route';

    if (!this.linkBorn.has(link.id)) this.linkBorn.set(link.id, now);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    tracePath(ctx, path);
    ctx.strokeStyle = 'rgba(3, 6, 9, 0.9)';
    ctx.lineWidth = (selected ? 6 : 4.5) / zoom;
    ctx.stroke();

    tracePath(ctx, path);
    if (flow <= 0.002) {
      ctx.setLineDash([5 / zoom, 6 / zoom]);
      ctx.strokeStyle = withAlpha(info.color, 0.32);
      ctx.lineWidth = 1.4 / zoom;
    } else {
      ctx.strokeStyle = withAlpha(info.color, selected ? 0.95 : 0.44 + priority * 0.24);
      ctx.lineWidth = ((selected ? 2.6 : 1.9) * (priority === 2 ? 1.35 : priority === 0.5 ? 0.8 : 1)) / zoom;
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (selected) {
      ctx.strokeStyle = 'rgba(233, 223, 199, 0.35)';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
    }

    if (view.motion && flow > 0.002 && this.app.state.camera.zoom > 0.42) {
      const count = flow > 8 ? 4 : flow > 1 ? 3 : flow > 0.08 ? 2 : 1;
      const speed = 0.09 + Math.min(0.34, Math.log10(1 + flow * 9) * 0.11);
      ctx.fillStyle = info.bright;
      for (let i = 0; i < count; i++) {
        const phase = ((now / 1000) * speed + i / count + (link.id * 0.137)) % 1;
        const point = path.at(phase);
        const radius = 2.1 / zoom;
        ctx.globalAlpha = 0.14;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius * 2.6, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (routed) this.drawAnchors(ctx, link, info, view, zoom);
    ctx.restore();
  }

  drawAnchors(ctx, link, info, view, zoom) {
    const anchors = link.anchors || [];
    const activeLink = view.selection?.kind === 'anchor' && view.selection.linkId === link.id;
    const hoverLink = view.hoverAnchor?.linkId === link.id;
    for (let index = 0; index < anchors.length; index++) {
      const anchor = anchors[index];
      const picked = (activeLink && view.selection.index === index) ||
        (hoverLink && view.hoverAnchor.index === index);
      const size = (picked ? 5.2 : 3.2) / zoom;
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y - size);
      ctx.lineTo(anchor.x + size, anchor.y);
      ctx.lineTo(anchor.x, anchor.y + size);
      ctx.lineTo(anchor.x - size, anchor.y);
      ctx.closePath();
      ctx.fillStyle = picked ? COLORS.bone : withAlpha(info.color, 0.85);
      ctx.fill();
      ctx.strokeStyle = 'rgba(3, 6, 9, 0.85)';
      ctx.lineWidth = 1.2 / zoom;
      ctx.stroke();
    }
  }

  drawDraft(ctx, view, now, byId) {
    const draft = view.linkDraft;
    const from = byId.get(draft.fromId);
    if (!from) return;
    const path = draftPath(draft, from);
    if (!path) return;
    const info = dataInfo(draft.tier);
    const zoom = this.app.state.camera.zoom;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    tracePath(ctx, path);
    ctx.strokeStyle = 'rgba(3, 6, 9, 0.85)';
    ctx.lineWidth = 4.4 / zoom;
    ctx.stroke();

    tracePath(ctx, path);
    ctx.strokeStyle = info.color;
    ctx.lineWidth = 2 / zoom;
    ctx.setLineDash([6 / zoom, 5 / zoom]);
    ctx.lineDashOffset = -(now / 35) % 100;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = info.bright;
    for (const point of draft.points || []) {
      const size = 4 / zoom;
      ctx.beginPath();
      ctx.moveTo(point.x, point.y - size);
      ctx.lineTo(point.x + size, point.y);
      ctx.lineTo(point.x, point.y + size);
      ctx.lineTo(point.x - size, point.y);
      ctx.closePath();
      ctx.fill();
    }

    const end = draft.targetPos || { x: draft.x, y: draft.y };
    if (!draft.targetPos) {
      const size = 5.5 / zoom;
      const reach = 13 / zoom;
      ctx.strokeStyle = withAlpha(info.color, 0.8);
      ctx.lineWidth = 1.1 / zoom;
      ctx.beginPath();
      ctx.moveTo(end.x - reach, end.y);
      ctx.lineTo(end.x - size, end.y);
      ctx.moveTo(end.x + size, end.y);
      ctx.lineTo(end.x + reach, end.y);
      ctx.moveTo(end.x, end.y - reach);
      ctx.lineTo(end.x, end.y - size);
      ctx.moveTo(end.x, end.y + size);
      ctx.lineTo(end.x, end.y + reach);
      ctx.stroke();
      ctx.strokeRect(end.x - size, end.y - size, size * 2, size * 2);
    }
    ctx.fillStyle = info.bright;
    ctx.beginPath();
    ctx.arc(end.x, end.y, 4.2 / zoom, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawNode(ctx, node, now, animNow, view, t) {
    const zoom = this.app.state.camera.zoom;
    const selected = view.selection?.kind === 'node' && view.selection.id === node.id;
    const hovered = view.hoverNode === node.id;
    let born = this.born.get(node.id);
    if (born === undefined) {
      born = now;
      this.born.set(node.id, now);
    }
    const age = view.motion === false ? 1 : Math.min(1, Math.max(0, (now - born) / 260));
    const scale = 0.92 + 0.08 * easeOut(age);
    if (age < 1) {
      ctx.save();
      ctx.globalAlpha = age;
      ctx.translate(node.x, node.y);
      ctx.scale(scale, scale);
      ctx.translate(-node.x, -node.y);
    }

    if (node.kind === 'vault') this.drawVault(ctx, node, animNow, view, selected, hovered);
    else this.drawMachine(ctx, node, animNow, view, selected, hovered, t);

    if (selected) this.drawReticle(ctx, node, zoom);
    if (age < 1) ctx.restore();
  }

  cardGradients(node, b, info, hovered) {
    let entry = this.gradients.get(node.id);
    if (!entry || entry.bx !== b.left || entry.by !== b.top || entry.bw !== b.w || entry.bh !== b.h ||
        entry.tier !== info.tier || entry.hovered !== hovered) {
      const body = this.ctx.createLinearGradient(0, b.top, 0, b.bottom);
      body.addColorStop(0, hovered ? '#12202c' : COLORS.cardTop);
      body.addColorStop(1, COLORS.cardBottom);
      const wash = this.ctx.createLinearGradient(b.left, 0, b.right, 0);
      wash.addColorStop(0, withAlpha(info.color, 0.10));
      wash.addColorStop(0.55, 'rgba(0,0,0,0)');
      entry = { bx: b.left, by: b.top, bw: b.w, bh: b.h, tier: info.tier, hovered, body, wash };
      this.gradients.set(node.id, entry);
    }
    return entry;
  }

  drawMachine(ctx, node, now, view, selected, hovered, t) {
    const zoom = this.app.state.camera.zoom;
    const b = nodeBounds(node);
    const info = node.kind === 'extractor' ? dataInfo(0) : dataInfo(node.tier);
    const radius = 5;
    const top = b.top;
    const compact = zoom < 0.8;
    const minimal = zoom < 0.52;

    ctx.save();
    if (!minimal) {
      roundRect(ctx, b.left, b.top + 4, b.w, b.h, radius);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
      ctx.fill();
    }

    const gradients = this.cardGradients(node, b, info, hovered);
    roundRect(ctx, b.left, b.top, b.w, b.h, radius);
    ctx.fillStyle = gradients.body;
    ctx.fill();
    ctx.lineWidth = selected ? 1.6 : 1;
    ctx.strokeStyle = selected ? info.dim : hovered ? COLORS.cardEdgeHot : COLORS.cardEdge;
    ctx.stroke();

    if (!minimal) {
      ctx.save();
      roundRect(ctx, b.left, b.top, b.w, b.h, radius);
      ctx.clip();
      ctx.fillStyle = gradients.wash;
      ctx.fillRect(b.left, b.top, b.w, 42);
      ctx.strokeStyle = withAlpha(info.color, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(b.left, b.top + 1);
      ctx.lineTo(b.right, b.top + 1);
      ctx.stroke();
      ctx.restore();
    }

    const glyphX = b.left + 24;
    const glyphY = top + 20;
    if (!minimal) {
      ctx.fillStyle = info.soft;
      roundRect(ctx, glyphX - 11, glyphY - 11, 22, 22, 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha(info.color, 0.45);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    drawShape(ctx, info.shape, glyphX, glyphY, 5.4, info.bright, 1);

    if (compact) {
      this.drawCompactMachine(ctx, node, b, info, top, zoom, minimal);
      this.drawPorts(ctx, node, view, now, minimal);
      ctx.restore();
      return;
    }

    const title = info.name.toUpperCase();
    ctx.fillStyle = COLORS.ink;
    setFont(ctx, 600, 11, false);
    const titleX = b.left + 44;
    const maxTitle = b.w - 44 - 38;
    ctx.fillText(fitText(ctx, title, maxTitle), titleX, top + 17);

    setFont(ctx, 400, 8, true);
    ctx.fillStyle = COLORS.dim;
    const kind = node.kind === 'extractor' ? 'EXTRACTOR' : `FORGE ${tierLabel(node.tier)}`;
    ctx.fillText(kind, titleX, top + 29);

    setFont(ctx, 400, 8.5, true);
    ctx.fillStyle = COLORS.dim;
    ctx.textAlign = 'right';
    ctx.fillText(`LV ${node.level}`, b.right - 12, top + 17);
    ctx.textAlign = 'left';

    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(b.left + 12, top + 37);
    ctx.lineTo(b.right - 12, top + 37);
    ctx.stroke();

    const status = nodeStatus(this.app.state, node);
    const util = Math.max(0, Math.min(1, node._util || 0));
    const dotColor = STATUS_TONE[status] || COLORS.dim;
    const dotPulse = status === 'running' || status === 'receiving' ? 0.65 + 0.35 * Math.sin(t * 4 + node.id) : 1;
    ctx.globalAlpha = dotPulse;
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(b.left + 16, top + 48, 2.4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    setFont(ctx, 400, 8, true);
    ctx.fillStyle = withAlpha(dotColor, 0.9);
    ctx.fillText(status.toUpperCase(), b.left + 23, top + 51);

    if (node.kind === 'processor') {
      const recipe = recipeFor(node.tier);
      const recipeLabel = recipe.inputs.map((input) => `${input.amount}×${tierLabel(input.tier)}`).join(' + ');
      setFont(ctx, 400, 8, true);
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(`${recipeLabel}  →  1×${tierLabel(recipe.output.tier)}`, b.left + 12, top + 64);
    } else {
      setFont(ctx, 400, 8, true);
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(fmtRate((node._flowOut || 0) || 0.0), b.left + 12, top + 64);
    }

    ctx.textAlign = 'right';
    setFont(ctx, 400, 8, true);
    ctx.fillStyle = COLORS.dim;
    ctx.fillText(`${Math.round(util * 100)}%`, b.right - 12, top + 51);
    ctx.textAlign = 'left';

    const cap = bufferCap(this.app.state, node);
    const ratio = Math.max(0, Math.min(1, (node.out?.amount || 0) / (cap || 1)));
    const barLeft = b.left + 12;
    const barTop = top + 76;
    const barW = b.w - 24;
    roundRect(ctx, barLeft, barTop, barW, 5, 2.5);
    ctx.fillStyle = 'rgba(255,255,255,0.055)';
    ctx.fill();
    if (ratio > 0.002) {
      roundRect(ctx, barLeft, barTop, Math.max(3, barW * ratio), 5, 2.5);
      ctx.fillStyle = withAlpha(info.color, 0.82);
      ctx.fill();
    }
    this.drawPorts(ctx, node, view, now, minimal);
    ctx.restore();
  }

  drawCompactMachine(ctx, node, b, info, top, zoom, minimal) {
    const status = nodeStatus(this.app.state, node);
    const dotColor = STATUS_TONE[status] || COLORS.dim;
    const kind = node.kind === 'extractor' ? 'RAW' : 'FORGE';
    const label = node.kind === 'extractor' ? 'T00' : tierLabel(node.tier);
    const center = b.left + b.w / 2;

    ctx.textAlign = 'center';
    setFont(ctx, 600, 24, true);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(label, center, top + 40);
    if (minimal) {
      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(center, top + 70, 5, 0, TAU);
      ctx.fill();
      ctx.textAlign = 'left';
      return;
    }
    setFont(ctx, 500, 12, true);
    ctx.fillStyle = withAlpha(info.color, 0.85);
    ctx.fillText(kind, center, top + 62);

    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(center - 30, top + 78, 5, 0, TAU);
    ctx.fill();
    setFont(ctx, 400, 12, true);
    ctx.fillStyle = withAlpha(dotColor, 0.9);
    ctx.fillText(status.toUpperCase(), center + 4, top + 83);
    ctx.textAlign = 'left';
  }

  drawVault(ctx, vault, now, view, selected, hovered) {
    const zoom = this.app.state.camera.zoom;
    const b = nodeBounds(vault);
    const cx = vault.x;
    const cy = vault.y;
    const receiving = (vault._flowIn || 0) > 0.005 || this.app.state.links.some((link) => link.to === vault.id && (link._flow || 0) > 0.005);
    const info = dataInfo(this.app.state.unlockedTier);
    const compact = zoom < 0.8;

    ctx.save();
    roundRect(ctx, b.left, b.top + 5, b.w, b.h, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.36)';
    ctx.fill();

    let entry = this.gradients.get('vault');
    if (!entry || entry.vx !== b.left || entry.vy !== b.top || entry.vh !== b.h || entry.hovered !== hovered) {
      const fill = ctx.createLinearGradient(0, b.top, 0, b.bottom);
      fill.addColorStop(0, hovered ? '#12202a' : '#0d1720');
      fill.addColorStop(1, '#080f15');
      entry = { vx: b.left, vy: b.top, vh: b.h, hovered, fill };
      this.gradients.set('vault', entry);
    }

    roundRect(ctx, b.left, b.top, b.w, b.h, 8);
    ctx.fillStyle = entry.fill;
    ctx.fill();
    ctx.lineWidth = selected ? 1.7 : 1;
    ctx.strokeStyle = selected ? COLORS.bone : hovered ? COLORS.cardEdgeHot : '#263745';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(233, 223, 199, 0.16)';
    ctx.lineWidth = 1;
    roundRect(ctx, b.left + 6, b.top + 6, b.w - 12, b.h - 12, 5);
    ctx.stroke();

    const bank = this.app.state.bank;
    let total = 0;
    let types = 0;
    for (const amount of Object.values(bank)) {
      if (!Number.isFinite(amount) || amount <= 0.005) continue;
      total += amount;
      types++;
    }
    let incoming = 0;
    for (const link of this.app.state.links) if (link.to === vault.id) incoming += link._flow || 0;

    ctx.textAlign = 'center';
    if (compact) {
      setFont(ctx, 500, 15, true);
      ctx.fillStyle = COLORS.muted;
      ctx.fillText('VAULT', cx, b.top + 36);

      setFont(ctx, 600, 30, true);
      ctx.fillStyle = COLORS.bone;
      ctx.fillText(fmt(total), cx, b.top + 84);
      setFont(ctx, 400, 12, true);
      ctx.fillStyle = COLORS.dim;
      ctx.fillText('UNITS HELD', cx, b.top + 106);

      setFont(ctx, 400, 12, true);
      ctx.fillStyle = COLORS.dim;
      ctx.fillText(`${types} type${types === 1 ? '' : 's'}`, cx, b.bottom - 38);
      setFont(ctx, 400, 12, true);
      ctx.fillStyle = incoming > 0.005 ? info.color : COLORS.dim;
      ctx.fillText(incoming > 0.005 ? fmtRate(incoming) : 'idle', cx, b.bottom - 18);
      ctx.textAlign = 'left';
      this.drawPorts(ctx, vault, view, now);
      ctx.restore();
      return;
    }

    setFont(ctx, 500, 9, true);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText('V A U L T', cx, b.top + 24);

    const ringR = 52;
    ctx.strokeStyle = 'rgba(233, 223, 199, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = receiving ? withAlpha(info.color, 0.75) : 'rgba(233, 223, 199, 0.24)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.arc(cx, cy, ringR - 7, now / 2200, now / 2200 + TAU * 0.72);
    ctx.stroke();
    ctx.setLineDash([]);

    const pulse = receiving ? 0.5 + 0.5 * Math.sin(now / 360) : 0;
    if (receiving) {
      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, ringR);
      glow.addColorStop(0, withAlpha(info.color, 0.12));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = withAlpha(info.color, 0.22 + pulse * 0.22);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, ringR + 3 + pulse * 2, 0, TAU);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(233, 223, 199, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, ringR - 15, 0, TAU);
    ctx.stroke();

    setFont(ctx, 600, 15, true);
    ctx.fillStyle = COLORS.bone;
    ctx.fillText(fmt(total), cx, cy + 1);
    setFont(ctx, 400, 6.5, true);
    ctx.fillStyle = COLORS.dim;
    ctx.fillText('UNITS HELD', cx, cy + 13);

    setFont(ctx, 400, 7.5, true);
    ctx.fillStyle = COLORS.dim;
    ctx.fillText(`${types} type${types === 1 ? '' : 's'} held`, cx, b.bottom - 26);
    setFont(ctx, 400, 7.5, true);
    ctx.fillStyle = incoming > 0.005 ? info.color : COLORS.dim;
    ctx.fillText(incoming > 0.005 ? `${fmtRate(incoming)} incoming` : 'awaiting input', cx, b.bottom - 12);
    ctx.textAlign = 'left';

    this.drawPorts(ctx, vault, view, now);
    ctx.restore();
  }

  drawPorts(ctx, node, view, now, minimal = false) {
    const zoom = this.app.state.camera.zoom;
    const ports = [...inputPorts(node)];
    const out = outputPort(node);
    if (out) ports.push(out);
    const draft = view.linkDraft;

    for (const port of ports) {
      const pos = portWorldPos(node, port);
      const isOut = port.dir === 'out';
      const hovered = view.hoverPort?.nodeId === node.id &&
        view.hoverPort.dir === port.dir &&
        view.hoverPort.index === port.index;
      const compatible = draft && !isOut && !draft.targetId &&
        (port.universal || port.tier === draft.tier) &&
        node.id !== draft.fromId;

      const portInfo = port.universal ? null : dataInfo(port.tier);
      const color = portInfo ? portInfo.bright : COLORS.bone;

      if (compatible) {
        const pulse = 0.5 + 0.5 * Math.sin(now / 180);
        ctx.strokeStyle = withAlpha(color, 0.25 + pulse * 0.4);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 9 + pulse * 2.5, 0, TAU);
        ctx.stroke();
      }

      if (minimal) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 2.6, 0, TAU);
        ctx.fill();
        continue;
      }

      ctx.fillStyle = '#060b10';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, hovered ? 7 : 5.6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = hovered ? color : (port.universal ? '#8f7f61' : withAlpha(color, 0.7));
      ctx.lineWidth = hovered ? 2 : 1.3;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, isOut ? 2.5 : 2.2, 0, TAU);
      ctx.fill();

      if (zoom > 0.9 && !port.universal && port.tier !== null) {
        setFont(ctx, 400, 6.8, true);
        ctx.fillStyle = portInfo.dim;
        ctx.textAlign = isOut ? 'left' : 'right';
        ctx.fillText(tierLabel(port.tier), pos.x + (isOut ? 9 : -9), pos.y + 2.2);
        ctx.textAlign = 'left';
      }
    }
  }

  drawReticle(ctx, node, zoom) {
    const b = nodeBounds(node);
    const pad = 7;
    const len = 10;
    const left = b.left - pad;
    const right = b.right + pad;
    const top = b.top - pad;
    const bottom = b.bottom + pad;
    const color = node.kind === 'vault'
      ? COLORS.bone
      : dataInfo(node.kind === 'extractor' ? 0 : node.tier).color;
    ctx.save();
    ctx.strokeStyle = withAlpha(color, 0.85);
    ctx.lineWidth = 1.4 / zoom;
    ctx.beginPath();
    ctx.moveTo(left, top + len); ctx.lineTo(left, top); ctx.lineTo(left + len, top);
    ctx.moveTo(right - len, top); ctx.lineTo(right, top); ctx.lineTo(right, top + len);
    ctx.moveTo(right, bottom - len); ctx.lineTo(right, bottom); ctx.lineTo(right - len, bottom);
    ctx.moveTo(left + len, bottom); ctx.lineTo(left, bottom); ctx.lineTo(left, bottom - len);
    ctx.stroke();
    ctx.restore();
  }

  drawGhost(ctx, ghost, now) {
    const kind = ghost.kind;
    const size = SIZES[kind] || SIZES.processor;
    const info = dataInfo(kind === 'extractor' ? 0 : ghost.tier);
    const color = ghost.valid ? info.color : 'rgba(227, 123, 111, 0.9)';
    const left = ghost.x - size.w / 2;
    const top = ghost.y - size.h / 2;
    const zoom = this.app.state.camera.zoom;
    ctx.save();
    if (ghost.valid) this.drawFootprint(ctx, ghost.x, ghost.y, kind, withAlpha(info.color, 0.30));
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ghost.valid ? info.faint : 'rgba(227,123,111,0.05)';
    roundRect(ctx, left, top, size.w, size.h, 5);
    ctx.fill();
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -(now / 90) % 10;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.8;
    setFont(ctx, 500, 9, true);
    ctx.fillStyle = ghost.valid ? info.color : COLORS.bad;
    ctx.fillText(ghost.valid ? (kind === 'processor' ? dataInfo(ghost.tier).name.toUpperCase() : 'EXTRACTOR') : 'BLOCKED', left + 12, top + 20);
    ctx.restore();
  }
}

function tracePath(ctx, path) {
  ctx.beginPath();
  if (path.kind === 'curve') {
    const curve = path.curve;
    ctx.moveTo(curve.a.x, curve.a.y);
    ctx.bezierCurveTo(curve.b.x, curve.b.y, curve.c.x, curve.c.y, curve.d.x, curve.d.y);
    return;
  }
  const points = path.points;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const corner = points[i];
    const prev = points[i - 1];
    const next = points[i + 1];
    const inLength = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    if (inLength < 0.001 || outLength < 0.001) continue;
    const radius = Math.min(16, inLength / 2, outLength / 2);
    const ax = corner.x + ((prev.x - corner.x) / inLength) * radius;
    const ay = corner.y + ((prev.y - corner.y) / inLength) * radius;
    const bx = corner.x + ((next.x - corner.x) / outLength) * radius;
    const by = corner.y + ((next.y - corner.y) / outLength) * radius;
    ctx.lineTo(ax, ay);
    ctx.quadraticCurveTo(corner.x, corner.y, bx, by);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function setFont(ctx, weight, size, mono) {
  ctx.font = `${weight} ${size}px ${mono ? MONO_FONT : UI_FONT}`;
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 3 && ctx.measureText(cut + '…').width > maxWidth) cut = cut.slice(0, -1);
  return cut + '…';
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

function drawShape(ctx, shape, x, y, r, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  if (shape === 'square') {
    ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
  } else if (shape === 'diamond') {
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
  } else if (shape === 'circle') {
    ctx.arc(x, y, r * 0.82, 0, TAU);
  } else if (shape === 'hex') {
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (shape === 'triangle') {
    ctx.moveTo(x, y - r); ctx.lineTo(x + r * 0.92, y + r * 0.65); ctx.lineTo(x - r * 0.92, y + r * 0.65); ctx.closePath();
  } else if (shape === 'ring') {
    ctx.arc(x, y, r * 0.75, 0, TAU);
    ctx.stroke();
    ctx.restore();
    return;
  } else if (shape === 'bars') {
    ctx.rect(x - r * 0.72, y - r * 0.8, r * 0.5, r * 1.6);
    ctx.rect(x + r * 0.22, y - r * 0.8, r * 0.5, r * 1.6);
  } else {
    ctx.rect(x - r * 0.25, y - r, r * 0.5, r * 2);
    ctx.rect(x - r, y - r * 0.25, r * 2, r * 0.5);
  }
  ctx.fill();
  ctx.restore();
}
