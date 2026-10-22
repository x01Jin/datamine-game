import {
  CONFIG,
  bufferCap,
  dataInfo,
  deepScanReward,
  fmt,
  fmtDuration,
  fmtRate,
  recipeFor,
  tierLabel,
} from '../game/gamedata.ts';
import { bankOf, canAfford, currentCost } from '../game/actions.ts';
import { linkById, nodeById } from '../game/state.ts';
import { nodeStatus } from '../game/sim.ts';
import { byId, el, setText, sortedBy, statusLabel, tierHex } from './dom.ts';
import { buildInspector, holdingsHtml, vaultLedger } from './inspector.ts';
import type { Live } from './inspector.ts';
import {
  bankTiers,
  renderBank,
  renderBuild,
  renderCodex,
  renderNextLock,
  renderOps,
  updateBankWidths,
  updateHint,
  updateOps,
} from './panels.ts';
import type { BankLane, BuildCard, OpsRefs } from './panels.ts';
import type { App, UIApi } from '../app.ts';
import type { Selection, ToastOptions } from '../game/types.ts';

export type TabName = 'build' | 'codex' | 'ops';

export interface UiRefs {
  bank: HTMLElement;
  bankTotal: HTMLElement;
  buildList: HTMLElement;
  codexList: HTMLElement;
  buildView: HTMLElement;
  codexView: HTMLElement;
  opsView: HTMLElement;
  buildCount: HTMLElement;
  nextLock: HTMLElement;
  inspector: HTMLElement;
  hint: HTMLElement;
  hintText: HTMLElement;
  hintClose: HTMLButtonElement;
  toasts: HTMLElement;
  nodeCount: HTMLElement;
  linkCount: HTMLElement;
  tierReadout: HTMLElement;
  statusMid: HTMLElement;
  saveState: HTMLElement;
  btnPause: HTMLButtonElement;
  btnSound: HTMLButtonElement;
  btnSettings: HTMLButtonElement;
  netStatus: HTMLElement;
  netLabel: HTMLElement;
  settings: HTMLElement;
  settingsClose: HTMLButtonElement;
  settingSound: HTMLInputElement;
  settingMotion: HTMLInputElement;
  settingSnap: HTMLInputElement;
  btnExport: HTMLButtonElement;
  btnImport: HTMLButtonElement;
  btnReset: HTMLButtonElement;
  btnHints: HTMLButtonElement;
  modalRoot: HTMLElement;
  zoomIn: HTMLButtonElement;
  zoomOut: HTMLButtonElement;
  zoomFit: HTMLButtonElement;
  zoomReadout: HTMLElement;
  sidebar: HTMLElement;
  sidebarClose: HTMLButtonElement;
  mobileBuild: HTMLButtonElement;
  pauseBanner: HTMLElement;
  directiveList: HTMLElement;
  coreList: HTMLElement;
  coreBalance: HTMLElement;
  deepScan: HTMLButtonElement;
  deepScanHint: HTMLElement;
  archiveNote: HTMLElement;
}

interface ModalAction {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick?: () => void;
}

interface ModalOptions {
  kicker?: string;
  title: string;
  body: Node | string;
  actions?: ModalAction[];
}

const NARROW = 900;

