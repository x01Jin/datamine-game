import { Application, Container, Graphics, Sprite, TilingSprite, Texture, type Ticker } from 'pixi.js';
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
  type WirePath,
} from '../layout/geometry.ts';
import { nodeStatus } from '../game/sim.ts';
import { CONFIG, bufferCap, dataInfo, fmt, recipeFor, tierLabel } from '../game/gamedata.ts';
import { CHROME, METRICS, STATUS_COLOR, tierBright, tierColor, tierDim } from './theme.ts';
import { MONO, MONO_LG, MONO_SM, label } from './labels.ts';
import { backgroundTexture, glowTexture, glyphTexture, latticeTexture, vignetteTexture } from './textures.ts';

interface NodeView {
  root: Container;
  frame: Graphics;
  glyph: Sprite;
  title: ReturnType<typeof label>;
  sub: ReturnType<typeof label>;
  status: ReturnType<typeof label>;
  detail: ReturnType<typeof label>;
  util: ReturnType<typeof label>;
  compact: ReturnType<typeof label>;
  value: ReturnType<typeof label>;
  bar: Sprite;
  dot: Sprite;
  tier: number;
  kind: MachineNode['kind'];
  lastStatus: string;
  lastUtil: number;
  lastDetail: string;
  lastLevel: number;
  compactMode: boolean;
}

