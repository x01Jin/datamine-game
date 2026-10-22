import { Audio } from './audio.ts';
import {
  addLinkAnchor,
  buyCoreUpgrade,
  checkDirectives,
  clearLinkAnchors,
  currentCost,
  canAfford,
  deepScan,
  dismantleNode,
  removeLinkAnchor,
  rotateNode,
  removeLink,
  setLinkPriority,
  upgradeNode,
} from './game/actions.ts';
import { costText, offlineCap } from './game/gamedata.ts';
import { createInitialState, importGame, linkById, nodeById, saveGame, serialize } from './game/state.ts';
import { SAVE_KEY } from './game/types.ts';
import { GRID, snapNode } from './layout/geometry.ts';
import { Board } from './render/board.ts';
import type { App as GameApp, NodeKind, Selection, State, ToastOptions, View } from './game/types.ts';

export interface UIApi {
  refresh(force?: boolean): void;
  select(selection: Selection): void;
  deselect(): void;
  toast(options: ToastOptions): void;
  tick(now: number): void;
  setPaused(paused: boolean): void;
  setMuted(muted: boolean): void;
  setSaveState(label: string, ok?: boolean): void;
  applySettings(): void;
  openSidebar(tab: 'build' | 'codex' | 'ops'): void;
  closeMobilePanels(): void;
  showOffline(seconds: number, gains: Record<number, number>): void;
  closeModal(): void;
  closeSettings(): void;
  refs: { modalRoot: HTMLElement; settings: HTMLElement };
  lastUnlocked: number;
  lastCodexUnlocked: number;
  lastBuildKey: string;
  lastHint: string;
}

const DEBOUNCE_MS = 900;
const HEARTBEAT_MS = 8000;

export class App implements GameApp {
  state: State;
  view: View;
  audio = new Audio();
  board: Board;
  ui: UIApi | null = null;
  interaction: { clearTransient(): void } | null = null;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPersistedAt = 0;
  private conflict = false;

  constructor(board: Board, state: State, view: View) {
    this.board = board;
    this.state = state;
    this.view = view;
  }

  toast(options: ToastOptions): void {
    this.ui?.toast(options);
  }

  afterChange(): void {
    this.ui?.refresh();
    this.saveSoon();
  }

  saveSoon(): void {
    if (this.conflict) {
      this.ui?.setSaveState('Conflict');
      return;
    }
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.ui?.setSaveState('Unsaved');
    this.saveTimer = setTimeout(() => this.saveNow(), DEBOUNCE_MS);
  }

  saveNow(force = false): boolean {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (force !== true && this.conflict) {
      this.ui?.setSaveState('Conflict');
      return false;
    }
    if (force !== true && this.lastPersistedAt) {
      const remote = this.storedSaveTime();
      if (remote > this.lastPersistedAt) {
        this.flagConflict();
        return false;
      }
    }
    const writtenAt = saveGame(this.state);
    if (!writtenAt) {
      this.ui?.setSaveState('Save failed', false);
      return false;
    }
    this.lastPersistedAt = writtenAt;
    this.state.savedAt = writtenAt;
    this.conflict = false;
    this.ui?.setSaveState('Saved', true);
    return true;
  }