function cacheRefs(): UiRefs {
  return {
    bank: byId('bank'),
    bankTotal: byId('bank-total'),
    buildList: byId('build-list'),
    codexList: byId('codex-list'),
    buildView: byId('build-view'),
    codexView: byId('codex-view'),
    opsView: byId('ops-view'),
    buildCount: byId('build-count'),
    nextLock: byId('next-lock'),
    inspector: byId('inspector'),
    hint: byId('hint'),
    hintText: byId('hint-text'),
    hintClose: byId<HTMLButtonElement>('hint-close'),
    toasts: byId('toasts'),
    nodeCount: byId('node-count'),
    linkCount: byId('link-count'),
    tierReadout: byId('tier-readout'),
    statusMid: byId('status-mid'),
    saveState: byId('save-state'),
    btnPause: byId<HTMLButtonElement>('btn-pause'),
    btnSound: byId<HTMLButtonElement>('btn-sound'),
    btnSettings: byId<HTMLButtonElement>('btn-settings'),
    netStatus: byId('net-status'),
    netLabel: byId('net-label'),
    settings: byId('settings'),
    settingsClose: byId<HTMLButtonElement>('settings-close'),
    settingSound: byId<HTMLInputElement>('setting-sound'),
    settingMotion: byId<HTMLInputElement>('setting-motion'),
    settingSnap: byId<HTMLInputElement>('setting-snap'),
    btnExport: byId<HTMLButtonElement>('btn-export'),
    btnImport: byId<HTMLButtonElement>('btn-import'),
    btnReset: byId<HTMLButtonElement>('btn-reset'),
    btnHints: byId<HTMLButtonElement>('btn-hints'),
    modalRoot: byId('modal-root'),
    zoomIn: byId<HTMLButtonElement>('zoom-in'),
    zoomOut: byId<HTMLButtonElement>('zoom-out'),
    zoomFit: byId<HTMLButtonElement>('zoom-fit'),
    zoomReadout: byId('zoom-readout'),
    sidebar: byId('sidebar'),
    sidebarClose: byId<HTMLButtonElement>('sidebar-close'),
    mobileBuild: byId<HTMLButtonElement>('mobile-build'),
    pauseBanner: byId('pause-banner'),
    directiveList: byId('directive-list'),
    coreList: byId('core-list'),
    coreBalance: byId('core-balance'),
    deepScan: byId<HTMLButtonElement>('deep-scan'),
    deepScanHint: byId('deep-scan-hint'),
    archiveNote: byId('archive-note'),
  };
}

export class UI implements UIApi {
  app: App;
  refs: UiRefs;
  lastUnlocked: number;
  lastCodexUnlocked: number;
  lastBuildKey: string;
  lastHint: string;

  tab: TabName = 'build';
  live: Live = { bars: {} };
  buildCards = new Map<string, BuildCard>();
  bankAmounts = new Map<number, HTMLElement>();
  bankLanes = new Map<number, BankLane>();
  bankTotal: HTMLElement | null = null;
  codexAmounts = new Map<number, HTMLElement>();
  ops: OpsRefs | null = null;
  bankKeyCache = '';

  private tabs: HTMLButtonElement[] = [];
  private lastSelectionKey = '';
  private lastLive = 0;
  private lastStatus = 0;
  private lastSave = '';
  private lastFocus: HTMLElement | null = null;

  constructor(app: App) {
    this.app = app;
    this.refs = cacheRefs();
    this.lastUnlocked = app.state.unlockedTier;
    this.lastCodexUnlocked = -1;
    this.lastBuildKey = '';
    this.lastHint = '';
    this.tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab'));
    this.bind();
    this.switchTab('build');
    this.refresh(true);
    this.applySettings();
    this.setPaused(app.view.paused);
    this.setMuted(app.state.muted);
  }