const PARTICLE_CAP = 420;
const FIT_MAX_ZOOM = 1.25;

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
  private gridGraphics = new Graphics();
  private wireGroups = new Map<number, Graphics>();
  private wireCasing = new Graphics();
  private overlayWires = new Graphics();
  private overlayChrome = new Graphics();
  private overlayText = new Container();
  private particlePool: Sprite[] = [];
  private particleTextures: Texture[] = [];

  private views = new Map<number, NodeView>();
  private paths = new Map<number, WirePath>();
  private anchorList: { linkId: number; index: number; x: number; y: number }[] = [];
  private wireSignature = 0;
  private overlaySignature = '';
  private lastZoom = 0;
  private lastGridX = Number.NaN;
  private lastGridY = Number.NaN;
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
    this.baseResolution = Math.min(window.devicePixelRatio || 1, 1.5);
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
    this.bgLattice = new TilingSprite({ texture: latticeTexture(32), width: 10, height: 10 });
    this.bgLayer.addChild(this.bgGradient, this.bgLattice, this.bgVignette);

    this.gridLayer.addChild(this.gridGraphics);

    this.worldLayer.addChild(
      this.wireCasing,
      this.wireLayer,
      this.nodeLayer,
      this.particleLayer,
      this.overlayLayer,
    );
    this.overlayLayer.addChild(this.overlayChrome, this.overlayWires, this.overlayText);

    this.app.stage.addChild(this.bgLayer, this.gridLayer, this.worldLayer);

    this.particleTextures = [glowTexture(24), glowTexture(16)];
    this.resize();
  }

  get ticker(): Ticker {
    return this.app.ticker;
  }

  resize(): void {
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
    const before = this.screenToWorld(screenX, screenY);
    this.cam.zoom = Math.min(CONFIG.zoomMax, Math.max(CONFIG.zoomMin, this.cam.zoom * factor));
    const after = this.screenToWorld(screenX, screenY);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
  }

  fit(nodes: MachineNode[] = this.state.nodes): void {
    if (!nodes.length) return;
    const b = boundsOfNodes(nodes);
    const narrow = this.width <= 900;
    const left = narrow ? 16 : 330;
    const right = narrow ? 16 : this.view.selection ? 340 : 90;
    const top = narrow ? 76 : 92;
    const bottom = narrow ? 150 : 60;
    const availW = Math.max(200, this.width - left - right);
    const availH = Math.max(240, this.height - top - bottom);
    const zoom = Math.min(
      FIT_MAX_ZOOM,
      Math.max(CONFIG.zoomMin, Math.min(availW / (b.right - b.left + 60), availH / (b.bottom - b.top + 60))),
    );
    this.cam.zoom = zoom;
    this.cam.x = (b.left + b.right) / 2 - (left + availW / 2 - this.width / 2) / zoom;
    this.cam.y = (b.top + b.bottom) / 2 - (top + availH / 2 - this.height / 2) / zoom;
  }

  private rebuildGrid(): void {
    const zoom = this.cam.zoom;
    const g = this.gridGraphics;
    g.clear();

    const minor = GRID.cell * zoom;
    const minorAlpha = Math.max(0, Math.min(1, (minor - 9) / 12)) * METRICS.gridAlpha;
    if (minorAlpha > 0.005) {
      const origin = this.worldToScreen(0, 0);
      const ox = (((origin.x % minor) + minor) % minor) - minor;
      const oy = (((origin.y % minor) + minor) % minor) - minor;
      for (let x = ox; x <= this.width; x += minor) {
        g.moveTo(x, 0).lineTo(x, this.height);
      }
      for (let y = oy; y <= this.height; y += minor) {
        g.moveTo(0, y).lineTo(this.width, y);
      }
      g.stroke({ width: 1, color: 0x6f8ea6, alpha: minorAlpha });
    }

    const major = GRID.cell * 5 * zoom;
    if (major >= 14) {
      const origin = this.worldToScreen(0, 0);
      const ox = (((origin.x % major) + major) % major) - major;
      const oy = (((origin.y % major) + major) % major) - major;
      for (let x = ox; x <= this.width; x += major) {
        g.moveTo(x, 0).lineTo(x, this.height);
      }
      for (let y = oy; y <= this.height; y += major) {
        g.moveTo(0, y).lineTo(this.width, y);
      }
      g.stroke({ width: 1, color: 0x8fb0c8, alpha: METRICS.gridAlpha * 1.6 });
    }
  }

  private updateGridOffset(): void {
    const origin = this.worldToScreen(0, 0);
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
    }
    for (const link of this.state.links) {
      mix(link.id);
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
      width: METRICS.wireWidth + 2.4,
      color: 0x04060a,
      alpha: 0.9,
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
        g.stroke({ width: METRICS.wireWidth, color, alpha: 0.75, cap: 'round', join: 'round' });
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
    const title = label('', { font: MONO, size: 11 });
    const sub = label('', { font: MONO_SM, size: 9 });
    const status = label('', { font: MONO_SM, size: 9 });
    const detail = label('', { font: MONO_SM, size: 9 });
    const util = label('', { font: MONO_SM, size: 9, anchorX: 1 });
    const compact = label('', { font: MONO_LG, size: 13, anchorX: 0.5 });
    const value = label('', { font: MONO_LG, size: 22, anchorX: 0.5, anchorY: 0.5 });
    const bar = new Sprite(Texture.WHITE);
    bar.anchor.set(0, 0.5);
    const dot = new Sprite(this.particleTextures[1] ?? glowTexture(16));
    dot.anchor.set(0.5);

    root.addChild(frame, bar, dot, glyph, title, sub, status, detail, util, compact, value);

    const view: NodeView = {
      root,
      frame,
      glyph,
      title,
      sub,
      status,
      detail,
      util,
      compact,
      value,
      bar,
      dot,
      tier: node.kind === 'processor' ? node.tier : 0,
      kind: node.kind,
      lastStatus: '',
      lastUtil: -1,
      lastDetail: '',
      lastLevel: -1,
      compactMode: false,
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

  private paintNode(view: NodeView, node: MachineNode): void {
    const b = this.localBounds(node);
    const tier = view.tier;
    const accent = node.kind === 'vault' ? CHROME.ink : tierColor(tier);
    const g = view.frame;
    g.clear();

    if (node.kind === 'vault') {
      this.paintVault(view, node);
      return;
    }

    const compact = this.cam.zoom < 0.8;
    view.compactMode = compact;

    g.roundRect(b.left, b.top, b.w, b.h, METRICS.cardRadius).fill({
      color: CHROME.plate,
      alpha: 0.96,
    });
    g.roundRect(b.left + 0.5, b.top + 0.5, b.w - 1, b.h - 1, METRICS.cardRadius).stroke({
      width: 1,
      color: CHROME.rule,
      alpha: 0.9,
    });
    g.rect(b.left + 1, b.top + 1, 2.5, b.h - 2).fill({ color: accent, alpha: 0.85 });
    g.moveTo(b.left + 12, b.top + 37)
      .lineTo(b.right - 12, b.top + 37)
      .stroke({ width: 1, color: CHROME.ruleSoft, alpha: 1 });
    g.rect(b.left + 12, b.top + b.h - 14, b.w - 24, 3).fill({
      color: CHROME.inset,
      alpha: 1,
    });
    this.paintPorts(g, node);

    view.glyph.texture = glyphTexture(this.glyphShape(node));
    view.glyph.tint = accent;
    view.glyph.position.set(b.left + 22, b.top + 19);
    view.glyph.width = 16;
    view.glyph.height = 16;

    view.title.text = node.kind === 'extractor' ? 'RAW NOISE' : this.tierName(node);
    view.title.tint = CHROME.ink;
    view.title.position.set(b.left + 38, b.top + 11);

    view.sub.text = node.kind === 'extractor' ? 'EXTRACTOR' : `FORGE ${this.tierTag(node)}`;
    view.sub.tint = CHROME.inkFaint;
    view.sub.position.set(b.left + 38, b.top + 24);

    view.compact.text = node.kind === 'extractor' ? 'RAW' : this.tierTag(node);
    view.compact.tint = accent;
    view.compact.position.set(0, b.top + 34);

    view.status.position.set(b.left + 26, b.top + 44);
    view.detail.position.set(b.left + 12, b.top + 60);
    view.util.position.set(b.right - 12, b.top + 44);

    view.status.visible = !compact;
    view.detail.visible = !compact;
    view.util.visible = !compact;
    view.title.visible = !compact;
    view.sub.visible = !compact;
    view.glyph.visible = !compact;
    view.compact.visible = compact;
    view.bar.visible = !compact;
    view.dot.visible = !compact;
    view.value.visible = false;
  }

  private tierName(node: MachineNode): string {
    const tier = node.kind === 'processor' ? node.tier : 0;
    return dataInfo(tier).name.toUpperCase();
  }

  private tierTag(node: MachineNode): string {
    const tier = node.kind === 'processor' ? node.tier : 0;
    return tierLabel(tier);
  }

  private paintPorts(g: Graphics, node: MachineNode): void {
    const inputs = inputPorts(node);
    const out = outputPort(node);
    for (const port of inputs) {
      const color = port.universal ? CHROME.inkDim : tierDim(port.tier ?? 0);
      g.rect(port.dx - 3.5, port.dy - 3.5, 7, 7).stroke({ width: 1.4, color, alpha: 0.95 });
    }
    if (out) {
      g.rect(out.dx - 3.5, out.dy - 3.5, 7, 7).fill({
        color: tierBright(out.tier ?? 0),
        alpha: 0.95,
      });
    }
  }

  private paintVault(view: NodeView, node: MachineNode): void {
    const b = this.localBounds(node);
    const cx = 0;
    const cy = 0;
    const g = view.frame;
    g.roundRect(b.left, b.top, b.w, b.h, METRICS.cardRadius).fill({
      color: CHROME.plate,
      alpha: 0.96,
    });
    g.roundRect(b.left + 0.5, b.top + 0.5, b.w - 1, b.h - 1, METRICS.cardRadius).stroke({
      width: 1,
      color: CHROME.rule,
      alpha: 0.95,
    });
    g.circle(cx, cy, 52).stroke({ width: 1, color: CHROME.ruleSoft, alpha: 1 });
    g.circle(cx, cy, 38).stroke({ width: 1, color: CHROME.ruleSoft, alpha: 0.8 });
    for (let i = 0; i < 24; i++) {
      const angle = (Math.PI * 2 * i) / 24;
      const inner = i % 6 === 0 ? 58 : 62;
      g.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
        .lineTo(cx + Math.cos(angle) * 66, cy + Math.sin(angle) * 66)
        .stroke({ width: 1, color: CHROME.rule, alpha: i % 6 === 0 ? 0.9 : 0.45 });
    }
    g.moveTo(b.left + 18, b.top + 22)
      .lineTo(b.right - 18, b.top + 22)
      .stroke({ width: 1, color: CHROME.ruleSoft, alpha: 1 });
    this.paintPorts(g, node);

    view.title.text = 'VAULT';
    view.title.tint = CHROME.inkDim;
    view.title.position.set(cx, b.top + 14);
    view.title.anchor.set(0.5, 0);
    view.value.text = '';
    view.value.tint = CHROME.ink;
    view.value.position.set(cx, cy - 2);
    view.value.visible = true;
    view.detail.text = 'UNITS HELD';
    view.detail.tint = CHROME.inkFaint;
    view.detail.position.set(cx, cy + 20);
    view.detail.anchor.set(0.5, 0);
    view.status.text = '';
    view.util.text = '';
    view.compact.text = '';
    view.glyph.visible = false;
    view.title.visible = true;
    view.sub.visible = false;
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
      if (view.tier !== tier || view.kind !== node.kind) {
        view.tier = tier;
        view.kind = node.kind;
        view.lastStatus = '';
        view.lastDetail = '';
        view.lastLevel = -1;
        this.paintNode(view, node);
      }
      const compact = zoom < 0.8;
      if (compact !== view.compactMode) {
        view.compactMode = compact;
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
      view.status.text = status.toUpperCase();
      view.status.tint = STATUS_COLOR[status] ?? CHROME.inkFaint;
      view.dot.tint = STATUS_COLOR[status] ?? CHROME.inkFaint;
    }
    view.dot.position.set(b.left + 17, b.top + 47);
    view.dot.width = 9;
    view.dot.height = 9;

    const util = Math.max(0, Math.min(1, node._util ?? 0));
    const percent = Math.round(util * 100);
    if (percent !== view.lastUtil) {
      view.lastUtil = percent;
      view.util.text = `${percent}%`;
      view.util.tint = CHROME.inkFaint;
      const cap = this.bufferCapFor(node);
      const ratio = Math.max(0, Math.min(1, (node.out?.amount ?? 0) / (cap || 1)));
      const barLeft = b.left + 12;
      const barTop = b.top + b.h - 14;
      const barW = b.w - 24;
      view.bar.position.set(barLeft, barTop + 1.5);
      view.bar.height = 3;
      view.bar.width = Math.max(0, barW * ratio);
      view.bar.tint = tierBright(view.tier);
      view.bar.alpha = ratio > 0.002 ? 0.85 : 0;
    }

    const detail = this.detailText(node);
    if (detail !== view.lastDetail) {
      view.lastDetail = detail;
      view.detail.text = detail;
      view.detail.tint = CHROME.inkFaint;
    }

    if (node.level !== view.lastLevel) {
      view.lastLevel = node.level;
      view.sub.text = node.kind === 'extractor' ? 'EXTRACTOR' : `FORGE ${this.tierTag(node)}`;
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
      sprite.visible = false;
      this.particlePool[index] = sprite;
      this.particleLayer.addChild(sprite);
    }
    return sprite;
  }

  private ghostKey(): string {
    const ghost = this.view.ghost;
    if (!ghost) return '';
    return `${ghost.kind}:${ghost.tier ?? ''}:${ghost.x}:${ghost.y}:${ghost.valid ? 1 : 0}`;
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
      : `s:${selectionKey}:${this.ghostKey()}:${this.wireSignature}`;
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
    const origin = this.worldToScreen(0, 0);
    if (
      Math.abs(this.cam.zoom - this.lastZoom) > 0.0005 ||
      Math.abs(origin.x - this.lastGridX) > 0.01 ||
      Math.abs(origin.y - this.lastGridY) > 0.01
    ) {
      this.lastZoom = this.cam.zoom;
      this.lastGridX = origin.x;
      this.lastGridY = origin.y;
      this.rebuildGrid();
    }
    const cam = this.cam;
    this.worldLayer.scale.set(cam.zoom);
    this.worldLayer.position.set(this.width / 2 - cam.x * cam.zoom, this.height / 2 - cam.y * cam.zoom);
    this.updateGridOffset();
    this.updateParticles();
    this.drawOverlays();
  }

  private governQuality(now: number): void {
    if (this.lastFrame > 0) {
      this.frameTimes.push(now - this.lastFrame);
      if (this.frameTimes.length > 90) this.frameTimes.shift();
    }
    this.lastFrame = now;
    if (this.frameTimes.length < 90) return;
    let total = 0;
    for (const time of this.frameTimes) total += time;
    const average = total / this.frameTimes.length;
    if (average > 26 && this.quality > 0.6) {
      this.setQuality(this.quality === 1 ? 0.75 : 0.6);
    } else if (average > 19 && this.quality === 1) {
      this.setQuality(0.75);
    } else if (average < 13 && this.quality < 1) {
      this.setQuality(this.quality === 0.6 ? 0.75 : 1);
    }
  }

  private setQuality(quality: number): void {
    this.quality = quality;
    const resolution = Math.max(0.6, this.baseResolution * quality);
    this.app.renderer.resolution = resolution;
    this.app.renderer.resize(this.width, this.height, resolution);
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
