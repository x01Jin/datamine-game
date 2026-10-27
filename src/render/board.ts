import {
  Application,
  Container,
  Graphics,
  Sprite,
  TilingSprite,
  Texture,
  type BitmapText,
  type Ticker,
} from 'pixi.js';
import type { Camera, Link, MachineNode, Point, State, View } from '../game/types.ts';
import type { Bounds } from '../layout/geometry.ts';
import {
  GRID,
  boundsOfNodes,
  draftPath,
  inputPorts,
  linkPath,
  nodeBounds,
  nodeSize,
  outputPort,
  portWorldPos,
  rotationOf,
  type WirePath,
} from '../layout/geometry.ts';
import { nodeStatus } from '../game/sim.ts';
import { makeExtractor, makeProcessor } from '../game/state.ts';
import { CONFIG, bufferCap, dataInfo, fmt, recipeFor, tierLabel } from '../game/gamedata.ts';
import { CHROME, METRICS, STATUS_COLOR, tierBright, tierColor, tierDim } from './theme.ts';
import { label, setFontScale } from './labels.ts';
import { backgroundTexture, glowTexture, glyphTexture, latticeTexture, vignetteTexture } from './textures.ts';

interface NodeView {
  root: Container;
  frame: Graphics;
  glyph: Sprite;
  title: ReturnType<typeof label>;
  meta: ReturnType<typeof label>;
  status: ReturnType<typeof label>;
  detail: ReturnType<typeof label>;
  util: ReturnType<typeof label>;
  level: ReturnType<typeof label>;
  compact: ReturnType<typeof label>;
  value: ReturnType<typeof label>;
  bar: Sprite;
  dot: Sprite;
  tier: number;
  rot: number;
  kind: MachineNode['kind'];
  lastStatus: string;
  lastUtil: number;
  lastDetail: string;
  lastLevel: number;
  lod: number;
}

const PARTICLE_CAP = 420;
const FIT_MAX_ZOOM = 1.25;
const FOCUS_MS = 420;