  private bind(): void {
    const r = this.refs;

    for (const tab of this.tabs) {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab as TabName));
      tab.addEventListener('keydown', (event) => this.onTabKey(event, tab));
    }

    r.buildList.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const card = target?.closest<HTMLElement>('.build-card');
      if (!card || card.classList.contains('is-locked')) return;
      const kind = card.dataset.kind as 'extractor' | 'processor';
      const tier = card.dataset.tier ? Number(card.dataset.tier) : null;
      this.app.armBuild(kind, tier);
    });

    r.inspector.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLElement>('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const selection = this.app.view.selection;
      if (action === 'close') this.deselect();
      if (action === 'upgrade' && selection?.kind === 'node') this.app.upgradeNode(selection.id);
      if (action === 'rotate' && selection?.kind === 'node') this.app.rotateNode(selection.id);
      if (action === 'dismantle' && selection?.kind === 'node') this.app.dismantleNode(selection.id);
      if (action === 'remove-link' && selection?.kind === 'link') this.app.removeLink(selection.id);
      if (action === 'add-anchor' && selection?.kind === 'link') this.app.addAnchorToSelection();
      if (action === 'clear-route' && selection?.kind === 'link') this.app.clearRoute(selection.id);
      if (action === 'remove-anchor' && selection?.kind === 'anchor') {
        this.app.removeAnchor(selection.linkId, selection.index);
      }
      if (action === 'nudge-anchor' && selection?.kind === 'anchor') {
        this.app.nudgeAnchor(
          selection.linkId,
          selection.index,
          Number((button as HTMLElement).dataset.dx),
          Number((button as HTMLElement).dataset.dy),
        );
      }
      if (action === 'set-priority' && selection?.kind === 'link') {
        this.app.setPriority(selection.id, Number((button as HTMLElement).dataset.priority));
      }
    });

    r.opsView.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const core = target?.closest('[data-core]');
      if (core) {
        this.app.buyCore((core as HTMLElement).dataset.core as string);
        return;
      }
      const scan = target?.closest('[data-action="deep-scan"]');
      if (scan) this.confirmDeepScan();
    });

    r.hintClose.addEventListener('click', () => {
      this.app.state.hintDismissed = true;
      this.app.saveSoon();
      updateHint(this);
    });

    r.btnHints.addEventListener('click', () => {
      this.app.state.hintDismissed = false;
      this.app.saveSoon();
      updateHint(this);
      this.closeSettings();
      this.toast({ text: 'Guidance restored', tone: 'ok', quiet: true });
    });

    r.btnPause.addEventListener('click', () => this.app.togglePause());
    r.btnSound.addEventListener('click', () => this.app.toggleMuted());
    r.btnSettings.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleSettings();
    });
    r.settingsClose.addEventListener('click', () => this.closeSettings());
    r.settingSound.addEventListener('change', () => this.app.setMuted(!r.settingSound.checked));
    r.settingMotion.addEventListener('change', () => this.app.setMotion(r.settingMotion.checked));
    r.settingSnap.addEventListener('change', () => this.app.setGridSnap(r.settingSnap.checked));
    r.btnExport.addEventListener('click', () => this.app.exportSave());
    r.btnImport.addEventListener('click', () => this.pickImport());
    r.btnReset.addEventListener('click', () => this.confirmReset());

    r.zoomIn.addEventListener('click', () => this.app.zoomBy(1.2));
    r.zoomOut.addEventListener('click', () => this.app.zoomBy(1 / 1.2));
    r.zoomFit.addEventListener('click', () => this.app.fitView());

    r.mobileBuild.addEventListener('click', () => this.openSidebar('build'));
    r.sidebarClose.addEventListener('click', () => this.closeSidebar());

    r.bank.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const lane = target?.closest('.bank-lane');
      if (!lane) return;
      const tier = Number((lane as HTMLElement).dataset.tier);
      this.openSidebar('codex');
      requestAnimationFrame(() => {
        const row = document.getElementById(`codex-tier-${tier}`);
        if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    });

    document.addEventListener('pointerdown', (event) => {
      if (r.settings.hidden) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (r.settings.contains(target) || r.btnSettings.contains(target)) return;
      this.closeSettings();
    });

    window.addEventListener('resize', () => {
      if (!this.isMobile()) this.closeSidebar();
    });
  }

  private onTabKey(event: KeyboardEvent, tab: HTMLButtonElement): void {
    const order = this.tabs.map((entry) => entry.dataset.tab ?? 'build');
    const index = order.indexOf(tab.dataset.tab ?? 'build');
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % this.tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + this.tabs.length) % this.tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = this.tabs.length - 1;
    else return;
    event.preventDefault();
    const target = this.tabs[next];
    this.switchTab(target.dataset.tab as TabName);
    target.focus();
  }

  switchTab(name: TabName): void {
    this.tab = name;
    const build = name === 'build';
    const ops = name === 'ops';
    this.refs.buildView.hidden = !build;
    this.refs.opsView.hidden = !ops;
    this.refs.codexView.hidden = build || ops;
    for (const tab of this.tabs) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    if (ops) renderOps(this);
    if (!build && !ops) {
      requestAnimationFrame(() => {
        this.refs.codexView.scrollTop = this.refs.codexView.scrollHeight;
      });
    }
  }

  isMobile(): boolean {
    return window.innerWidth <= NARROW;
  }

  openSidebar(tab: TabName = this.tab): void {
    this.switchTab(tab);
    if (this.isMobile()) {
      this.refs.sidebar.classList.add('is-open');
      this.refs.mobileBuild.setAttribute('aria-expanded', 'true');
      this.deselect();
    }
  }

  closeSidebar(): void {
    this.refs.sidebar.classList.remove('is-open');
    this.refs.mobileBuild.setAttribute('aria-expanded', 'false');
  }

  closeMobilePanels(): void {
    if (this.isMobile()) this.closeSidebar();
  }

  refresh(force = false): void {
    const state = this.app.state;
    const view = this.app.view;

    renderBank(this, force);

    const buildKey = `${state.nodes.length}:${state.links.length}:${state.unlockedTier}:${view.pendingBuild?.kind ?? ''}:${view.pendingBuild?.tier ?? ''}`;
    if (force || buildKey !== this.lastBuildKey) {
      renderBuild(this);
      this.lastBuildKey = buildKey;
    }

    if (state.unlockedTier !== this.lastCodexUnlocked || !this.refs.codexList.childElementCount) {
      renderCodex(this, state.unlockedTier !== this.lastCodexUnlocked);
      this.lastCodexUnlocked = state.unlockedTier;
    }

    setText(this.refs.nodeCount, `${state.nodes.length} nodes`);
    setText(this.refs.linkCount, `${state.links.length} links`);
    setText(this.refs.tierReadout, tierLabel(Math.max(0, state.stats.deepestTier)));
    setText(this.refs.buildCount, `${state.unlockedTier} tier${state.unlockedTier === 1 ? '' : 's'}`);
    renderNextLock(this);
    updateHint(this);
    this.syncSelection(force);
    this.updateLive();
    this.applySettings();
    if (this.tab === 'ops') updateOps(this);
  }

  tick(now: number): void {
    const state = this.app.state;

    if (state.unlockedTier > this.lastUnlocked) {
      const tier = state.unlockedTier;
      this.lastUnlocked = tier;
      const info = dataInfo(tier);
      this.app.audio.discover();
      this.toast({
        text: `New signal: ${info.name}`,
        sub: `${tierLabel(tier)} forge available`,
        tone: 'discover',
        tier,
        duration: 3800,
      });
      this.app.saveSoon();
      this.refresh(true);
    }

    if (now - this.lastLive < 90) return;
    this.lastLive = now;

    if (bankTiers(this).join(',') !== this.bankKeyCache) renderBank(this, false);
    updateBankWidths(this, false);
    setText(this.refs.zoomReadout, `${Math.round(state.camera.zoom * 100)}%`);

    for (const [tier, node] of this.bankAmounts) {
      const amount = bankOf(state, tier);
      setText(node, fmt(amount));
      node.parentElement?.classList.toggle('is-empty', amount < 0.005);
    }

    for (const [tier, node] of this.codexAmounts) {
      setText(node, fmt(bankOf(state, tier)));
    }

    setText(this.bankTotal, fmt(state.stats.totalBanked));

    for (const card of this.buildCards.values()) {
      const cost = currentCost(state, card.kind, card.tier);
      const poor = !canAfford(state, cost);
      const pending = this.app.view.pendingBuild;
      const armed = pending?.kind === card.kind && (card.kind === 'extractor' || pending.tier === card.tier);
      if (card.poor !== poor) {
        card.poor = poor;
        card.el.classList.toggle('is-poor', poor);
      }
      if (card.armed !== armed) {
        card.armed = armed;
        card.el.classList.toggle('is-armed', armed);
      }
    }

    updateOps(this);
    this.updateLive();

    if (now - this.lastStatus > 500) {
      this.lastStatus = now;
      setText(
        this.refs.statusMid,
        `DEEPEST ${tierLabel(state.stats.deepestTier)}  ·  MACHINES ${state.nodes.length}  ·  LINKS ${state.links.length}` +
          (state.cores > 0 ? `  ·  CORES ${state.cores}` : ''),
      );
      updateHint(this);
    }
  }

  private syncSelection(force = false): void {
    const selection = this.app.view.selection;
    if (!selection) {
      this.closeInspector();
      return;
    }
    const state = this.app.state;
    let key: string;
    if (selection.kind === 'node') {
      const node = nodeById(state, selection.id);
      if (!node) {
        this.app.view.selection = null;
        this.closeInspector();
        return;
      }
      const wiring = state.links
        .filter((link) => link.from === node.id || link.to === node.id)
        .map((link) => `${link.from}>${link.to}`)
        .join(',');
      key = `node:${node.id}:${node.level}:${node.kind === 'processor' ? (node.rot ?? 0) : 0}:${wiring}:${state.unlockedTier}`;
    } else if (selection.kind === 'anchor') {
      const link = linkById(state, selection.linkId);
      if (!link || !link.anchors?.[selection.index]) {
        this.app.view.selection = null;
        this.closeInspector();
        return;
      }
      key = `anchor:${link.id}:${selection.index}:${link.anchors.length}:${link.priority}`;
    } else {
      const link = linkById(state, selection.id);
      if (!link) {
        this.app.view.selection = null;
        this.closeInspector();
        return;
      }
      key = `link:${link.id}:${link.from}>${link.to}:${link.tier}:${link.priority}:${link.anchors.length}:${state.unlockedTier}`;
    }
    if (force || key !== this.lastSelectionKey) {
      this.lastSelectionKey = key;
      buildInspector(this, selection);
    }
    this.refs.inspector.classList.add('is-open');
    this.refs.inspector.inert = false;
    document.body.classList.add('has-inspector');
  }

  private closeInspector(): void {
    this.refs.inspector.classList.remove('is-open');
    this.refs.inspector.inert = true;
    document.body.classList.remove('has-inspector');
    this.lastSelectionKey = '';
  }

  select(selection: Selection): void {
    this.app.view.selection = selection;
    this.closeMobilePanels();
    this.syncSelection(true);
    this.updateLive();
  }

  deselect(): void {
    this.app.view.selection = null;
    this.closeInspector();
    this.app.view.hoverPort = null;
  }

  private updateLive(): void {
    const selection = this.app.view.selection;
    if (!selection || !this.refs.inspector.classList.contains('is-open')) return;
    const state = this.app.state;
    if (selection.kind === 'anchor') return;
    const live = this.live;

    if (selection.kind === 'node') {
      const node = nodeById(state, selection.id);
      if (!node) return;

      if (node.kind === 'vault') {
        const ledger = vaultLedger(state);
        let incoming = 0;
        let wires = 0;
        for (const link of state.links) {
          if (link.to === node.id) {
            wires++;
            incoming += (link as { _flow?: number })._flow || 0;
          }
        }
        setText(live.types, String(ledger.types));
        setText(live.units, fmt(ledger.units));
        setText(live.incoming, fmtRate(incoming));
        const holdingKey = ledger.entries.map((entry) => entry.tier).join(',');
        if (live.holdings) {
          if (holdingKey !== live.holdingKey) {
            live.holdingKey = holdingKey;
            live.holdings.innerHTML = holdingsHtml(ledger.entries.slice(0, 6));
          } else {
            for (const entry of ledger.entries) {
              const cell = live.holdings.querySelector(`[data-live="holding-${entry.tier}"]`);
              if (cell) cell.textContent = fmt(entry.amount);
            }
          }
        }
        if (live.statusRow) {
          const receiving = incoming > 0.002;
          live.statusRow.className = `status-row is-${receiving ? 'receiving' : 'idle'}`;
          setText(live.statusText, receiving ? 'RECEIVING' : 'IDLE');
          const util = live.statusRow.querySelector('.status-util');
          if (util) util.textContent = `${wires} wire${wires === 1 ? '' : 's'}`;
        }
        return;
      }

      const status = nodeStatus(state, node);
      const util = (node as { _util?: number })._util || 0;
      if (live.statusRow) {
        live.statusRow.className = `status-row is-${status}`;
        setText(live.statusText, statusLabel(status));
        setText(live.utilText, `${Math.round(util * 100)}%`);
        if (live.utilBar) live.utilBar.style.width = `${Math.min(100, Math.max(0, util * 100))}%`;
      }
      const cap = bufferCap(state, node);
      if (node.kind === 'processor') {
        const recipe = recipeFor(node.tier);
        for (const input of recipe?.inputs ?? []) {
          const row = live.bars[`in-${input.tier}`];
          if (!row) continue;
          const amount = node.inputs[input.tier] || 0;
          row.fill.style.width = `${cap > 0 ? Math.min(100, (amount / cap) * 100) : 0}%`;
          row.val.textContent = `${fmt(amount)} / ${fmt(cap)}`;
        }
      }
      const outBar = live.bars.out;
      if (outBar) {
        const amount = node.kind === 'processor' || node.kind === 'extractor' ? node.out.amount : 0;
        outBar.fill.style.width = `${cap > 0 ? Math.min(100, (amount / cap) * 100) : 0}%`;
        outBar.val.textContent = `${fmt(amount)} / ${fmt(cap)}`;
      }
      setText(live.flowOut, fmtRate((node as { _flowOut?: number })._flowOut || 0));
      if (live.upgradeBtn && live.upgradeCost) {
        live.upgradeBtn.disabled = !canAfford(state, live.upgradeCost);
      }
      return;
    }

    const link = linkById(state, selection.id);
    if (!link) return;
    setText(live.linkFlow, fmtRate((link as { _flow?: number })._flow || 0));
  }

  setPaused(paused: boolean): void {
    this.refs.netStatus.classList.toggle('is-paused', paused);
    setText(this.refs.netLabel, paused ? 'Paused' : 'Online');
    this.refs.btnPause.classList.toggle('is-active', paused);
    const use = this.refs.btnPause.querySelector('use');
    if (use) use.setAttribute('href', paused ? '#i-play' : '#i-pause');
    this.refs.btnPause.title = paused ? 'Resume (P)' : 'Pause (P)';
    this.refs.btnPause.setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation');
    this.refs.pauseBanner.hidden = !paused;
    document.body.classList.toggle('is-paused', paused);
  }

  setMuted(muted: boolean): void {
    this.refs.settingSound.checked = !muted;
    this.refs.btnSound.classList.toggle('is-active', muted);
    const use = this.refs.btnSound.querySelector('use');
    if (use) use.setAttribute('href', muted ? '#i-mute' : '#i-sound');
    this.refs.btnSound.title = muted ? 'Sound off (M)' : 'Sound on (M)';
    this.refs.btnSound.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
  }

  setSaveState(label: string, ok = false): void {
    if (label === this.lastSave && !ok) return;
    this.lastSave = label;
    setText(this.refs.saveState, label);
    this.refs.saveState.classList.toggle('is-saved', ok);
  }

  applySettings(): void {
    this.refs.settingSound.checked = !this.app.state.muted;
    this.refs.settingMotion.checked = this.app.state.motion !== false;
    this.refs.settingSnap.checked = this.app.state.snapGrid !== false;
  }

  toggleSettings(): void {
    const open = this.refs.settings.hidden === true;
    this.refs.settings.hidden = !open;
    this.refs.btnSettings.classList.toggle('is-active', open);
  }

  closeSettings(): void {
    this.refs.settings.hidden = true;
    this.refs.btnSettings.classList.remove('is-active');
  }

  toast(options: ToastOptions): void {
    const { text, sub = '', tone = '', tier = null, quiet = false, duration = 3000 } = options;
    const node = el('div', `toast${tone ? ` is-${tone}` : ''}${quiet ? ' is-quiet' : ''}`);
    if (tier !== null) node.style.setProperty('--tier', tierHex(tier));
    node.append(el('span', 'toast-mark'));
    const body = el('div', 'toast-body');
    body.append(el('div', 'toast-text', text));
    if (sub) body.append(el('div', 'toast-sub', sub));
    node.append(body);
    this.refs.toasts.append(node);
    while (this.refs.toasts.children.length > 4) this.refs.toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      node.classList.add('is-out');
      window.setTimeout(() => node.remove(), 220);
    }, duration);
  }

  modal(options: ModalOptions): void {
    this.closeModal();
    const backdrop = el('div', 'modal-backdrop');
    const box = el('div', 'modal');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', options.title);

    const head = el('div', 'modal-head');
    if (options.kicker) head.append(el('div', 'modal-kicker', options.kicker));
    head.append(el('h2', 'modal-title', options.title));

    const body = el('div', 'modal-body');
    if (typeof options.body === 'string') body.innerHTML = options.body;
    else body.append(options.body);

    const actions = el('div', 'modal-actions');
    for (const action of options.actions ?? []) {
      const button = el(
        'button',
        `btn${action.primary ? ' btn-primary' : ''}${action.danger ? ' btn-danger' : ''}`,
        action.label,
      );
      button.type = 'button';
      button.addEventListener('click', () => {
        this.closeModal();
        action.onClick?.();
      });
      actions.append(button);
    }

    box.append(head, body, actions);
    backdrop.append(box);
    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) this.closeModal();
    });
    box.addEventListener('keydown', (event) => this.trapFocus(event, box));

    this.lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.refs.modalRoot.append(backdrop);
    const first = actions.querySelector('button');
    if (first instanceof HTMLElement) first.focus();
  }

  private trapFocus(event: KeyboardEvent, box: HTMLElement): void {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      box.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((node) => !(node as HTMLButtonElement).disabled && node.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  closeModal(): void {
    if (!this.refs.modalRoot.childElementCount) {
      this.refs.modalRoot.textContent = '';
      return;
    }
    this.refs.modalRoot.textContent = '';
    if (this.lastFocus?.isConnected) this.lastFocus.focus();
    this.lastFocus = null;
  }

  showOffline(seconds: number, gains: Record<number, number>): void {
    const body = el('div', 'offline-body');
    const lead = el('p', 'offline-lead');
    lead.append('The refinery kept running for ');
    lead.append(el('b', 'lead-value', fmtDuration(seconds)));
    lead.append('.');
    body.append(lead);

    const rows = sortedBy(
      Object.entries(gains).filter(([, amount]) => amount > 0.005),
      (a, b) => Number(b[1]) - Number(a[1]),
    ).slice(0, 6);

    if (rows.length) {
      const list = el('div', 'gains');
      for (const [tier, amount] of rows) {
        const info = dataInfo(Number(tier));
        const row = el('div', 'gain-row');
        row.style.setProperty('--tier', tierHex(Number(tier)));
        row.append(el('span', 'gain-name', info.name));
        row.append(el('b', 'gain-amount', `+${fmt(amount)}`));
        list.append(row);
      }
      body.append(list);
    } else {
      body.append(el('p', 'offline-lead', 'Nothing reached the vault. Check the wiring and try again.'));
    }

    const next = this.nextAffordable();
    if (next) body.append(el('p', 'modal-note', next));

    this.modal({
      kicker: 'Session recovery',
      title: 'While you were away',
      body,
      actions: [{ label: 'Resume', primary: true }],
    });
  }

  private nextAffordable(): string {
    const state = this.app.state;
    const parts: string[] = [];
    for (let tier = 1; tier <= state.unlockedTier; tier++) {
      if (canAfford(state, currentCost(state, 'processor', tier))) {
        parts.push(`a ${dataInfo(tier).name} forge is within reach`);
        break;
      }
    }
    if (!parts.length && canAfford(state, currentCost(state, 'extractor'))) {
      parts.push('another extractor is within reach');
    }
    if (!parts.length) return '';
    return `You can afford ${parts[0]}.`;
  }

  private confirmDeepScan(): void {
    const state = this.app.state;
    if (state.stats.deepestTier < CONFIG.deepScanTier) {
      this.toast({
        text: `Deep scan unlocks at tier ${CONFIG.deepScanTier}.`,
        tone: 'bad',
        quiet: true,
      });
      return;
    }
    const gain = deepScanReward(state);
    const body = el('div', 'offline-body');
    body.append(
      el(
        'p',
        'offline-lead',
        'The refinery is torn down and rebuilt from bare rock. Machines, wires and banked signals are lost.',
      ),
    );
    const note = el('p', 'modal-note');
    note.append('Cores, core ranks and archive records carry over. You gain ');
    note.append(el('b', 'lead-value', `${gain} core${gain === 1 ? '' : 's'}`));
    note.append('.');
    body.append(note);
    this.modal({
      kicker: 'Destructive action',
      title: 'Run a deep scan?',
      body,
      actions: [
        { label: 'Cancel' },
        { label: 'Deep scan', danger: true, onClick: () => this.app.deepScan() },
      ],
    });
  }

  private confirmReset(): void {
    this.closeSettings();
    const body = el('div', 'offline-body');
    body.append(
      el(
        'p',
        'offline-lead',
        'Every machine, wire, and banked signal in this browser will be deleted. This cannot be undone.',
      ),
    );
    this.modal({
      kicker: 'Destructive action',
      title: 'Wipe this instance?',
      body,
      actions: [{ label: 'Cancel' }, { label: 'Wipe', danger: true, onClick: () => this.app.resetGame() }],
    });
  }

  private pickImport(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.append(input);
    const cleanup = (): void => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      cleanup();
      if (!file) return;
      void file
        .text()
        .then((text) => {
          this.app.importSave(text);
          this.closeSettings();
        })
        .catch(() => {
          this.toast({ text: 'That file is not a valid DATAMINE save.', tone: 'bad' });
        });
    });
    window.addEventListener(
      'focus',
      () => {
        if (!input.files?.length) cleanup();
      },
      { once: true },
    );
    input.click();
  }
}
