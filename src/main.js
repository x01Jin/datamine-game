import {
  createInitialState, loadGame, importGame, serialize, makeProcessor, nodeById, linkById,
} from './state.js';
import { step, simulate } from './sim.js';
import { Audio } from './audio.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { Interaction } from './interaction.js';
import { Autosave } from './autosave.js';
import {
  currentCost, canAfford, connectNodes,
  removeLink, dismantleNode, upgradeNode, addLinkAnchor, removeLinkAnchor,
  clearLinkAnchors, setLinkPriority, checkDirectives, deepScan, buyCoreUpgrade,
} from './actions.js';
import { CONFIG, fmt, fmtDuration, costText, offlineCap } from './gamedata.js';
import { nodeBounds, snapNode, GRID } from './layout.js';

const NARROW_WIDTH = 900;
const DIRECTIVE_POLL_MS = 600;

function init() {
  const loaded = loadGame();
  let state = loaded.state;
  if (loaded.fresh && window.innerWidth <= NARROW_WIDTH) {
    state = createInitialState(true);
  }
  let offlineGains = {};
  const offlineElapsed = loaded.elapsed;
  if (!loaded.fresh && offlineElapsed > 5) {
    const before = { ...state.bank };
    simulate(state, offlineElapsed, 1);
    for (const [tier, amount] of Object.entries(state.bank)) {
      const gain = amount - (before[tier] || 0);
      if (gain > 0.001) offlineGains[tier] = gain;
    }
  }
  state.savedAt = Date.now();

  const view = {
    selection: null,
    hoverNode: null,
    hoverPort: null,
    hoverAnchor: null,
    ghost: null,
    linkDraft: null,
    pendingBuild: null,
    dragCell: null,
    motion: state.motion,
    paused: false,
  };

  const canvas = document.getElementById('board');
  const audio = new Audio();
  audio.setMuted(state.muted);

  let ui = null;
  let interaction = null;
  let autosave = null;

  const app = {
    state,
    view,
    audio,
    renderer: null,
    ui: null,
    interaction: null,

    toast(options) {
      if (ui) ui.toast(options);
    },

    afterChange() {
      if (ui) ui.refresh(true);
      if (interaction && view.pendingBuild) interaction.updateGhost();
      app.saveSoon();
    },

    saveSoon() {
      if (autosave) autosave.schedule();
    },

    saveNow(force = false) {
      return autosave ? autosave.saveNow(force) : false;
    },

    replaceState(next) {
      replaceState(next);
    },

    isNarrow() {
      return window.innerWidth <= NARROW_WIDTH;
    },

    setPendingBuild(pending) {
      view.pendingBuild = pending;
      if (!pending) view.ghost = null;
      if (interaction) {
        interaction.updateGhost();
        interaction.updateCursor();
      }
      if (ui) ui.refresh();
    },

    armBuild(kind, tier) {
      const pending = view.pendingBuild;
      if (pending && pending.kind === kind && pending.tier === tier) {
        app.setPendingBuild(null);
        audio.click();
        return;
      }
      const cost = currentCost(state, kind, tier);
      if (!canAfford(state, cost)) {
        audio.deny();
        ui?.toast({ text: `Need ${costText(cost)}`, tone: 'bad', quiet: true });
        return;
      }
      view.selection = null;
      ui?.deselect();
      app.setPendingBuild({ kind, tier: kind === 'extractor' ? null : tier });
      ui?.closeMobilePanels();
      audio.click();
    },

    upgradeNode(id) {
      return upgradeNode(app, id);
    },

    dismantleNode(id) {
      return dismantleNode(app, id);
    },

    removeLink(id) {
      return removeLink(app, id);
    },

    addAnchorToSelection() {
      const selection = view.selection;
      if (selection?.kind !== 'link') return false;
      const link = linkById(state, selection.id);
      if (!link) return false;
      const from = nodeById(state, link.from);
      const to = nodeById(state, link.to);
      const source = from ? { x: from.x, y: from.y } : { x: 0, y: 0 };
      const target = to ? { x: to.x, y: to.y } : source;
      const point = snapNode((source.x + target.x) / 2, (source.y + target.y) / 2);
      const index = interaction ? interaction.anchorInsertionIndex(link, point.x, point.y) : -1;
      const anchor = addLinkAnchor(app, link.id, point.x, point.y, index);
      if (anchor) ui?.select({ kind: 'anchor', linkId: link.id, index: link.anchors.indexOf(anchor) });
      return Boolean(anchor);
    },

    removeAnchor(linkId, index) {
      const removed = removeLinkAnchor(app, linkId, index);
      if (removed && view.selection?.kind === 'anchor') ui?.select({ kind: 'link', id: linkId });
      return removed;
    },

    nudgeAnchor(linkId, index, dx, dy) {
      const link = linkById(state, linkId);
      const anchor = link?.anchors?.[index];
      if (!anchor) return false;
      anchor.x += dx * GRID.cell;
      anchor.y += dy * GRID.cell;
      app.afterChange();
      return true;
    },

    clearRoute(linkId) {
      return clearLinkAnchors(app, linkId);
    },

    setPriority(linkId, priority) {
      return setLinkPriority(app, linkId, priority);
    },

    buyCore(id) {
      return buyCoreUpgrade(app, id);
    },

    deepScan() {
      return deepScan(app);
    },

    togglePause() {
      view.paused = !view.paused;
      if (ui) ui.setPaused(view.paused);
      audio.click();
      app.saveSoon();
    },

    toggleMuted() {
      app.setMuted(!state.muted);
    },

    setMuted(muted) {
      state.muted = Boolean(muted);
      audio.setMuted(state.muted);
      if (ui) ui.setMuted(state.muted);
      app.saveSoon();
    },

    setMotion(enabled) {
      state.motion = Boolean(enabled);
      view.motion = state.motion;
      if (ui) ui.applySettings();
      app.saveSoon();
    },

    setGridSnap(enabled) {
      state.snapGrid = Boolean(enabled);
      if (interaction) interaction.updateGhost();
      if (ui) ui.applySettings();
      app.saveSoon();
    },

    toggleGridSnap() {
      app.setGridSnap(state.snapGrid === false);
      ui?.toast({
        text: state.snapGrid === false ? 'Grid snap off' : 'Grid snap on',
        tone: 'ok',
        quiet: true,
      });
    },

    zoomBy(factor) {
      app.renderer.zoomAt(window.innerWidth / 2, window.innerHeight / 2, factor);
      if (interaction) interaction.updateGhost();
      app.saveSoon();
    },

    fitView() {
      app.renderer.fit();
      if (interaction) interaction.updateGhost();
      app.saveSoon();
    },

    revealSelection(selection) {
      if (window.innerWidth <= NARROW_WIDTH || selection?.kind !== 'node') return;
      const node = nodeById(app.state, selection.id);
      if (!node) return;
      const bounds = nodeBounds(node);
      const a = app.renderer.worldToScreen(bounds.left, bounds.top);
      const b = app.renderer.worldToScreen(bounds.right, bounds.bottom);
      const safeLeft = 330;
      const safeRight = window.innerWidth - 342;
      const safeTop = 82;
      const safeBottom = window.innerHeight - 72;
      if (safeRight - safeLeft < 80) return;

      const cam = app.state.camera;
      let dx = 0;
      let dy = 0;
      if (b.x - a.x > safeRight - safeLeft) {
        dx = (a.x + b.x) / 2 - (safeLeft + safeRight) / 2;
      } else if (b.x > safeRight) {
        dx = b.x - safeRight;
      } else if (a.x < safeLeft) {
        dx = a.x - safeLeft;
      }
      if (b.y - a.y > safeBottom - safeTop) {
        dy = (a.y + b.y) / 2 - (safeTop + safeBottom) / 2;
      } else if (b.y > safeBottom) {
        dy = b.y - safeBottom;
      } else if (a.y < safeTop) {
        dy = a.y - safeTop;
      }
      if (dx || dy) {
        cam.x += dx / cam.zoom;
        cam.y += dy / cam.zoom;
        app.saveSoon();
      }
    },

    exportSave() {
      const text = serialize(state);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      anchor.href = url;
      anchor.download = `datamine-${stamp}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      ui?.toast({ text: 'Save exported', tone: 'ok', quiet: true });
      app.saveSoon();
    },

    importSave(text) {
      const next = importGame(text);
      replaceState(next);
      app.saveNow(true);
      ui?.toast({ text: 'Save loaded', tone: 'ok' });
    },

    resetGame() {
      const muted = state.muted;
      const motion = state.motion;
      const snapGrid = state.snapGrid;
      const next = createInitialState(window.innerWidth <= NARROW_WIDTH);
      next.muted = muted;
      next.motion = motion;
      next.snapGrid = snapGrid;
      view.paused = false;
      if (ui) {
        ui.lastUnlocked = next.unlockedTier;
        ui.lastCodexUnlocked = -1;
        ui.lastHint = '';
        ui.lastBuildKey = '';
        ui.setPaused(false);
      }
      replaceState(next);
      app.renderer.fit();
      app.saveNow(true);
      ui?.toast({ text: 'New instance online', tone: 'ok' });
    },
  };

  function replaceState(next) {
    state = next;
    app.state = next;
    view.selection = null;
    view.hoverNode = null;
    view.hoverPort = null;
    view.hoverAnchor = null;
    view.ghost = null;
    view.linkDraft = null;
    view.pendingBuild = null;
    view.dragCell = null;
    view.motion = next.motion;
    audio.setMuted(next.muted);
    if (ui) {
      ui.deselect();
      ui.lastUnlocked = next.unlockedTier;
      ui.lastCodexUnlocked = -1;
      ui.lastBuildKey = '';
      ui.setMuted(next.muted);
      ui.applySettings();
      ui.refresh(true);
    }
    app.renderer.born.clear();
    app.renderer.linkBorn.clear();
    if (interaction) interaction.clearTransient();
  }

  app.renderer = new Renderer(canvas, app);
  if (loaded.fresh) {
    app.renderer.fit();
  } else if (window.innerWidth <= NARROW_WIDTH) {
    const vault = state.nodes.find((node) => node.kind === 'vault');
    const p = vault ? app.renderer.worldToScreen(vault.x, vault.y) : null;
    const visible = p && p.x > 40 && p.x < window.innerWidth - 40 && p.y > 90 && p.y < window.innerHeight - 170;
    if (!visible) app.renderer.fit();
  }

  ui = new UI(app);
  app.ui = ui;
  interaction = new Interaction(canvas, app);
  app.interaction = interaction;
  autosave = new Autosave(app);
  app.autosave = autosave;
  autosave.seed(loaded.fresh ? 0 : state.savedAt);
  autosave.install();
  ui.setSaveState(loaded.fresh ? 'READY' : 'SAVED', !loaded.fresh);

  if (loaded.error) {
    ui.toast({
      text: 'Save could not be read. Started a new instance.',
      tone: 'bad',
      duration: 6000,
    });
  }

  const gainTotal = Object.values(offlineGains).reduce((sum, amount) => sum + amount, 0);
  if (!loaded.fresh && offlineElapsed >= 60 && (gainTotal > 0.5 || offlineElapsed >= 1800)) {
    setTimeout(() => ui.showOffline(offlineElapsed, offlineGains), 260);
  }

  const debug = {
    app,
    get state() { return app.state; },
    get view() { return app.view; },
    give(tier, amount = 1000) {
      const t = Math.max(0, Math.floor(tier));
      app.state.bank[t] = (app.state.bank[t] || 0) + amount;
      ui.refresh(true);
      app.saveSoon();
    },
    unlock(tier = app.state.unlockedTier + 1) {
      app.state.unlockedTier = Math.min(CONFIG.maxTier, Math.max(app.state.unlockedTier, Math.floor(tier)));
      ui.refresh(true);
      app.saveSoon();
    },
    spawn(kind, tier = 1, x = 0, y = 0) {
      let node;
      if (kind === 'extractor') {
        node = {
          id: app.state.nextId++,
          kind: 'extractor',
          x,
          y,
          level: 1,
          out: { tier: 0, amount: 0 },
          invested: {},
        };
      } else if (kind === 'processor') {
        node = makeProcessor(app.state.nextId++, tier, x, y);
      } else {
        return null;
      }
      app.state.nodes.push(node);
      app.afterChange();
      return node;
    },
    link(from, to) {
      return connectNodes(app, from, to);
    },
    step(seconds = 10) {
      simulate(app.state, seconds, 0.1);
      ui.refresh(true);
      app.saveSoon();
    },
    save: () => autosave.saveNow(true),
    toast(text, options = {}) {
      ui.toast({ text, ...options });
    },
    showOffline: (seconds, gains) => ui.showOffline(seconds, gains),
  };
  window.__datamine = debug;

  let last = performance.now();
  let acc = 0;
  let directiveTimer = 0;
  let hiddenAt = document.hidden ? Date.now() : 0;

  function frame(now) {
    const dt = Math.min(0.5, Math.max(0, (now - last) / 1000));
    last = now;

    if (!view.paused) {
      acc += dt;
      let iterations = 0;
      while (acc >= 0.1 && iterations < 3) {
        step(app.state, 0.1, { telemetry: true });
        acc -= 0.1;
        iterations++;
      }
      if (acc > 0.5) acc = 0.5;
    }

    if (now - directiveTimer > DIRECTIVE_POLL_MS) {
      directiveTimer = now;
      checkDirectives(app);
    }

    ui.tick(now);
    app.renderer.draw(now);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      autosave.saveNow();
      return;
    }
    const away = hiddenAt ? Math.min(offlineCap(app.state), (Date.now() - hiddenAt) / 1000) : 0;
    hiddenAt = 0;
    last = performance.now();
    acc = 0;
    if (view.paused || away < 5) return;

    const before = { ...app.state.bank };
    simulate(app.state, away, 1);
    let gained = 0;
    for (const [tier, amount] of Object.entries(app.state.bank)) {
      gained += Math.max(0, amount - (before[tier] || 0));
    }
    ui.refresh();
    autosave.saveNow();
    if (gained > 0.5) {
      ui.toast({
        text: `Recovered ${fmtDuration(away)} of output`,
        sub: `+${fmt(gained)} banked`,
        tone: 'ok',
        quiet: true,
        duration: 4200,
      });
    }
  });
}

init();
