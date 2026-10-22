import {
  faceFor,
  facePort,
  findInputPort,
  hitNode,
  hitPort,
  inputPorts,
  linkPath,
  nodeBounds,
  outputPort,
  overlapsNode,
  portWorldPos,
  projectToPath,
  snapAnchor,
  snapNode,
  anchorGuides,
} from '../layout/geometry.ts';
import {
  addLinkAnchor,
  connectNodes,
  currentCost,
  canAfford,
  placeExtractor,
  placeProcessor,
  removeLinkAnchor,
  setLinkAnchor,
} from '../game/actions.ts';
import { dataInfo } from '../game/gamedata.ts';
import type { App } from '../app.ts';
import { CONFIG } from '../game/gamedata.ts';
import type { Face, Link, MachineNode, Point } from '../game/types.ts';
import { MAX_ANCHORS } from '../game/types.ts';

const ANCHOR_GRAB = 11;
const CLICK_SLOP = 4;

export class Interaction {
  private canvas: HTMLCanvasElement;
  private app: App;
  private pointers = new Map<number, Point>();
  private mode: 'wire' | 'pan' | 'node' | 'anchor' | 'pinch' | null = null;
  private drag: {
    node: MachineNode;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null = null;
  private pan: {
    startX: number;
    startY: number;
    camX: number;
    camY: number;
    moved: boolean;
  } | null = null;
  private pinch: { startDistance: number; startZoom: number; anchor: Point } | null = null;
  private wire: { fromId: number; tier: number; justBegan: boolean } | null = null;
  private press: Point | null = null;
  private resumeWire: { fromId: number; tier: number; justBegan: boolean } | null = null;
  private anchorDrag: {
    linkId: number;
    index: number;
    offsetX: number;
    offsetY: number;
  } | null = null;
  private spaceHeld = false;
  private lastScreen = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

  constructor(canvas: HTMLCanvasElement, app: App) {
    this.canvas = canvas;
    this.app = app;

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('dblclick', this.onDoubleClick);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
  }

  private world(event: { clientX: number; clientY: number }): Point {
    return this.app.board.screenToWorld(event.clientX, event.clientY);
  }

  private snapPosition(x: number, y: number): Point {
    if (this.app.state.snapGrid === false) return { x: Math.round(x), y: Math.round(y) };
    return snapNode(x, y);
  }

  private onResize = (): void => {
    this.app.board.resize();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) return;
    this.app.board.cancelFocus();
    this.lastScreen = { x: event.clientX, y: event.clientY };
    this.press = { x: event.clientX, y: event.clientY };
    this.canvas.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 2) {
      this.beginPinch();
      return;
    }

    const p = this.world(event);
    if (event.button === 1 || this.spaceHeld) {
      this.beginPan(event);
      return;
    }

    if (this.app.view.pendingBuild) {
      this.place(p, event.shiftKey);
      return;
    }

    if (this.mode === 'wire' && this.wire) return;

    const anchorHit = this.anchorAt(p.x, p.y);
    if (anchorHit) {
      this.beginAnchorDrag(anchorHit, p);
      return;
    }

    const portHit = this.portAt(p.x, p.y);
    if (portHit) {
      if (portHit.port.dir === 'out') {
        this.beginWire(portHit.node, portHit.port, p);
      } else {
        this.app.ui?.select({ kind: 'node', id: portHit.node.id });
        this.app.focusNode(portHit.node.id);
      }
      return;
    }

    const node = this.nodeAt(p.x, p.y);
    if (node) {
      this.app.ui?.select({ kind: 'node', id: node.id });
      if (node.kind === 'vault') {
        this.app.focusNode(node.id);
        this.mode = null;
        return;
      }
      this.mode = 'node';
      this.drag = {
        node,
        startX: event.clientX,
        startY: event.clientY,
        originX: node.x,
        originY: node.y,
        moved: false,
      };
      return;
    }

    const link = this.linkAt(p.x, p.y);
    if (link) {
      this.app.ui?.select({ kind: 'link', id: link.id });
      this.mode = null;
      return;
    }