function mod(value: number, span: number): number {
  return ((value % span) + span) % span;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function fitLabel(node: BitmapText, text: string, maxWidth: number): void {
  node.text = text;
  if (node.width <= maxWidth || text.length < 2) return;
  let cut = text.length;
  while (cut > 1 && node.width > maxWidth) {
    cut -= 1;
    node.text = `${text.slice(0, cut).trimEnd()}…`;
  }
}

export class Board {
  readonly app = new Application();

  private state: State;
  private view: View;
  private width = 0;
  private height = 0;

  private bgLayer = new Container();
  private gridLayer = new Container();
  private worldLayer = new Container();
  private wireLayer = new Container();
  private nodeLayer = new Container();
  private particleLayer = new Container();
  private overlayLayer = new Container();

  private bgGradient!: Sprite;
  private bgVignette!: Sprite;
  private bgLattice!: TilingSprite;
  private gridMinor = new Graphics();
  private gridMajor = new Graphics();
  private wireGroups = new Map<number, Graphics>();
  private wireCasing = new Graphics();
  private overlayWires = new Graphics();
  private overlayChrome = new Graphics();
  private highlightChrome = new Graphics();
  private highlightWires = new Graphics();
  private overlayText = new Container();
  private particlePool: Sprite[] = [];
  private particleTextures: Texture[] = [];

  private views = new Map<number, NodeView>();
  private paths = new Map<number, WirePath>();
  private anchorList: { linkId: number; index: number; x: number; y: number }[] = [];
  private wireSignature = 0;
  private overlaySignature = '';
  private highlightKey = '';
  private highlightLinks: Link[] = [];
  private highlightNodes: { node: MachineNode; color: number }[] = [];
  private highlightDrawn = false;
  private highlightChanged = false;
  private focusTween: {
    startX: number;
    startY: number;
    startZoom: number;
    targetX: number;
    targetY: number;
    targetZoom: number;
    startedAt: number;
  } | null = null;
  private lastZoom = 0;
  private frameTimes: number[] = [];
  private lastFrame = 0;
  private quality = 1;
  private particleCap = PARTICLE_CAP;
  private baseResolution = 1;

  constructor(canvas: HTMLCanvasElement, state: State, view: View) {
    this.state = state;
    this.view = view;
    this.canvas = canvas;
  }

  private canvas: HTMLCanvasElement;

  private get cam(): Camera {
    return this.state.camera;
  }

  async init(): Promise<void> {
    this.baseResolution = Math.min(window.devicePixelRatio || 1, 2);
    await this.app.init({
      canvas: this.canvas,
      preference: 'webgl',
      preferWebGLVersion: 2,
      antialias: true,
      powerPreference: 'high-performance',
      resolution: this.baseResolution,
      autoDensity: true,
      backgroundColor: CHROME.void,
      clearBeforeRender: true,
      resizeTo: window,
    });
    this.canvas.classList.add('board-canvas');

    this.bgGradient = new Sprite(backgroundTexture());
    this.bgVignette = new Sprite(vignetteTexture());
    this.bgVignette.alpha = 0.55;
    this.bgLattice = new TilingSprite({ texture: latticeTexture(32), width: 10, height: 10 });
    this.bgLattice.alpha = 0.35;
    this.bgLayer.addChild(this.bgGradient, this.bgLattice, this.bgVignette);

    this.gridLayer.addChild(this.gridMinor, this.gridMajor);

    this.worldLayer.addChild(
      this.wireCasing,
      this.wireLayer,
      this.nodeLayer,
      this.particleLayer,
      this.overlayLayer,
    );
    this.overlayLayer.addChild(
      this.overlayChrome,
      this.overlayWires,
      this.highlightChrome,
      this.highlightWires,
      this.overlayText,
    );

    this.app.stage.addChild(this.bgLayer, this.gridLayer, this.worldLayer);

    this.particleTextures = [glowTexture(8)];
    this.resize();
    setFontScale(this.cam.zoom * this.baseResolution);
  }

  get ticker(): Ticker {
    return this.app.ticker;
  }

  resize(): void {
    this.cancelFocus();
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.bgGradient.width = this.width;
    this.bgGradient.height = this.height;
    this.bgVignette.width = this.width;
    this.bgVignette.height = this.height;
    this.bgLattice.width = this.width;
    this.bgLattice.height = this.height;
    this.rebuildGrid();
  }

  screenToWorld(x: number, y: number): Point {
    const cam = this.cam;
    return {
      x: (x - this.width / 2) / cam.zoom + cam.x,
      y: (y - this.height / 2) / cam.zoom + cam.y,
    };
  }

  worldToScreen(x: number, y: number): Point {
    const cam = this.cam;
    return {
      x: (x - cam.x) * cam.zoom + this.width / 2,
      y: (y - cam.y) * cam.zoom + this.height / 2,
    };
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    this.cancelFocus();
    const before = this.screenToWorld(screenX, screenY);
    this.cam.zoom = Math.min(CONFIG.zoomMax, Math.max(CONFIG.zoomMin, this.cam.zoom * factor));
    const after = this.screenToWorld(screenX, screenY);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
  }

  private safeFrame(): { left: number; right: number; top: number; bottom: number } {
    const narrow = this.width <= 900;
    return {
      left: narrow ? 48 : 330,
      right: narrow ? 16 : this.view.selection ? 340 : 90,
      top: narrow ? 76 : 92,
      bottom: narrow ? 150 : 60,
    };
  }

  fit(nodes: MachineNode[] = this.state.nodes): void {
    this.cancelFocus();
    if (!nodes.length) return;
    const b = boundsOfNodes(nodes);
    const frame = this.safeFrame();
    const availW = Math.max(200, this.width - frame.left - frame.right);
    const availH = Math.max(240, this.height - frame.top - frame.bottom);
    const zoom = Math.min(
      FIT_MAX_ZOOM,
      Math.max(CONFIG.zoomMin, Math.min(availW / (b.right - b.left + 60), availH / (b.bottom - b.top + 60))),
    );
    this.cam.zoom = zoom;
    this.cam.x = (b.left + b.right) / 2 - (frame.left + availW / 2 - this.width / 2) / zoom;
    this.cam.y = (b.top + b.bottom) / 2 - (frame.top + availH / 2 - this.height / 2) / zoom;
  }

  focusNode(node: MachineNode): void {
    const frame = this.safeFrame();
    const availW = Math.max(1, this.width - frame.left - frame.right);
    const availH = Math.max(1, this.height - frame.top - frame.bottom);
    const cam = this.cam;
    const targetX = node.x - (frame.left + availW / 2 - this.width / 2);
    const targetY = node.y - (frame.top + availH / 2 - this.height / 2);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.focusTween = null;
      cam.x = targetX;
      cam.y = targetY;
      cam.zoom = 1;
      return;
    }
    this.focusTween = {
      startX: cam.x,
      startY: cam.y,
      startZoom: cam.zoom,
      targetX,
      targetY,
      targetZoom: 1,
      startedAt: performance.now(),
    };
  }

  cancelFocus(): void {
    this.focusTween = null;
  }

  private updateFocus(now: number): void {
    const tween = this.focusTween;
    if (!tween) return;
    const t = Math.min(1, Math.max(0, (now - tween.startedAt) / FOCUS_MS));
    const k = easeInOutCubic(t);
    const cam = this.cam;
    cam.x = tween.startX + (tween.targetX - tween.startX) * k;
    cam.y = tween.startY + (tween.targetY - tween.startY) * k;
    cam.zoom = tween.startZoom + (tween.targetZoom - tween.startZoom) * k;
    if (t >= 1) this.focusTween = null;
  }

  private rebuildGrid(): void {
    const zoom = this.cam.zoom;
    const minor = GRID.cell * zoom;
    const major = GRID.cell * 5 * zoom;

    const g = this.gridMinor;
    g.clear();
    const minorAlpha = Math.max(0, Math.min(1, (minor - 9) / 12)) * METRICS.gridAlpha;
    if (minorAlpha > 0.005) {
      const columns = Math.ceil(this.width / minor) + 2;
      const rows = Math.ceil(this.height / minor) + 2;
      for (let i = -1; i <= columns; i++) {
        g.moveTo(i * minor, -minor).lineTo(i * minor, this.height + minor);
      }
      for (let i = -1; i <= rows; i++) {
        g.moveTo(-minor, i * minor).lineTo(this.width + minor, i * minor);
      }
      g.stroke({ width: 1, color: 0x9d9172, alpha: minorAlpha });
    }

    const m = this.gridMajor;
    m.clear();
    if (major >= 14) {
      const columns = Math.ceil(this.width / major) + 2;
      const rows = Math.ceil(this.height / major) + 2;
      for (let i = -1; i <= columns; i++) {
        m.moveTo(i * major, -major).lineTo(i * major, this.height + major);
      }
      for (let i = -1; i <= rows; i++) {
        m.moveTo(-major, i * major).lineTo(this.width + major, i * major);
      }
      m.stroke({ width: 1, color: 0xc2b48d, alpha: METRICS.gridAlpha * 1.7 });
    }
  }

  private updateGridOffset(): void {
    const origin = this.worldToScreen(0, 0);
    const zoom = this.cam.zoom;
    const minor = GRID.cell * zoom;
    const major = GRID.cell * 5 * zoom;
    this.gridMinor.position.set(mod(origin.x, minor), mod(origin.y, minor));
    this.gridMajor.position.set(mod(origin.x, major), mod(origin.y, major));
    this.bgLattice.tilePosition.set(origin.x % 32, origin.y % 32);
  }

  private wireKey(): number {
    let hash = 2166136261;
    const mix = (value: number): void => {
      hash ^= Math.round(value * 16);
      hash = Math.imul(hash, 16777619);
    };
    for (const node of this.state.nodes) {
      mix(node.id);
      mix(node.x);
      mix(node.y);
      mix(node.level);
      mix(rotationOf(node));
    }
    for (const link of this.state.links) {
      mix(link.id);
      mix(link.from);
      mix(link.to);
      mix(link.tier);
      mix(link.anchors.length);
      for (const anchor of link.anchors) {
        mix(anchor.x);
        mix(anchor.y);
      }
      mix(link.side ? link.side.charCodeAt(0) : 0);
    }
    return hash;
  }

  private rebuildWires(): void {
    for (const g of this.wireGroups.values()) g.destroy();
    this.wireGroups.clear();
    this.paths.clear();
    this.wireCasing.clear();
    this.anchorList = [];

    const byId = new Map(this.state.nodes.map((node) => [node.id, node]));
    const byTier = new Map<number, Link[]>();
    for (const link of this.state.links) {
      const from = byId.get(link.from);
      const to = byId.get(link.to);
      if (!from || !to) continue;
      const path = linkPath(link, from, to);
      if (!path) continue;
      this.paths.set(link.id, path);
      link.anchors.forEach((anchor, index) => {
        this.anchorList.push({ linkId: link.id, index, x: anchor.x, y: anchor.y });
      });
      const list = byTier.get(link.tier);
      if (list) list.push(link);
      else byTier.set(link.tier, [link]);
    }

    for (const [, links] of byTier) {
      for (const link of links) {
        const path = this.paths.get(link.id);
        if (!path) continue;
        this.tracePath(this.wireCasing, path);
      }
    }
    this.wireCasing.stroke({
      width: METRICS.wireWidth + 2,
      color: 0x0b0a07,
      alpha: 0.6,
      cap: 'round',
      join: 'round',
    });

    for (const [tier, links] of byTier) {
      const g = new Graphics();
      const color = tierColor(tier);
      for (const link of links) {
        const path = this.paths.get(link.id);
        if (!path) continue;
        this.tracePath(g, path);
        g.stroke({ width: METRICS.wireWidth, color, alpha: 0.9, cap: 'round', join: 'round' });
      }
      this.wireGroups.set(tier, g);
      this.wireLayer.addChild(g);
    }
  }

  private tracePath(g: Graphics, path: WirePath): void {
    if (path.kind === 'curve' && path.curve) {
      const c = path.curve;
      g.moveTo(c.a.x, c.a.y);
      g.bezierCurveTo(c.b.x, c.b.y, c.c.x, c.c.y, c.d.x, c.d.y);
      return;
    }
    const points = path.points ?? [];
    if (points.length < 2) return;
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length - 1; i++) {
      const corner = points[i];
      const prev = points[i - 1];
      const next = points[i + 1];
      const inLength = Math.hypot(corner.x - prev.x, corner.y - prev.y);
      const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
      if (inLength < 0.001 || outLength < 0.001) continue;
      const radius = Math.min(14, inLength / 2, outLength / 2);
      g.arcTo(corner.x, corner.y, next.x, next.y, radius);
    }
    const last = points[points.length - 1];
    g.lineTo(last.x, last.y);
  }

  private makeNodeView(node: MachineNode): NodeView {
    const root = new Container();
    root.position.set(node.x, node.y);
    const frame = new Graphics();
    const glyph = new Sprite(glyphTexture(this.glyphShape(node)));
    glyph.anchor.set(0.5);
    const title = label('', { role: 'title' });
    const meta = label('', { role: 'meta' });
    const status = label('', { role: 'status' });
    const detail = label('', { role: 'meta' });
    const util = label('', { role: 'meta', anchorX: 1 });
    const level = label('', { role: 'meta', anchorX: 1 });
    const compact = label('', { role: 'compact', anchorX: 0.5, anchorY: 0.5 });
    const value = label('', { role: 'value', anchorX: 0.5, anchorY: 0.5 });
    const bar = new Sprite(Texture.WHITE);
    bar.anchor.set(0, 0.5);
    const dot = new Sprite(Texture.WHITE);
    dot.anchor.set(0.5);

    root.addChild(frame, bar, dot, glyph, title, meta, status, detail, util, level, compact, value);

    const view: NodeView = {
      root,
      frame,
      glyph,
      title,
      meta,
      status,
      detail,
      util,
      level,
      compact,
      value,
      bar,
      dot,
      tier: node.kind === 'processor' ? node.tier : 0,
      rot: rotationOf(node),
      kind: node.kind,
      lastStatus: '',
      lastUtil: -1,
      lastDetail: '',
      lastLevel: -1,
      lod: this.lodLevel(),
    };
    this.paintNode(view, node);
    return view;
  }

  private glyphShape(node: MachineNode): string {
    if (node.kind === 'extractor') return 'square';
    const shapes = ['diamond', 'circle', 'hex', 'triangle', 'ring', 'bars', 'cross'];
    const tier = node.kind === 'processor' ? node.tier : 0;
    return shapes[tier % shapes.length];
  }

  private localBounds(node: MachineNode): Bounds {
    const size = nodeSize(node);
    return {
      left: -size.w / 2,
      right: size.w / 2,
      top: -size.h / 2,
      bottom: size.h / 2,
      w: size.w,
      h: size.h,
    };
  }

  private lodLevel(): number {
    const zoom = this.cam.zoom;
    return zoom < 0.68 ? 0 : zoom < 0.98 ? 1 : 2;
  }

  private paintNode(view: NodeView, node: MachineNode): void {
    const b = this.localBounds(node);
    const tier = view.tier;
    const g = view.frame;
    g.clear();

    if (node.kind === 'vault') {
      this.paintVault(view, node);
      return;
    }

    const compact = view.lod === 0;
    const plateAccent = tierDim(tier);

    // Cream legend plates on the dark floor: offset shadow, paper face, tier band, bevel.
    g.roundRect(b.left + 3, b.top + 3, b.w, b.h, METRICS.cardRadius).fill({
      color: 0x000000,
      alpha: 0.32,
    });
    g.roundRect(b.left, b.top, b.w, b.h, METRICS.cardRadius).fill({
      color: CHROME.paper,
      alpha: 1,
    });
    g.rect(b.left + 1.4, b.top + 1.4, b.w - 2.8, 5).fill({ color: tierColor(tier), alpha: 1 });
    g.rect(b.left + 1.4, b.top + 1.4, b.w - 2.8, 1).fill({ color: 0x211f17, alpha: 0.45 });
    g.rect(b.left + 1.4, b.top + 6.4, b.w - 2.8, 1).fill({ color: 0x211f17, alpha: 0.35 });
    g.rect(b.left + 1, b.bottom - 6, b.w - 2, 1).fill({ color: 0xffffff, alpha: 0.26 });
    g.roundRect(b.left + 0.6, b.top + 0.6, b.w - 1.2, b.h - 1.2, METRICS.cardRadius).stroke({
      width: 1.2,
      color: 0x1b1912,
      alpha: 0.92,
    });
    g.rect(b.left + 12, b.bottom - 13, b.w - 24, 5).fill({
      color: 0x211f17,
      alpha: 0.16,
    });
    this.paintPorts(g, node);

    view.glyph.texture = glyphTexture(this.glyphShape(node));
    view.glyph.tint = plateAccent;
    view.glyph.position.set(b.left + 17, b.top + 18);
    view.glyph.width = 18;
    view.glyph.height = 18;

    fitLabel(view.title, this.tierName(node), b.w - 74);
    view.title.tint = CHROME.paperInk;
    view.title.position.set(b.left + 34, b.top + 8);

    view.meta.text = node.kind === 'extractor' ? 'EXTRACTOR' : `PROCESSOR · ${this.tierTag(node)}`;
    view.meta.tint = CHROME.paperDim;
    view.meta.position.set(b.left + 34, b.top + 27);

    view.compact.text = node.kind === 'extractor' ? 'RAW DATA' : this.tierName(node).toUpperCase();
    fitLabel(view.compact, view.compact.text, b.w - 32);
    view.compact.tint = plateAccent;
    view.compact.position.set(0, 0);

    view.status.position.set(b.left + 24, b.top + 46);
    view.detail.position.set(b.left + 12, b.top + 65);
    view.util.position.set(b.right - 12, b.top + 45);
    view.level.text = `L${node.level}`;
    view.level.tint = plateAccent;
    view.level.position.set(b.right - 12, b.top + 9);

    view.title.visible = !compact;
    view.meta.visible = !compact;
    view.status.visible = !compact;
    view.detail.visible = view.lod === 2;
    view.util.visible = !compact;
    view.level.visible = !compact;
    view.glyph.visible = !compact;
    view.compact.visible = compact;
    view.bar.visible = !compact;
    view.dot.visible = true;
    view.value.visible = false;
  }

  private tierName(node: MachineNode): string {
    const tier = node.kind === 'processor' ? node.tier : 0;
    return dataInfo(tier).name;
  }

  private tierTag(node: MachineNode): string {
    const tier = node.kind === 'processor' ? node.tier : 0;
    return tierLabel(tier);
  }

  private paintPorts(g: Graphics, node: MachineNode): void {
    const inputs = inputPorts(node);
    const out = outputPort(node);
    for (const port of inputs) {
      const color = port.universal ? CHROME.paperDim : tierDim(port.tier ?? 0);
      g.rect(port.dx - 3.5, port.dy - 3.5, 7, 7).stroke({ width: 1.4, color, alpha: 0.9 });
    }
    if (out) {
      g.rect(out.dx - 3.5, out.dy - 3.5, 7, 7).fill({
        color: tierDim(out.tier ?? 0),
        alpha: 1,
      });
      g.rect(out.dx - 3.5, out.dy - 3.5, 7, 7).stroke({
        width: 1,
        color: 0xffffff,
        alpha: 0.35,
      });
    }
  }

  private paintVault(view: NodeView, node: MachineNode): void {
    const b = this.localBounds(node);
    const cx = 0;
    const cy = 0;
    const g = view.frame;
    g.roundRect(b.left + 3, b.top + 3, b.w, b.h, METRICS.cardRadius).fill({
      color: 0x000000,
      alpha: 0.32,
    });
    g.roundRect(b.left, b.top, b.w, b.h, METRICS.cardRadius).fill({
      color: CHROME.paper,
      alpha: 1,
    });
    g.rect(b.left + 1.4, b.top + 1.4, b.w - 2.8, 4).fill({
      color: CHROME.accent,
      alpha: 0.95,
    });
    g.rect(b.left + 1.4, b.top + 5.4, b.w - 2.8, 1).fill({ color: 0x211f17, alpha: 0.18 });
    g.roundRect(b.left + 0.6, b.top + 0.6, b.w - 1.2, b.h - 1.2, METRICS.cardRadius).stroke({
      width: 1.2,
      color: 0x1b1912,
      alpha: 0.92,
    });
    g.circle(cx, cy, 52).stroke({ width: 1, color: 0x211f17, alpha: 0.22 });
    g.circle(cx, cy, 38).stroke({ width: 1, color: 0x211f17, alpha: 0.16 });
    for (let i = 0; i < 24; i++) {
      const angle = (Math.PI * 2 * i) / 24;
      const inner = i % 6 === 0 ? 58 : 62;
      g.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
        .lineTo(cx + Math.cos(angle) * 66, cy + Math.sin(angle) * 66)
        .stroke({ width: 1, color: 0x211f17, alpha: i % 6 === 0 ? 0.28 : 0.14 });
    }
    g.moveTo(b.left + 18, b.top + 34)
      .lineTo(b.right - 18, b.top + 34)
      .stroke({ width: 1, color: 0x211f17, alpha: 0.2 });
    this.paintPorts(g, node);

    view.title.text = 'VAULT';
    view.title.tint = CHROME.paperDim;
    view.title.position.set(cx, view.lod === 0 ? b.top + 8 : b.top + 14);
    view.title.anchor.set(0.5, 0);
    view.title.visible = true;

    view.value.tint = CHROME.paperInk;
    view.value.position.set(cx, cy - 2);
    view.value.visible = true;

    view.status.text = 'units held';
    view.status.tint = CHROME.paperDim;
    view.status.position.set(cx, cy + 22);
    view.status.anchor.set(0.5, 0);
    view.status.visible = view.lod !== 0;

    view.meta.text = '';
    view.util.text = '';
    view.compact.text = '';
    view.detail.text = '';
    view.meta.visible = false;
    view.detail.visible = false;
    view.util.visible = false;
    view.level.visible = false;
    view.glyph.visible = false;
    view.compact.visible = false;
    view.bar.visible = false;
    view.dot.visible = false;
  }

  private syncNodes(): void {
    const zoom = this.cam.zoom;
    const cam = this.cam;
    const halfW = this.width / 2 / zoom + 260;
    const halfH = this.height / 2 / zoom + 260;
    const seen = new Set<number>();

    for (const node of this.state.nodes) {
      if (Math.abs(node.x - cam.x) > halfW || Math.abs(node.y - cam.y) > halfH) continue;
      seen.add(node.id);
      let view = this.views.get(node.id);
      if (!view) {
        view = this.makeNodeView(node);
        this.views.set(node.id, view);
        this.nodeLayer.addChild(view.root);
      }
      view.root.visible = true;
      view.root.position.set(node.x, node.y);
      const tier = node.kind === 'processor' ? node.tier : 0;
      const rot = rotationOf(node);
      if (view.tier !== tier || view.kind !== node.kind || view.rot !== rot) {
        view.tier = tier;
        view.kind = node.kind;
        view.rot = rot;
        view.lastStatus = '';
        view.lastDetail = '';
        view.lastLevel = -1;
        this.paintNode(view, node);
      }
      const lod = this.lodLevel();
      if (lod !== view.lod) {
        view.lod = lod;
        this.paintNode(view, node);
      }
      this.updateNodeDynamic(view, node);
    }

    const alive = new Set<number>();
    for (const node of this.state.nodes) alive.add(node.id);
    for (const [id, view] of this.views) {
      if (alive.has(id)) continue;
      view.root.destroy({ children: true });
      this.views.delete(id);
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      view.root.visible = false;
    }
  }

  private updateNodeDynamic(view: NodeView, node: MachineNode): void {
    const b = this.localBounds(node);
    if (node.kind === 'vault') {
      const total = Object.values(this.state.bank).reduce((sum, amount) => sum + (amount || 0), 0);
      const text = fmt(total);
      if (text !== view.lastDetail) {
        view.lastDetail = text;
        view.value.text = text;
      }
      return;
    }
    const status = nodeStatus(this.state, node);
    if (status !== view.lastStatus) {
      view.lastStatus = status;
      view.status.text = status.charAt(0).toUpperCase() + status.slice(1);
      view.status.tint = STATUS_COLOR[status] ?? CHROME.inkFaint;
      view.dot.tint = STATUS_COLOR[status] ?? CHROME.inkFaint;
    }
    view.dot.position.set(b.left + 15, view.lod === 0 ? b.top + 15 : b.top + 53);
    const dotSize = view.lod === 0 ? 7 : 5;
    view.dot.width = dotSize;
    view.dot.height = dotSize;

    const util = Math.max(0, Math.min(1, node._util ?? 0));
    const percent = Math.round(util * 100);
    if (percent !== view.lastUtil) {
      view.lastUtil = percent;
      view.util.text = `${percent}%`;
      view.util.tint = CHROME.paperDim;
      const cap = this.bufferCapFor(node);
      const ratio = Math.max(0, Math.min(1, (node.out?.amount ?? 0) / (cap || 1)));
      const barLeft = b.left + 12;
      const barTop = b.bottom - 12;
      const barW = b.w - 24;
      view.bar.position.set(barLeft, barTop + 1.5);
      view.bar.height = 3;
      view.bar.width = Math.max(0, barW * ratio);
      view.bar.tint = tierColor(view.tier);
      view.bar.alpha = ratio > 0.002 ? 0.95 : 0;
    }

    const detail = this.detailText(node);
    if (detail !== view.lastDetail) {
      view.lastDetail = detail;
      view.detail.text = detail;
      view.detail.tint = CHROME.paperDim;
    }

    if (node.level !== view.lastLevel) {
      view.lastLevel = node.level;
      view.level.text = `L${node.level}`;
    }
  }

  private bufferCapFor(node: MachineNode): number {
    return bufferCap(this.state, node);
  }

  private detailText(node: MachineNode): string {
    if (node.kind === 'extractor') {
      return `${(node._flowOut ?? 0).toFixed(1)}/s`;
    }
    if (node.kind !== 'processor') return '';
    const recipe = recipeFor(node.tier);
    if (!recipe) return '';
    const inputs = recipe.inputs.map((input) => `${input.amount}×${tierLabel(input.tier)}`).join(' + ');
    return `${inputs} → 1×${tierLabel(recipe.output.tier)}`;
  }

  private updateParticles(): void {
    const clock = performance.now();
    let used = 0;
    for (const link of this.state.links) {
      if (used >= this.particleCap) break;
      const flow = link._flow ?? 0;
      if (flow <= 0.002) continue;
      const path = this.paths.get(link.id);
      if (!path) continue;
      const count = flow > 8 ? 4 : flow > 1 ? 3 : flow > 0.08 ? 2 : 1;
      const color = tierBright(link.tier);
      const speed = 0.12 + Math.min(0.4, Math.log10(1 + flow * 9) * 0.12);
      for (let i = 0; i < count; i++) {
        if (used >= this.particleCap) break;
        const sprite = this.particle(used);
        const phase = ((clock / 1000) * speed + i / count + link.id * 0.137) % 1;
        const point = path.at(phase);
        sprite.position.set(point.x, point.y);
        sprite.tint = color;
        sprite.alpha = 0.85;
        sprite.visible = true;
        used += 1;
      }
    }
    for (let i = used; i < this.particlePool.length; i++) {
      this.particlePool[i].visible = false;
    }
  }

  private particle(index: number): Sprite {
    let sprite = this.particlePool[index];
    if (!sprite) {
      sprite = new Sprite(this.particleTextures[index % this.particleTextures.length]);
      sprite.anchor.set(0.5);
      sprite.width = 6;
      sprite.height = 6;
      sprite.visible = false;
      this.particlePool[index] = sprite;
      this.particleLayer.addChild(sprite);
    }
    return sprite;
  }

  private ghostKey(): string {
    const ghost = this.view.ghost;
    if (!ghost) return '';
    const rot = this.view.pendingBuild?.rot ?? 0;
    return `${ghost.kind}:${ghost.tier ?? ''}:${rot}:${ghost.x}:${ghost.y}:${ghost.valid ? 1 : 0}`;
  }

  private hoverKey(): string {
    const hover = this.view.hoverPort;
    if (!hover) return '';
    return `${hover.nodeId}:${hover.dir}:${hover.index}`;
  }

  private drawOverlays(): void {
    const activeDraft = this.view.linkDraft;
    const selection = this.view.selection;
    const selectionKey =
      selection?.kind === 'anchor'
        ? `anchor:${selection.linkId}:${selection.index}`
        : selection
          ? `${selection.kind}:${selection.id}`
          : '';
    const key = activeDraft
      ? `d:${activeDraft.fromId}:${activeDraft.points.length}:${activeDraft.targetId ?? ''}:${activeDraft.targetFace ?? ''}:${activeDraft.targetTier ?? ''}:${activeDraft.targetPos?.x ?? ''}:${activeDraft.targetPos?.y ?? ''}:${activeDraft.x}:${activeDraft.y}:${this.wireSignature}`
      : `s:${selectionKey}:${this.ghostKey()}:${this.hoverKey()}:${this.wireSignature}`;
    if (key === this.overlaySignature) return;
    this.overlaySignature = key;

    const g = this.overlayChrome;
    const w = this.overlayWires;
    g.clear();
    w.clear();

    if (selection?.kind === 'node') {
      const node = this.state.nodes.find((n) => n.id === selection.id);
      if (node) {
        const b = nodeBounds(node);
        const pad = 6;
        const len = 12;
        const left = b.left - pad;
        const right = b.right + pad;
        const top = b.top - pad;
        const bottom = b.bottom + pad;
        const color =
          node.kind === 'vault' ? CHROME.ink : tierColor(node.kind === 'processor' ? node.tier : 0);
        g.moveTo(left, top + len)
          .lineTo(left, top)
          .lineTo(left + len, top);
        g.moveTo(right - len, top)
          .lineTo(right, top)
          .lineTo(right, top + len);
        g.moveTo(right, bottom - len)
          .lineTo(right, bottom)
          .lineTo(right - len, bottom);
        g.moveTo(left + len, bottom)
          .lineTo(left, bottom)
          .lineTo(left, bottom - len);
        g.stroke({ width: 1.4, color, alpha: 0.95 });
      }
    }

    if (selection?.kind === 'link') {
      const link = this.state.links.find((l) => l.id === selection.id);
      const path = link ? this.paths.get(link.id) : null;
      if (path) {
        this.tracePath(w, path);
        w.stroke({
          width: METRICS.wireWidthBusy,
          color: CHROME.ink,
          alpha: 0.85,
          cap: 'round',
          join: 'round',
        });
      }
    }

    if (selection?.kind === 'anchor') {
      const link = this.state.links.find((l) => l.id === selection.linkId);
      const anchor = link?.anchors[selection.index];
      if (anchor) {
        g.rect(anchor.x - 4, anchor.y - 4, 8, 8).fill({ color: CHROME.ink, alpha: 0.95 });
      }
    }

    const hover = this.view.hoverPort;
    if (hover) {
      const node = this.state.nodes.find((candidate) => candidate.id === hover.nodeId);
      const port =
        node && hover.dir === 'out' ? outputPort(node) : node ? inputPorts(node)[hover.index] : null;
      if (node && port) {
        const at = portWorldPos(node, port);
        g.rect(at.x - 6.5, at.y - 6.5, 13, 13).stroke({
          width: 1.6,
          color: CHROME.ink,
          alpha: 0.95,
        });
      }
    }

    for (const link of this.state.links) {
      const anchors = link.anchors ?? [];
      for (const anchor of anchors) {
        g.rect(anchor.x - 2.5, anchor.y - 2.5, 5, 5).fill({
          color: tierBright(link.tier),
          alpha: 0.9,
        });
      }
    }

    const ghost = this.view.ghost;
    if (ghost) {
      const size = ghost.kind === 'vault' ? { w: 192, h: 192 } : { w: 192, h: 96 };
      const color = ghost.valid ? tierBright(ghost.tier ?? 0) : CHROME.bad;
      g.rect(ghost.x - size.w / 2, ghost.y - size.h / 2, size.w, size.h).stroke({
        width: 1.4,
        color,
        alpha: 0.85,
      });
      const markerAlpha = ghost.valid ? 0.95 : 0.5;
      if (ghost.kind === 'extractor' || ghost.kind === 'processor') {
        const rot = this.view.pendingBuild?.rot ?? 0;
        const preview =
          ghost.kind === 'extractor'
            ? makeExtractor(0, ghost.x, ghost.y, rot)
            : makeProcessor(0, ghost.tier ?? 1, ghost.x, ghost.y, rot);
        const inputs = inputPorts(preview);
        for (const port of inputs) {
          const at = portWorldPos(preview, port);
          g.rect(at.x - 4.5, at.y - 4.5, 9, 9).stroke({
            width: 1.4,
            color: tierBright(port.tier ?? 0),
            alpha: markerAlpha,
          });
        }
        const out = outputPort(preview);
        if (out) {
          const at = portWorldPos(preview, out);
          g.rect(at.x - 4.5, at.y - 4.5, 9, 9).fill({
            color: tierBright(out.tier ?? 0),
            alpha: markerAlpha,
          });
          const from = { x: ghost.x, y: ghost.y };
          if (inputs.length) {
            const first = portWorldPos(preview, inputs[0]);
            const last = portWorldPos(preview, inputs[inputs.length - 1]);
            from.x = (first.x + last.x) / 2;
            from.y = (first.y + last.y) / 2;
          }
          const midX = (from.x + at.x) / 2;
          const midY = (from.y + at.y) / 2;
          const length = Math.hypot(at.x - from.x, at.y - from.y) || 1;
          const ux = (at.x - from.x) / length;
          const uy = (at.y - from.y) / length;
          const tail = 4;
          const wing = 3.5;
          g.moveTo(midX - ux * tail - uy * wing, midY - uy * tail + ux * wing)
            .lineTo(midX + ux * tail, midY + uy * tail)
            .lineTo(midX - ux * tail + uy * wing, midY - uy * tail - ux * wing)
            .stroke({ width: 1.2, color: tierBright(out.tier ?? 0), alpha: ghost.valid ? 0.5 : 0.3 });
        }
      }
    }

    const wireDraft = this.view.linkDraft;
    if (wireDraft) {
      const from = this.state.nodes.find((n) => n.id === wireDraft.fromId);
      if (from) {
        const path = draftPath(wireDraft, from);
        if (path) {
          this.tracePath(w, path);
          w.stroke({
            width: METRICS.wireWidthBusy,
            color: tierBright(wireDraft.tier),
            alpha: 0.95,
            cap: 'round',
            join: 'round',
          });
        }
        for (const point of wireDraft.points) {
          g.rect(point.x - 3, point.y - 3, 6, 6).fill({
            color: tierBright(wireDraft.tier),
            alpha: 0.95,
          });
        }
        const end = wireDraft.targetPos ?? { x: wireDraft.x, y: wireDraft.y };
        if (!wireDraft.targetPos) {
          const size = 5.5;
          g.moveTo(end.x - 13, end.y).lineTo(end.x - size, end.y);
          g.moveTo(end.x + size, end.y).lineTo(end.x + 13, end.y);
          g.moveTo(end.x, end.y - 13).lineTo(end.x, end.y - size);
          g.moveTo(end.x, end.y + size).lineTo(end.x, end.y + 13);
          g.stroke({ width: 1.1, color: tierBright(wireDraft.tier), alpha: 0.8 });
          g.rect(end.x - size, end.y - size, size * 2, size * 2).stroke({
            width: 1.1,
            color: tierBright(wireDraft.tier),
            alpha: 0.8,
          });
        }
      }
    }
  }

  private syncHighlightSelection(): boolean {
    const selection = this.view.selection;
    const key = selection?.kind === 'node' ? `${selection.id}:${this.wireSignature}` : '';
    this.highlightChanged = key !== this.highlightKey;
    if (!this.highlightChanged) return key !== '';
    this.highlightKey = key;
    this.highlightLinks = [];
    this.highlightNodes = [];
    if (selection?.kind !== 'node') return false;
    const node = this.state.nodes.find((candidate) => candidate.id === selection.id);
    if (!node) return false;
    const neighbors = new Map<number, { node: MachineNode; color: number }>();
    for (const link of this.state.links) {
      if (link.from !== node.id && link.to !== node.id) continue;
      this.highlightLinks.push(link);
      const otherId = link.from === node.id ? link.to : link.from;
      if (neighbors.has(otherId)) continue;
      const other = this.state.nodes.find((candidate) => candidate.id === otherId);
      if (other) neighbors.set(other.id, { node: other, color: tierBright(link.tier) });
    }
    this.highlightNodes = [...neighbors.values()];
    return true;
  }

  private paintHighlightChrome(): void {
    const g = this.highlightChrome;
    g.clear();
    for (const entry of this.highlightNodes) {
      const b = nodeBounds(entry.node);
      g.roundRect(b.left - 10, b.top - 10, b.w + 20, b.h + 20, METRICS.cardRadius + 6).stroke({
        width: 6,
        color: entry.color,
        alpha: 0.2,
      });
      g.roundRect(b.left - 4, b.top - 4, b.w + 8, b.h + 8, METRICS.cardRadius + 1).stroke({
        width: 2.2,
        color: entry.color,
        alpha: 0.95,
      });
      g.roundRect(b.left, b.top, b.w, b.h, METRICS.cardRadius).fill({
        color: entry.color,
        alpha: 0.055,
      });
      const corner = 13;
      const m = 7;
      g.moveTo(b.left - m, b.top - m + corner)
        .lineTo(b.left - m, b.top - m)
        .lineTo(b.left - m + corner, b.top - m)
        .stroke({ width: 2.4, color: entry.color, alpha: 0.95, cap: 'round', join: 'round' });
      g.moveTo(b.right + m - corner, b.top - m)
        .lineTo(b.right + m, b.top - m)
        .lineTo(b.right + m, b.top - m + corner)
        .stroke({ width: 2.4, color: entry.color, alpha: 0.95, cap: 'round', join: 'round' });
      g.moveTo(b.right + m, b.bottom + m - corner)
        .lineTo(b.right + m, b.bottom + m)
        .lineTo(b.right + m - corner, b.bottom + m)
        .stroke({ width: 2.4, color: entry.color, alpha: 0.95, cap: 'round', join: 'round' });
      g.moveTo(b.left - m + corner, b.bottom + m)
        .lineTo(b.left - m, b.bottom + m)
        .lineTo(b.left - m, b.bottom + m - corner)
        .stroke({ width: 2.4, color: entry.color, alpha: 0.95, cap: 'round', join: 'round' });
    }
    for (const link of this.highlightLinks) {
      const path = this.paths.get(link.id);
      if (!path) continue;
      this.tracePath(g, path);
      g.stroke({
        width: METRICS.wireWidth + 3,
        color: tierBright(link.tier),
        alpha: 0.3,
        cap: 'round',
        join: 'round',
      });
    }
  }

  private drawHighlights(now: number): void {
    const active = this.syncHighlightSelection();
    if (!active) {
      if (this.highlightDrawn) {
        this.highlightChrome.clear();
        this.highlightWires.clear();
        this.highlightDrawn = false;
      }
      return;
    }
    if (!this.highlightDrawn) {
      this.highlightChrome.clear();
      this.highlightWires.clear();
      this.highlightDrawn = true;
    }
    if (this.highlightChanged) this.paintHighlightChrome();

    const wave = 0.5 + 0.5 * Math.sin(now * 0.006);
    this.highlightChrome.alpha = 0.55 + wave * 0.45;
    const w = this.highlightWires;
    w.clear();
    for (const link of this.highlightLinks) {
      const path = this.paths.get(link.id);
      if (!path) continue;
      const color = tierBright(link.tier);
      for (let i = 0; i < 3; i++) {
        const t = (now / 1300 + i / 3 + link.id * 0.071) % 1;
        const point = path.at(t);
        const fade = Math.sin(Math.PI * t);
        if (fade <= 0.02) continue;
        if (t > 0.04) {
          const tail = path.at(t - 0.035);
          w.moveTo(tail.x, tail.y)
            .lineTo(point.x, point.y)
            .stroke({ width: 3.4, color: CHROME.ink, alpha: 0.5 * fade, cap: 'round' });
        }
        w.circle(point.x, point.y, 8).fill({ color, alpha: 0.2 * fade });
        w.circle(point.x, point.y, 3).fill({ color: CHROME.ink, alpha: 0.95 * fade });
      }
    }
  }

  sync(): void {
    const wireKey = this.wireKey();
    if (wireKey !== this.wireSignature) {
      this.wireSignature = wireKey;
      this.rebuildWires();
    }
    this.syncNodes();
    this.drawOverlays();
  }

  render(now: number): void {
    this.governQuality(now);
    this.updateFocus(now);
    if (Math.abs(this.cam.zoom - this.lastZoom) > 0.0005) {
      this.lastZoom = this.cam.zoom;
      this.rebuildGrid();
      setFontScale(this.cam.zoom * this.baseResolution);
    }
    const cam = this.cam;
    this.worldLayer.scale.set(cam.zoom);
    this.worldLayer.position.set(this.width / 2 - cam.x * cam.zoom, this.height / 2 - cam.y * cam.zoom);
    this.updateGridOffset();
    this.updateParticles();
    this.drawOverlays();
    this.drawHighlights(now);
  }

  private governQuality(now: number): void {
    if (this.lastFrame > 0) {
      this.frameTimes.push(now - this.lastFrame);
      if (this.frameTimes.length > 90) this.frameTimes.shift();
    }
    this.lastFrame = now;
    if (this.frameTimes.length < 90) return;
    let total = 0;
    let fastest = Infinity;
    for (const time of this.frameTimes) {
      total += time;
      if (time < fastest) fastest = time;
    }
    const average = total / this.frameTimes.length;
    const floor = Math.max(6, fastest);
    if (average > floor * 1.6 && this.quality > 0.6) {
      this.setQuality(this.quality === 1 ? 0.75 : 0.6);
    } else if (average < floor * 1.2 && this.quality < 1) {
      this.setQuality(this.quality === 0.6 ? 0.75 : 1);
    }
  }

  private setQuality(quality: number): void {
    this.quality = quality;
    this.particleCap = Math.round(PARTICLE_CAP * Math.max(0.35, quality));
    this.frameTimes.length = 0;
  }

  pathFor(linkId: number): WirePath | null {
    return this.paths.get(linkId) ?? null;
  }

  anchorHit(wx: number, wy: number, threshold: number) {
    let best: { linkId: number; index: number; distance: number } | null = null;
    for (const anchor of this.anchorList) {
      const distance = Math.hypot(anchor.x - wx, anchor.y - wy);
      if (distance <= threshold && (!best || distance < best.distance)) {
        best = { linkId: anchor.linkId, index: anchor.index, distance };
      }
    }
    if (!best) return null;
    return {
      link: this.state.links.find((candidate) => candidate.id === best.linkId) ?? null,
      index: best.index,
    };
  }

  setState(state: State): void {
    this.state = state;
    this.wireSignature = 0;
  }
}
