import {
  hitNode, hitPort, findInputPort, inputPorts, outputPort, facePort,
  linkPath, overlapsNode, snapNode, snapAnchor, anchorGuides, projectToPath,
  portWorldPos, faceFor, nodeBounds,
} from './layout.js';
import {
  placeExtractor, placeProcessor, connectNodes, currentCost, canAfford,
  addLinkAnchor, setLinkAnchor, removeLinkAnchor,
} from './actions.js';
import { dataInfo } from './gamedata.js';

const ANCHOR_GRAB = 11;
const MAX_WIRE_POINTS = 24;
const CLICK_SLOP = 4;

export class Interaction {
  constructor(canvas, app) {
    this.canvas = canvas;
    this.app = app;
    this.pointers = new Map();
    this.mode = null;
    this.drag = null;
    this.pan = null;
    this.pinch = null;
    this.wire = null;
    this.press = null;
    this.resumeWire = null;
    this.anchorDrag = null;
    this.spaceHeld = false;
    this.lastScreen = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onDoubleClick = this.onDoubleClick.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.onLeave = this.onLeave.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);

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

    this.updateCursor();
  }

  world(event) {
    return this.app.renderer.screenToWorld(event.clientX, event.clientY);
  }

  snapPosition(x, y) {
    if (this.app.state.snapGrid === false) return { x: Math.round(x), y: Math.round(y) };
    return snapNode(x, y);
  }

  onPointerDown(event) {
    if (event.button !== 0 && event.button !== 1) return;
    this.lastScreen = { x: event.clientX, y: event.clientY };
    this.press = { x: event.clientX, y: event.clientY };
    this.canvas.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 2) {
      this.beginPinch();
      return;
    }

    const p = this.world(event);
    const middle = event.button === 1;

    if (middle || this.spaceHeld) {
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
        this.app.ui.select({ kind: 'node', id: portHit.node.id });
      }
      return;
    }

    const node = this.nodeAt(p.x, p.y);
    if (node) {
      this.app.ui.select({ kind: 'node', id: node.id });
      if (node.kind === 'vault') {
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
      this.updateCursor();
      return;
    }

    const link = this.linkAt(p.x, p.y);
    if (link) {
      this.app.ui.select({ kind: 'link', id: link.id });
      this.mode = null;
      return;
    }

    this.beginPan(event);
  }

  onPointerMove(event) {
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
      this.app.state.camera.x = this.pan.camX - dx / this.app.state.camera.zoom;
      this.app.state.camera.y = this.pan.camY - dy / this.app.state.camera.zoom;
      this.canvas.classList.add('is-panning');
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
      const target = this.snapPosition(
        this.drag.originX + dx / this.app.state.camera.zoom,
        this.drag.originY + dy / this.app.state.camera.zoom,
      );
      if (!overlapsNode(this.app.state.nodes, target.x, target.y, this.drag.node.kind, this.drag.node.id)) {
        this.drag.node.x = target.x;
        this.drag.node.y = target.y;
      }
      this.app.view.dragCell = { x: this.drag.node.x, y: this.drag.node.y, kind: this.drag.node.kind };
      this.canvas.classList.add('is-node');
      return;
    }

    if (this.mode === 'wire' && this.wire) {
      this.updateWire(p);
      return;
    }

    if (this.app.view.pendingBuild) {
      this.updateGhost(event.clientX, event.clientY);
      this.setHover(p.x, p.y, true);
      return;
    }

    this.setHover(p.x, p.y, false);
  }

  onPointerUp(event) {
    this.pointers.delete(event.pointerId);
    if (this.mode === 'pinch') {
      if (this.pointers.size >= 2) return;
      this.pinch = null;
      this.mode = null;
      this.updateCursor();
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
      this.updateCursor();
      return;
    }

    if (this.mode === 'node' && this.drag) {
      if (this.drag.moved) {
        this.app.saveSoon();
      } else {
        this.app.revealSelection?.({ kind: 'node', id: this.drag.node.id });
      }
      this.drag = null;
      this.app.view.dragCell = null;
      this.mode = null;
      this.updateCursor();
      return;
    }

    if (this.mode === 'pan' && this.pan) {
      if (!this.pan.moved) {
        this.app.ui.deselect();
        this.app.ui.closeMobilePanels();
      }
      this.pan = null;
      if (this.resumeWire) {
        this.wire = this.resumeWire;
        this.resumeWire = null;
        this.mode = 'wire';
        this.updateCursor();
        return;
      }
      this.mode = null;
      this.updateCursor();
      return;
    }

    this.mode = null;
  }

  onPointerCancel(event) {
    this.pointers.delete(event.pointerId);
    if (this.mode === 'node' && this.drag?.moved) this.app.saveSoon();
    this.clearTransient();
  }

  onDoubleClick(event) {
    if (this.app.view.pendingBuild) return;
    const p = this.world(event);
    const link = this.linkAt(p.x, p.y);
    if (!link) return;
    const point = this.snapAnchorPoint(link, p.x, p.y);
    const index = this.anchorInsertionIndex(link, p.x, p.y);
    addLinkAnchor(this.app, link.id, point.x, point.y, index);
    this.app.ui.select({ kind: 'link', id: link.id });
  }

  anchorInsertionIndex(link, x, y) {
    const state = this.app.state;
    const byId = new Map(state.nodes.map((node) => [node.id, node]));
    const path = linkPath(link, byId.get(link.from), byId.get(link.to));
    if (!path) return -1;
    const target = projectToPath(path, x, y);
    const anchors = link.anchors || [];
    for (let index = 0; index < anchors.length; index++) {
      if (projectToPath(path, anchors[index].x, anchors[index].y) > target) return index;
    }
    return anchors.length;
  }

  onContextMenu(event) {
    event.preventDefault();
    if (this.mode === 'wire' && this.wire) {
      const draft = this.app.view.linkDraft;
      if (draft?.points.length) {
        draft.points.pop();
        this.app.audio.click();
        this.app.renderer.draw(performance.now());
        return;
      }
      this.clearDraft();
      return;
    }
    const p = this.world(event);
    const hit = this.anchorAt(p.x, p.y);
    if (!hit) return;
    const selection = this.app.view.selection;
    const wasSelected = selection?.kind === 'anchor' &&
      selection.linkId === hit.link.id &&
      selection.index === hit.index;
    removeLinkAnchor(this.app, hit.link.id, hit.index);
    if (wasSelected) this.app.ui.select({ kind: 'link', id: hit.link.id });
  }

  onLeave() {
    if (this.mode) return;
    this.app.view.hoverNode = null;
    this.app.view.hoverPort = null;
    this.app.view.hoverAnchor = null;
    this.updateCursor();
  }

  onWheel(event) {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    this.app.renderer.zoomAt(event.clientX, event.clientY, factor);
    this.app.saveSoon();
  }

  onKeyDown(event) {
    const target = event.target;
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
      if (ui.refs.modalRoot.childElementCount > 0) {
        ui.closeModal();
        return;
      }
      if (!ui.refs.settings.hidden) {
        ui.closeSettings();
        return;
      }
      if (this.app.view.pendingBuild || this.app.view.linkDraft) {
        this.app.setPendingBuild(null);
        this.clearDraft();
        return;
      }
      if (this.app.view.selection) {
        ui.deselect();
        return;
      }
      ui.closeMobilePanels();
      return;
    }

    if (event.repeat) return;
    if (ui.refs.modalRoot.childElementCount > 0 || !ui.refs.settings.hidden) return;

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
        ui.openSidebar('build');
        break;
      case 'c':
        ui.openSidebar('codex');
        break;
      case 'g':
        this.app.toggleGridSnap();
        break;
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
  }

  onKeyUp(event) {
    if (event.code === 'Space') this.spaceHeld = false;
  }

  onBlur() {
    this.spaceHeld = false;
    this.pointers.clear();
    if (this.mode !== 'pinch') this.clearTransient();
  }

  beginPan(event) {
    this.resumeWire = this.mode === 'wire' ? this.wire : null;
    this.mode = 'pan';
    this.pan = {
      startX: event.clientX,
      startY: event.clientY,
      camX: this.app.state.camera.x,
      camY: this.app.state.camera.y,
      moved: false,
    };
    this.canvas.classList.add('is-panning');
  }

  beginWire(node, port, p, fresh = true) {
    this.mode = 'wire';
    this.wire = { fromId: node.id, tier: port.tier, justBegan: fresh };
    const snapped = this.snapPosition(p.x, p.y);
    this.app.view.linkDraft = {
      fromId: node.id,
      tier: port.tier,
      points: [],
      x: snapped.x,
      y: snapped.y,
      targetId: null,
      targetTier: null,
      targetFace: null,
      targetPos: null,
    };
    this.app.view.selection = null;
    this.app.ui.deselect();
    this.updateCursor();
  }

  updateWire(p) {
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

    const fromId = this.wire.fromId;
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
    this.canvas.classList.add('is-wiring');
  }

  markTarget(draft, node, port) {
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

  resolveWirePress(event) {
    const wire = this.wire;
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

  connectAt(p) {
    const draft = this.app.view.linkDraft;
    if (!draft) return false;
    const fromId = this.wire.fromId;

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

  compatiblePort(node, port) {
    if (node.kind === 'vault') return port || this.vaultPortFor(node);
    return findInputPort(node, this.wire.tier);
  }

  vaultPortFor(node) {
    const from = this.nodeById(this.wire.fromId);
    const draft = this.app.view.linkDraft;
    const last = draft?.points?.length ? draft.points[draft.points.length - 1] : null;
    const out = from ? outputPort(from) : null;
    const approach = last || (out ? portWorldPos(from, out) : { x: node.x, y: node.y });
    const face = faceFor(approach.x - node.x, approach.y - node.y);
    return facePort(node, face) || inputPorts(node)[0] || null;
  }

  denyFit() {
    this.deny(`${dataInfo(this.wire.tier).name} does not fit that input.`);
  }

  deny(text) {
    this.app.audio.deny();
    this.app.toast({ text, tone: 'bad', quiet: true });
  }

  completeWire(target, port, face) {
    const draft = this.app.view.linkDraft;
    const points = (draft?.points || []).map((point) => ({ x: point.x, y: point.y }));
    const side = face && target.kind === 'vault' ? face : null;
    const link = connectNodes(this.app, this.wire.fromId, target.id, { points, side });
    this.clearDraft();
    this.app.view.hoverPort = null;
    this.app.renderer.draw(performance.now());
    this.updateCursor();
    return link;
  }

  addWirePoint(p) {
    const draft = this.app.view.linkDraft;
    if (!draft) return;
    if (draft.points.length >= MAX_WIRE_POINTS) {
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

  insideMachine(point) {
    for (const node of this.app.state.nodes) {
      const b = nodeBounds(node);
      if (point.x >= b.left && point.x <= b.right && point.y >= b.top && point.y <= b.bottom) return true;
    }
    return false;
  }

  clearDraft() {
    this.app.view.linkDraft = null;
    this.wire = null;
    this.press = null;
    this.resumeWire = null;
    this.mode = null;
    this.updateCursor();
  }

  clearTransient() {
    if (this.app.view.linkDraft) {
      this.app.view.linkDraft = null;
      this.wire = null;
    }
    if (this.app.view.pendingBuild) this.updateGhost(this.lastScreen.x, this.lastScreen.y);
    this.drag = null;
    this.pan = null;
    this.anchorDrag = null;
    this.press = null;
    this.resumeWire = null;
    this.mode = null;
    this.updateCursor();
  }

  nodeById(id) {
    return this.app.state.nodes.find((node) => node.id === id) || null;
  }

  nodeAt(wx, wy) {
    const nodes = this.app.state.nodes;
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (hitNode(nodes[i], wx, wy)) return nodes[i];
    }
    return null;
  }

  portAt(wx, wy) {
    const nodes = this.app.state.nodes;
    const radius = 18 / this.app.state.camera.zoom;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const port = hitPort(nodes[i], wx, wy, radius);
      if (port) return { node: nodes[i], port };
    }
    return null;
  }

  linkAt(wx, wy) {
    const state = this.app.state;
    const byId = new Map(state.nodes.map((node) => [node.id, node]));
    const threshold = 10 / state.camera.zoom;
    let best = null;
    let bestDistance = Infinity;
    for (const link of state.links) {
      const from = byId.get(link.from);
      const to = byId.get(link.to);
      if (!from || !to) continue;
      const path = linkPath(link, from, to);
      if (!path) continue;
      const distance = path.distance(wx, wy);
      if (distance < threshold && distance < bestDistance) {
        best = link;
        bestDistance = distance;
      }
    }
    return best;
  }

  anchorAt(wx, wy) {
    const state = this.app.state;
    const threshold = ANCHOR_GRAB / state.camera.zoom;
    let best = null;
    let bestDistance = Infinity;
    for (const link of state.links) {
      const anchors = link.anchors || [];
      for (let index = 0; index < anchors.length; index++) {
        const anchor = anchors[index];
        const distance = Math.hypot(anchor.x - wx, anchor.y - wy);
        if (distance <= threshold && distance < bestDistance) {
          best = { link, index };
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  beginAnchorDrag(hit, p) {
    this.mode = 'anchor';
    this.anchorDrag = {
      link: hit.link,
      index: hit.index,
      offsetX: hit.link.anchors[hit.index].x - p.x,
      offsetY: hit.link.anchors[hit.index].y - p.y,
      moved: false,
    };
    this.app.ui.select({ kind: 'anchor', linkId: hit.link.id, index: hit.index });
    this.updateCursor();
  }

  updateAnchorDrag(p) {
    const drag = this.anchorDrag;
    if (!drag) return;
    const point = this.snapAnchorPoint(drag.link, p.x + drag.offsetX, p.y + drag.offsetY, drag.index);
    setLinkAnchor(this.app, drag.link.id, drag.index, point.x, point.y);
    drag.moved = true;
    this.canvas.classList.add('is-node');
  }

  snapAnchorPoint(link, x, y, excludeIndex = -1) {
    const state = this.app.state;
    const byId = new Map(state.nodes.map((node) => [node.id, node]));
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    const threshold = 11 / state.camera.zoom;
    const guides = anchorGuides(link, from, to, excludeIndex);
    return snapAnchor(x, y, guides, threshold);
  }

  setHover(wx, wy, whilePlacing) {
    const view = this.app.view;
    view.hoverNode = null;
    view.hoverPort = null;
    view.hoverAnchor = null;
    const anchorHit = this.anchorAt(wx, wy);
    if (anchorHit) {
      view.hoverAnchor = { linkId: anchorHit.link.id, index: anchorHit.index };
      this.updateCursor(whilePlacing);
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
    this.updateCursor(whilePlacing);
  }

  updateCursor(whilePlacing = false) {
    const c = this.canvas.classList;
    c.remove('is-panning', 'is-placing', 'is-wiring', 'is-node', 'is-port');
    if (this.mode === 'wire') c.add('is-wiring');
    else if (this.mode === 'pan') c.add('is-panning');
    else if (this.mode === 'anchor') c.add('is-node');
    else if (this.mode === 'node') c.add('is-node');
    else if (this.app.view.pendingBuild || whilePlacing) c.add('is-placing');
    else if (this.app.view.hoverAnchor) c.add('is-node');
    else if (this.app.view.hoverPort) c.add('is-port');
    else if (this.app.view.hoverNode) c.add('is-node');
  }

  updateGhost(screenX = this.lastScreen.x, screenY = this.lastScreen.y) {
    const pending = this.app.view.pendingBuild;
    if (!pending) {
      this.app.view.ghost = null;
      return;
    }
    const p = this.app.renderer.screenToWorld(screenX, screenY);
    const target = this.snapPosition(p.x, p.y);
    const cost = currentCost(this.app.state, pending.kind, pending.tier);
    const valid = canAfford(this.app.state, cost) &&
      !overlapsNode(this.app.state.nodes, target.x, target.y, pending.kind);
    this.app.view.ghost = {
      x: target.x,
      y: target.y,
      kind: pending.kind,
      tier: pending.tier,
      valid,
    };
  }

  place(p, keepArmed) {
    const pending = this.app.view.pendingBuild;
    if (!pending) return;
    this.updateGhost(this.lastScreen.x, this.lastScreen.y);
    const target = this.snapPosition(p.x, p.y);
    if (overlapsNode(this.app.state.nodes, target.x, target.y, pending.kind)) {
      this.app.audio.deny();
      this.app.toast({ text: 'Too close to another machine.', tone: 'bad', quiet: true });
      return;
    }
    if (pending.kind === 'extractor') placeExtractor(this.app, target.x, target.y, keepArmed);
    else placeProcessor(this.app, pending.tier, target.x, target.y, keepArmed);
    if (this.app.view.pendingBuild) this.updateGhost(this.lastScreen.x, this.lastScreen.y);
    this.updateCursor();
  }

  beginPinch() {
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
      anchor: this.app.renderer.screenToWorld(mid.x, mid.y),
    };
    this.updateCursor();
  }

  updatePinch() {
    if (!this.pinch) return;
    const values = [...this.pointers.values()];
    if (values.length < 2) return;
    const [a, b] = values;
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const zoom = Math.min(2.2, Math.max(0.35, this.pinch.startZoom * distance / this.pinch.startDistance));
    const cam = this.app.state.camera;
    cam.zoom = zoom;
    cam.x = this.pinch.anchor.x - (mid.x - window.innerWidth / 2) / zoom;
    cam.y = this.pinch.anchor.y - (mid.y - window.innerHeight / 2) / zoom;
  }
}