    this.beginPan(event);
  };

  private onPointerMove = (event: PointerEvent): void => {
    this.lastScreen = { x: event.clientX, y: event.clientY };
    if (this.pointers.has(event.pointerId)) {
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (this.mode === 'pinch' && this.pointers.size >= 2) {
      this.updatePinch();
      return;
    }

    const p = this.world(event);

    if (this.mode === 'pan' && this.pan) {
      const dx = event.clientX - this.pan.startX;
      const dy = event.clientY - this.pan.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.pan.moved = true;
      const cam = this.app.state.camera;
      cam.x = this.pan.camX - dx / cam.zoom;
      cam.y = this.pan.camY - dy / cam.zoom;
      return;
    }

    if (this.mode === 'anchor' && this.anchorDrag) {
      this.updateAnchorDrag(p);
      return;
    }

    if (this.mode === 'node' && this.drag) {
      const dx = event.clientX - this.drag.startX;
      const dy = event.clientY - this.drag.startY;
      if (!this.drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      this.drag.moved = true;
      const zoom = this.app.state.camera.zoom;
      const target = this.snapPosition(this.drag.originX + dx / zoom, this.drag.originY + dy / zoom);
      if (!overlapsNode(this.app.state.nodes, target.x, target.y, this.drag.node.kind, this.drag.node.id)) {
        this.drag.node.x = target.x;
        this.drag.node.y = target.y;
      }
      this.app.view.dragCell = {
        x: this.drag.node.x,
        y: this.drag.node.y,
        kind: this.drag.node.kind,
      };
      return;
    }

    if (this.mode === 'wire' && this.wire) {
      this.updateWire(p);
      return;
    }

    if (this.app.view.pendingBuild) {
      this.updateGhost();
      this.setHover(p.x, p.y);
      return;
    }

    this.setHover(p.x, p.y);
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.mode === 'pinch') {
      if (this.pointers.size >= 2) return;
      this.pinch = null;
      this.mode = null;
      return;
    }

    if (event.button === 2) {
      this.press = null;
      return;
    }

    if (this.mode === 'wire' && this.wire) {
      this.resolveWirePress(event);
      return;
    }

    if (this.mode === 'anchor' && this.anchorDrag) {
      this.anchorDrag = null;
      this.mode = null;
      this.app.afterChange();
      return;
    }

    if (this.mode === 'node' && this.drag) {
      if (this.drag.moved) {
        this.app.saveSoon();
      } else {
        this.app.focusNode(this.drag.node.id);
      }
      this.drag = null;
      this.app.view.dragCell = null;
      this.mode = null;
      return;
    }

    if (this.mode === 'pan' && this.pan) {
      if (!this.pan.moved) {
        this.app.ui?.deselect();
        this.app.ui?.closeMobilePanels();
      }
      this.pan = null;
      if (this.resumeWire) {
        this.wire = this.resumeWire;
        this.resumeWire = null;
        this.mode = 'wire';
        return;
      }
      this.mode = null;
      return;
    }

    this.mode = null;
  };

  private onPointerCancel = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.mode === 'node' && this.drag?.moved) this.app.saveSoon();
    this.clearTransient();
  };

  private onDoubleClick = (event: MouseEvent): void => {
    if (this.app.view.pendingBuild) return;
    const p = this.world(event);
    const link = this.linkAt(p.x, p.y);
    if (!link) return;
    const point = this.snapAnchorPoint(link, p.x, p.y);
    const index = this.anchorInsertionIndex(link, p.x, p.y);
    addLinkAnchor(this.app, link.id, point.x, point.y, index);
    this.app.ui?.select({ kind: 'link', id: link.id });
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    if (this.mode === 'wire' && this.wire) {
      const draft = this.app.view.linkDraft;
      if (draft?.points.length) {
        draft.points.pop();
        this.app.audio.click();
        return;
      }
      this.clearDraft();
      return;
    }
    const p = this.world(event);
    const hit = this.anchorAt(p.x, p.y);
    if (!hit) return;
    const selection = this.app.view.selection;
    const wasSelected =
      selection?.kind === 'anchor' && selection.linkId === hit.link.id && selection.index === hit.index;
    removeLinkAnchor(this.app, hit.link.id, hit.index);
    if (wasSelected) this.app.ui?.select({ kind: 'link', id: hit.link.id });
  };

  private onLeave = (): void => {
    if (this.mode) return;
    this.app.view.hoverNode = null;
    this.app.view.hoverPort = null;
    this.app.view.hoverAnchor = null;
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    this.app.board.zoomAt(event.clientX, event.clientY, factor);
    this.app.saveSoon();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const typing = Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
    if (typing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const ui = this.app.ui;
    if (event.code === 'Space') {
      if (target?.closest?.('button, a, [role="button"]')) return;
      if (event.repeat) return;
      event.preventDefault();
      this.spaceHeld = true;
      return;
    }

    if (event.key === 'Escape') {
      if (ui && ui.refs.modalRoot.childElementCount > 0) {
        ui.closeModal();
        return;
      }
      if (ui && !ui.refs.settings.hidden) {
        ui.closeSettings();
        return;
      }
      if (this.app.view.pendingBuild || this.app.view.linkDraft) {
        this.app.setPendingBuild(null);
        this.clearDraft();
        return;
      }
      if (this.app.view.selection) {
        ui?.deselect();
        return;
      }
      ui?.closeMobilePanels();
      return;
    }

    if (event.repeat) return;
    if (ui && (ui.refs.modalRoot.childElementCount > 0 || !ui.refs.settings.hidden)) return;

    switch (event.key.toLowerCase()) {
      case 'p':
        this.app.togglePause();
        break;
      case 'm':
        this.app.toggleMuted();
        break;
      case 'h':
        this.app.fitView();
        break;
      case 'b':
        ui?.openSidebar('build');
        break;
      case 'c':
        ui?.openSidebar('codex');
        break;
      case 'g':
        this.app.toggleGridSnap();
        break;
      case 'r': {
        const selection = this.app.view.selection;
        if (selection?.kind === 'node') this.app.rotateNode(selection.id);
        break;
      }
      case '+':
      case '=':
        this.app.zoomBy(1.2);
        break;
      case '-':
        this.app.zoomBy(1 / 1.2);
        break;
      case 'delete': {
        const selection = this.app.view.selection;
        if (!selection) break;
        if (selection.kind === 'node') this.app.dismantleNode(selection.id);
        else if (selection.kind === 'link') this.app.removeLink(selection.id);
        else if (selection.kind === 'anchor') this.app.removeAnchor(selection.linkId, selection.index);
        break;
      }
      default:
        break;
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'Space') this.spaceHeld = false;
  };

  private onBlur = (): void => {
    this.spaceHeld = false;
    this.pointers.clear();
    if (this.mode !== 'pinch') this.clearTransient();
  };

  private beginPan(event: PointerEvent): void {
    this.resumeWire = this.mode === 'wire' ? this.wire : null;
    this.mode = 'pan';
    const cam = this.app.state.camera;
    this.pan = {
      startX: event.clientX,
      startY: event.clientY,
      camX: cam.x,
      camY: cam.y,
      moved: false,
    };
  }

  private beginWire(node: MachineNode, port: { tier: number | null }, p: Point, fresh = true): void {
    this.mode = 'wire';
    this.wire = { fromId: node.id, tier: port.tier ?? 0, justBegan: fresh };
    const snapped = this.snapPosition(p.x, p.y);
    this.app.view.linkDraft = {
      fromId: node.id,
      tier: port.tier ?? 0,
      points: [],
      x: snapped.x,
      y: snapped.y,
      targetId: null,
      targetTier: null,
      targetFace: null,
      targetPos: null,
    };
    this.app.view.selection = null;
    this.app.ui?.deselect();
  }

  private updateWire(p: Point): void {
    const draft = this.app.view.linkDraft;
    if (!draft) return;
    const snapped = this.snapPosition(p.x, p.y);
    draft.x = snapped.x;
    draft.y = snapped.y;
    draft.targetId = null;
    draft.targetTier = null;
    draft.targetFace = null;
    draft.targetPos = null;
    this.app.view.hoverPort = null;

    const fromId = this.wire?.fromId ?? -1;
    const portHit = this.portAt(p.x, p.y);
    if (portHit && portHit.node.id !== fromId && portHit.port.dir === 'in') {
      const port = this.compatiblePort(portHit.node, portHit.port);
      if (port) this.markTarget(draft, portHit.node, port);
    } else {
      const node = this.nodeAt(p.x, p.y);
      if (node && node.id !== fromId && node.kind !== 'extractor') {
        const port = this.compatiblePort(node, null);
        if (port) this.markTarget(draft, node, port);
      }
    }
  }

  private markTarget(
    draft: NonNullable<App['view']['linkDraft']>,
    node: MachineNode,
    port: ReturnType<typeof inputPorts>[number],
  ): void {
    draft.targetId = node.id;
    draft.targetTier = port.universal ? null : port.tier;
    draft.targetFace = port.face;
    draft.targetPos = portWorldPos(node, port);
    this.app.view.hoverPort = {
      nodeId: node.id,
      dir: 'in',
      tier: port.universal ? null : port.tier,
      index: port.index,
    };
  }

  private resolveWirePress(event: PointerEvent): void {
    const wire = this.wire;
    if (!wire) return;
    const p = this.world(event);
    const press = this.press;
    const moved = press
      ? Math.abs(event.clientX - press.x) + Math.abs(event.clientY - press.y) > CLICK_SLOP
      : false;
    this.press = null;

    if (wire.justBegan) {
      wire.justBegan = false;
      if (moved) this.connectAt(p);
      return;
    }
    if (this.connectAt(p)) return;
    if (moved) return;
    this.addWirePoint(p);
  }

  private connectAt(p: Point): boolean {
    const draft = this.app.view.linkDraft;
    if (!draft) return false;
    const fromId = this.wire?.fromId ?? -1;

    const portHit = this.portAt(p.x, p.y);
    if (portHit && portHit.node.id !== fromId) {
      if (portHit.port.dir === 'out') {
        this.beginWire(portHit.node, portHit.port, p, false);
        return true;
      }
      const port = this.compatiblePort(portHit.node, portHit.port);
      if (!port) {
        this.denyFit();
        return true;
      }
      this.completeWire(portHit.node, port, portHit.port.face);
      return true;
    }

    const node = this.nodeAt(p.x, p.y);
    if (node) {
      if (node.id === fromId) return true;
      if (node.kind === 'extractor') {
        this.deny('Extractors have no input.');
        return true;
      }
      const port = this.compatiblePort(node, null);
      if (!port) {
        this.denyFit();
        return true;
      }
      this.completeWire(node, port, null);
      return true;
    }

    return false;
  }

  private compatiblePort(node: MachineNode, port: ReturnType<typeof inputPorts>[number] | null) {
    if (node.kind === 'vault') return port ?? this.vaultPortFor(node);
    return findInputPort(node, this.wire?.tier ?? 0);
  }

  private vaultPortFor(node: MachineNode) {
    const from = this.nodeById(this.wire?.fromId ?? -1);
    const draft = this.app.view.linkDraft;
    const last = draft?.points?.length ? draft.points[draft.points.length - 1] : null;
    const out = from ? outputPort(from) : null;
    const approach = last ?? (out ? portWorldPos(from as MachineNode, out) : { x: node.x, y: node.y });
    const face = faceFor(approach.x - node.x, approach.y - node.y);
    return facePort(node, face) ?? inputPorts(node)[0] ?? null;
  }

  private denyFit(): void {
    this.deny(`${dataInfo(this.wire?.tier ?? 0).name} does not fit that input.`);
  }

  private deny(text: string): void {
    this.app.audio.deny();
    this.app.toast({ text, tone: 'bad', quiet: true });
  }

  private completeWire(
    target: MachineNode,
    _port: ReturnType<typeof inputPorts>[number],
    face: Face | null,
  ): void {
    const draft = this.app.view.linkDraft;
    const points = (draft?.points ?? []).map((point) => ({ x: point.x, y: point.y }));
    const side = face && target.kind === 'vault' ? face : undefined;
    connectNodes(this.app, this.wire?.fromId ?? -1, target.id, { points, side });
    this.clearDraft();
    this.app.view.hoverPort = null;
  }

  private addWirePoint(p: Point): void {
    const draft = this.app.view.linkDraft;
    if (!draft) return;
    if (draft.points.length >= MAX_ANCHORS) {
      this.deny('That route already has enough points.');
      return;
    }
    const point = this.snapPosition(p.x, p.y);
    if (this.insideMachine(point)) {
      this.deny('A wire cannot run through a machine.');
      return;
    }
    draft.points.push(point);
    this.app.audio.click();
  }

  private insideMachine(point: Point): boolean {
    for (const node of this.app.state.nodes) {
      const b = nodeBounds(node);
      if (point.x >= b.left && point.x <= b.right && point.y >= b.top && point.y <= b.bottom) return true;
    }
    return false;
  }

  private clearDraft(): void {
    this.app.view.linkDraft = null;
    this.wire = null;
    this.press = null;
    this.resumeWire = null;
    this.mode = null;
  }

  clearTransient(): void {
    if (this.app.view.linkDraft) {
      this.app.view.linkDraft = null;
      this.wire = null;
    }
    if (this.app.view.pendingBuild) this.updateGhost();
    this.drag = null;
    this.pan = null;
    this.anchorDrag = null;
    this.press = null;
    this.resumeWire = null;
    this.mode = null;
  }

  private nodeById(id: number): MachineNode | null {
    return this.app.state.nodes.find((node) => node.id === id) ?? null;
  }

  private nodeAt(wx: number, wy: number): MachineNode | null {
    const nodes = this.app.state.nodes;
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (hitNode(nodes[i], wx, wy)) return nodes[i];
    }
    return null;
  }

  private portAt(wx: number, wy: number) {
    const nodes = this.app.state.nodes;
    const radius = 18 / this.app.state.camera.zoom;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const port = hitPort(nodes[i], wx, wy, radius);
      if (port) return { node: nodes[i], port };
    }
    return null;
  }

  private linkAt(wx: number, wy: number) {
    const state = this.app.state;
    const threshold = 10 / state.camera.zoom;
    let best = null;
    let bestDistance = Infinity;
    for (const link of state.links) {
      const path = this.app.board.pathFor(link.id);
      if (!path) continue;
      const distance = path.distance(wx, wy);
      if (distance < threshold && distance < bestDistance) {
        best = link;
        bestDistance = distance;
      }
    }
    return best;
  }

  private anchorAt(wx: number, wy: number) {
    const threshold = ANCHOR_GRAB / this.app.state.camera.zoom;
    const hit = this.app.board.anchorHit(wx, wy, threshold);
    if (!hit || !hit.link) return null;
    return { link: hit.link, index: hit.index };
  }

  private anchorInsertionIndex(link: Link, x: number, y: number): number {
    const state = this.app.state;
    const byId = new Map(state.nodes.map((node) => [node.id, node]));
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) return -1;
    const path = linkPath(link, from, to);
    if (!path) return -1;
    const target = projectToPath(path, x, y);
    const anchors = link.anchors ?? [];
    for (let index = 0; index < anchors.length; index++) {
      if (projectToPath(path, anchors[index].x, anchors[index].y) > target) return index;
    }
    return anchors.length;
  }

  private beginAnchorDrag(hit: { link: Link; index: number }, p: Point): void {
    this.mode = 'anchor';
    const anchor = hit.link.anchors[hit.index];
    this.anchorDrag = {
      linkId: hit.link.id,
      index: hit.index,
      offsetX: anchor.x - p.x,
      offsetY: anchor.y - p.y,
    };
    this.app.ui?.select({ kind: 'anchor', linkId: hit.link.id, index: hit.index });
  }

  private updateAnchorDrag(p: Point): void {
    const drag = this.anchorDrag;
    if (!drag) return;
    const link = this.app.state.links.find((candidate) => candidate.id === drag.linkId);
    if (!link) return;
    const point = this.snapAnchorPoint(link, p.x + drag.offsetX, p.y + drag.offsetY, drag.index);
    setLinkAnchor(this.app, drag.linkId, drag.index, point.x, point.y);
  }

  private snapAnchorPoint(link: Link, x: number, y: number, excludeIndex = -1): Point {
    const state = this.app.state;
    const byId = new Map(state.nodes.map((node) => [node.id, node]));
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) return { x, y };
    const threshold = 11 / state.camera.zoom;
    const guides = anchorGuides(link, from, to, excludeIndex);
    return snapAnchor(x, y, guides, threshold);
  }

  private setHover(wx: number, wy: number): void {
    const view = this.app.view;
    view.hoverNode = null;
    view.hoverPort = null;
    view.hoverAnchor = null;
    const anchorHit = this.anchorAt(wx, wy);
    if (anchorHit) {
      view.hoverAnchor = { linkId: anchorHit.link.id, index: anchorHit.index };
      return;
    }
    const portHit = this.portAt(wx, wy);
    if (portHit) {
      view.hoverNode = portHit.node.id;
      view.hoverPort = {
        nodeId: portHit.node.id,
        dir: portHit.port.dir,
        tier: portHit.port.universal ? null : portHit.port.tier,
        index: portHit.port.index,
      };
    } else {
      const node = this.nodeAt(wx, wy);
      if (node) view.hoverNode = node.id;
    }
  }

  updateGhost(): void {
    const pending = this.app.view.pendingBuild;
    if (!pending) {
      this.app.view.ghost = null;
      return;
    }
    const p = this.app.board.screenToWorld(this.lastScreen.x, this.lastScreen.y);
    const target = this.snapPosition(p.x, p.y);
    const cost = currentCost(this.app.state, pending.kind, pending.tier);
    const valid =
      canAfford(this.app.state, cost) &&
      !overlapsNode(this.app.state.nodes, target.x, target.y, pending.kind);
    this.app.view.ghost = {
      x: target.x,
      y: target.y,
      kind: pending.kind,
      tier: pending.tier,
      valid,
    };
  }

  private place(p: Point, keepArmed: boolean): void {
    const pending = this.app.view.pendingBuild;
    if (!pending) return;
    this.updateGhost();
    const target = this.snapPosition(p.x, p.y);
    if (overlapsNode(this.app.state.nodes, target.x, target.y, pending.kind)) {
      this.app.audio.deny();
      this.app.toast({ text: 'Too close to another machine.', tone: 'bad', quiet: true });
      return;
    }
    if (pending.kind === 'extractor') placeExtractor(this.app, target.x, target.y, keepArmed);
    else placeProcessor(this.app, pending.tier ?? 1, target.x, target.y, keepArmed);
  }

  private beginPinch(): void {
    if (this.mode === 'node' && this.drag?.moved) this.app.saveSoon();
    this.mode = 'pinch';
    this.drag = null;
    this.pan = null;
    this.wire = null;
    this.resumeWire = null;
    if (this.app.view.linkDraft) this.app.view.linkDraft = null;
    const [a, b] = [...this.pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.pinch = {
      startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startZoom: this.app.state.camera.zoom,
      anchor: this.app.board.screenToWorld(mid.x, mid.y),
    };
  }

  private updatePinch(): void {
    if (!this.pinch) return;
    const values = [...this.pointers.values()];
    if (values.length < 2) return;
    const [a, b] = values;
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const cam = this.app.state.camera;
    const zoom = Math.min(
      CONFIG.zoomMax,
      Math.max(CONFIG.zoomMin, (this.pinch.startZoom * distance) / this.pinch.startDistance),
    );
    cam.zoom = zoom;
    cam.x = this.pinch.anchor.x - (mid.x - window.innerWidth / 2) / zoom;
    cam.y = this.pinch.anchor.y - (mid.y - window.innerHeight / 2) / zoom;
  }
}