  private storedSaveTime(): number {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return 0;
      const savedAt = JSON.parse(raw)?.savedAt;
      return Number.isFinite(savedAt) ? savedAt : 0;
    } catch {
      return 0;
    }
  }

  private flagConflict(): void {
    this.conflict = true;
    this.ui?.setSaveState('Conflict');
    this.ui?.toast({
      text: 'Autosave paused: this instance changed in another tab.',
      sub: 'Reload to continue from the newer save.',
      tone: 'bad',
      duration: 7000,
    });
  }

  installAutosave(): void {
    setInterval(() => this.saveNow(), HEARTBEAT_MS);
    window.addEventListener('beforeunload', () => this.saveNow());
    window.addEventListener('pagehide', () => this.saveNow());
    window.addEventListener('storage', (event) => {
      if (event.key !== SAVE_KEY || !event.newValue) return;
      try {
        const savedAt = JSON.parse(event.newValue)?.savedAt;
        if (Number.isFinite(savedAt) && savedAt > this.lastPersistedAt) this.flagConflict();
      } catch {
        return;
      }
    });
  }

  seedAutosave(savedAt: number): void {
    this.lastPersistedAt = Number(savedAt) || 0;
  }

  isNarrow(): boolean {
    return window.innerWidth <= 900;
  }

  setPendingBuild(pending: { kind: NodeKind; tier: number | null } | null): void {
    this.view.pendingBuild = pending;
    if (!pending) this.view.ghost = null;
    this.interaction?.clearTransient();
    this.ui?.refresh();
  }

  armBuild(kind: NodeKind, tier: number | null): void {
    const pending = this.view.pendingBuild;
    if (pending && pending.kind === kind && pending.tier === tier) {
      this.setPendingBuild(null);
      this.audio.click();
      return;
    }
    const cost = currentCost(this.state, kind, tier);
    if (!canAfford(this.state, cost)) {
      this.audio.deny();
      this.ui?.toast({ text: `Need ${costText(cost)}`, tone: 'bad', quiet: true });
      return;
    }
    this.view.selection = null;
    this.ui?.deselect();
    this.setPendingBuild({ kind, tier: kind === 'extractor' ? null : tier });
    this.audio.click();
  }

  upgradeNode(id: number): boolean {
    return upgradeNode(this, id);
  }

  dismantleNode(id: number): boolean {
    return dismantleNode(this, id);
  }

  rotateNode(id: number): boolean {
    return rotateNode(this, id);
  }

  removeLink(id: number): boolean {
    return removeLink(this, id);
  }

  addAnchorToSelection(): boolean {
    const selection = this.view.selection;
    if (selection?.kind !== 'link') return false;
    const link = linkById(this.state, selection.id);
    if (!link) return false;
    const from = nodeById(this.state, link.from);
    const to = nodeById(this.state, link.to);
    const source = from ? { x: from.x, y: from.y } : { x: 0, y: 0 };
    const target = to ? { x: to.x, y: to.y } : source;
    const point = snapNode((source.x + target.x) / 2, (source.y + target.y) / 2);
    const anchor = addLinkAnchor(this, link.id, point.x, point.y);
    if (anchor) this.ui?.select({ kind: 'anchor', linkId: link.id, index: link.anchors.indexOf(anchor) });
    return Boolean(anchor);
  }

  removeAnchor(linkId: number, index: number): boolean {
    const removed = removeLinkAnchor(this, linkId, index);
    if (removed && this.view.selection?.kind === 'anchor') this.ui?.select({ kind: 'link', id: linkId });
    return removed;
  }

  nudgeAnchor(linkId: number, index: number, dx: number, dy: number): boolean {
    const link = linkById(this.state, linkId);
    const anchor = link?.anchors?.[index];
    if (!anchor) return false;
    anchor.x += dx * GRID.cell;
    anchor.y += dy * GRID.cell;
    this.afterChange();
    return true;
  }

  clearRoute(linkId: number): boolean {
    return clearLinkAnchors(this, linkId);
  }

  setPriority(linkId: number, priority: number): boolean {
    return setLinkPriority(this, linkId, priority);
  }

  buyCore(id: string): boolean {
    return buyCoreUpgrade(this, id);
  }

  deepScan(): boolean {
    return deepScan(this);
  }

  togglePause(): void {
    this.view.paused = !this.view.paused;
    this.ui?.setPaused(this.view.paused);
    this.audio.click();
    this.saveSoon();
  }

  toggleMuted(): void {
    this.setMuted(!this.state.muted);
  }

  setMuted(muted: boolean): void {
    this.state.muted = muted;
    this.audio.setMuted(muted);
    this.ui?.setMuted(muted);
    this.saveSoon();
  }

  setMotion(enabled: boolean): void {
    this.state.motion = enabled;
    this.view.motion = enabled;
    this.ui?.applySettings();
    this.saveSoon();
  }

  setGridSnap(enabled: boolean): void {
    this.state.snapGrid = enabled;
    this.ui?.applySettings();
    this.saveSoon();
  }

  toggleGridSnap(): void {
    this.setGridSnap(this.state.snapGrid === false);
    this.ui?.toast({
      text: this.state.snapGrid === false ? 'Grid snap off' : 'Grid snap on',
      tone: 'ok',
      quiet: true,
    });
  }

  zoomBy(factor: number): void {
    this.board.zoomAt(window.innerWidth / 2, window.innerHeight / 2, factor);
    this.saveSoon();
  }

  fitView(): void {
    this.board.fit();
    this.saveSoon();
  }

  focusNode(id: number): void {
    const node = nodeById(this.state, id);
    if (!node) return;
    this.board.focusNode(node);
    this.saveSoon();
  }

  exportSave(): void {
    const text = serialize(this.state);
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
    this.ui?.toast({ text: 'Save exported', tone: 'ok', quiet: true });
    this.saveSoon();
  }

  importSave(text: string): void {
    const next = importGame(text);
    this.replaceState(next);
    this.saveNow(true);
    this.ui?.toast({ text: 'Save loaded', tone: 'ok' });
  }

  resetGame(): void {
    const muted = this.state.muted;
    const motion = this.state.motion;
    const snapGrid = this.state.snapGrid;
    const next = createInitialState(this.isNarrow());
    next.muted = muted;
    next.motion = motion;
    next.snapGrid = snapGrid;
    this.view.paused = false;
    this.replaceState(next);
    this.board.fit();
    this.saveNow(true);
    this.ui?.toast({ text: 'New instance online', tone: 'ok' });
  }

  replaceState(next: State): void {
    this.state = next;
    this.view.selection = null;
    this.view.hoverNode = null;
    this.view.hoverPort = null;
    this.view.hoverAnchor = null;
    this.view.ghost = null;
    this.view.linkDraft = null;
    this.view.pendingBuild = null;
    this.view.dragCell = null;
    this.view.motion = next.motion;
    this.audio.setMuted(next.muted);
    this.board.setState(next);
    if (this.ui) {
      this.ui.deselect();
      this.ui.lastUnlocked = next.unlockedTier;
      this.ui.lastCodexUnlocked = -1;
      this.ui.lastBuildKey = '';
      this.ui.setMuted(next.muted);
      this.ui.applySettings();
      this.ui.refresh(true);
    }
    this.interaction?.clearTransient();
  }

  checkDirectives(): void {
    checkDirectives(this);
  }

  offlineCap(): number {
    return offlineCap(this.state);
  }
}
