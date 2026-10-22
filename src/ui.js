import {
  CONFIG, dataInfo, recipeFor, bufferCap, fmt, fmtRate, fmtDuration,
  tierLabel, deepScanReward,
} from './gamedata.js';
import { canAfford, currentCost, bankOf } from './actions.js';
import { nodeById, linkById } from './state.js';
import { nodeStatus } from './sim.js';
import { buildInspector, vaultLedger, holdingsHtml } from './inspector.js';
import {
  renderBank, renderBuild, renderCodex, renderNextLock, renderOps, updateOps, updateHint,
} from './panels.js';
import { escapeHtml, STATUS_TEXT } from './dom.js';

export class UI {
  constructor(app) {
    this.app = app;
    this.refs = {};
    this.lastUnlocked = app.state.unlockedTier;
    this.lastBuildKey = '';
    this.lastCodexUnlocked = -1;
    this.lastSelectionKey = '';
    this.lastHint = '';
    this.bankKeys = '';
    this.lastLive = 0;
    this.lastStatus = 0;
    this.lastSave = '';
    this.tab = 'build';
    this.live = {};
    this.buildCards = new Map();
    this.bankAmounts = new Map();
    this.codexAmounts = new Map();
    this.ops = null;

    this.cacheRefs();
    this.bind();
    this.switchTab('build');
    this.refresh(true);
    this.applySettings();
    this.setPaused(app.view.paused);
    this.setMuted(app.state.muted);
  }

  cacheRefs() {
    const ids = [
      'bank', 'build-list', 'codex-list', 'build-view', 'codex-view', 'ops-view',
      'build-count', 'next-lock', 'inspector', 'hint', 'hint-text', 'hint-close',
      'toasts', 'node-count', 'link-count', 'tier-readout', 'status-mid', 'save-state',
      'btn-pause', 'btn-sound', 'btn-settings', 'net-status', 'net-label',
      'settings', 'settings-close', 'setting-sound', 'setting-motion', 'setting-snap',
      'btn-export', 'btn-import', 'btn-reset', 'btn-hints', 'modal-root',
      'zoom-in', 'zoom-out', 'zoom-fit', 'sidebar', 'sidebar-close', 'mobile-build',
      'pause-banner', 'directive-list', 'core-list', 'core-balance', 'deep-scan',
      'deep-scan-hint', 'archive-note',
    ];
    for (const id of ids) this.refs[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
  }

  bind() {
    const r = this.refs;
    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    }

    r.buildList.addEventListener('click', (event) => {
      const card = event.target.closest('.build-card');
      if (!card || card.classList.contains('is-locked')) return;
      const kind = card.dataset.kind;
      const tier = card.dataset.tier ? Number(card.dataset.tier) : null;
      this.app.armBuild(kind, tier, event.shiftKey);
    });

    r.inspector.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const selection = this.app.view.selection;
      if (action === 'close') this.deselect();
      if (action === 'upgrade' && selection?.kind === 'node') this.app.upgradeNode(selection.id);
      if (action === 'dismantle' && selection?.kind === 'node') this.app.dismantleNode(selection.id);
      if (action === 'remove-link' && selection?.kind === 'link') this.app.removeLink(selection.id);
      if (action === 'add-anchor' && selection?.kind === 'link') this.app.addAnchorToSelection();
      if (action === 'clear-route' && selection?.kind === 'link') this.app.clearRoute(selection.id);
      if (action === 'remove-anchor' && selection?.kind === 'anchor') {
        this.app.removeAnchor(selection.linkId, selection.index);
      }
      if (action === 'nudge-anchor' && selection?.kind === 'anchor') {
        this.app.nudgeAnchor(selection.linkId, selection.index, Number(button.dataset.dx), Number(button.dataset.dy));
      }
      if (action === 'set-priority' && selection?.kind === 'link') {
        this.app.setPriority(selection.id, Number(button.dataset.priority));
      }
    });

    r.opsView.addEventListener('click', (event) => {
      const core = event.target.closest('[data-core]');
      if (core) {
        this.app.buyCore(core.dataset.core);
        return;
      }
      const scan = event.target.closest('[data-action="deep-scan"]');
      if (scan) this.confirmDeepScan();
    });

    r.hintClose.addEventListener('click', () => {
      this.app.state.hintDismissed = true;
      this.app.saveSoon();
      this.updateHint();
    });

    r.btnHints.addEventListener('click', () => {
      this.app.state.hintDismissed = false;
      this.app.saveSoon();
      this.updateHint();
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
      const chip = event.target.closest('.chip');
      if (!chip) return;
      const tier = Number(chip.dataset.tier);
      this.openSidebar('codex');
      requestAnimationFrame(() => {
        const row = document.getElementById(`codex-tier-${tier}`);
        if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    });

    document.addEventListener('pointerdown', (event) => {
      if (r.settings.hidden) return;
      if (r.settings.contains(event.target) || r.btnSettings.contains(event.target)) return;
      this.closeSettings();
    });
  }

  switchTab(name) {
    this.tab = name;
    const build = name === 'build';
    const ops = name === 'ops';
    this.refs.buildView.hidden = !build;
    this.refs.opsView.hidden = !ops;
    this.refs.codexView.hidden = build || ops;
    for (const tab of document.querySelectorAll('.tab')) {
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

  isMobile() {
    return window.innerWidth <= 900;
  }

  openSidebar(tab = this.tab) {
    this.switchTab(tab);
    if (this.isMobile()) {
      this.refs.sidebar.classList.add('is-open');
      this.refs.mobileBuild.setAttribute('aria-expanded', 'true');
      this.deselect();
    }
  }

  closeSidebar() {
    this.refs.sidebar.classList.remove('is-open');
    this.refs.mobileBuild.setAttribute('aria-expanded', 'false');
  }

  refresh(force = false) {
    const state = this.app.state;
    const view = this.app.view;

    const unlockedChanged = state.unlockedTier !== this.lastUnlocked;
    renderBank(this, force || unlockedChanged);
    if (unlockedChanged) this.lastUnlocked = state.unlockedTier;

    const buildKey = `${state.nodes.length}:${state.links.length}:${state.unlockedTier}:${view.pendingBuild?.kind || ''}:${view.pendingBuild?.tier ?? ''}`;
    if (force || buildKey !== this.lastBuildKey) {
      renderBuild(this);
      this.lastBuildKey = buildKey;
    }

    if (state.unlockedTier !== this.lastCodexUnlocked || !this.refs.codexList.childElementCount) {
      renderCodex(this, state.unlockedTier !== this.lastCodexUnlocked);
      this.lastCodexUnlocked = state.unlockedTier;
    }

    this.refs.nodeCount.textContent = `${state.nodes.length} nodes`;
    this.refs.linkCount.textContent = `${state.links.length} links`;
    this.refs.tierReadout.textContent = tierLabel(Math.max(0, state.stats.deepestTier));
    this.refs.buildCount.textContent = `${state.unlockedTier} tier${state.unlockedTier === 1 ? '' : 's'}`;
    renderNextLock(this);
    updateHint(this);
    this.syncSelection(force);
    this.updateLive();
    this.applySettings();
    if (this.tab === 'ops') updateOps(this);
  }

  tick(now) {
    if (this.app.state.unlockedTier > this.lastUnlocked) {
      const tier = this.app.state.unlockedTier;
      this.lastUnlocked = tier;
      const info = dataInfo(tier);
      this.app.audio.discover();
      this.toast({
        text: `New signal: ${info.name}`,
        sub: `${tierLabel(tier)} forge available`,
        tone: 'discover',
        tier: info.hue,
        duration: 3800,
      });
      this.app.saveSoon();
      this.refresh(true);
    }

    if (now - this.lastLive < 90) return;
    this.lastLive = now;

    if (this.bankKey() !== this.bankKeys) renderBank(this, false);

    for (const [tier, el] of this.bankAmounts) {
      const amount = bankOf(this.app.state, tier);
      const text = fmt(amount);
      if (el.textContent !== text) el.textContent = text;
      el.parentElement?.classList.toggle('is-zero', amount < 0.005);
    }

    for (const [tier, el] of this.codexAmounts) {
      const text = fmt(bankOf(this.app.state, tier));
      if (el.textContent !== text) el.textContent = text;
    }

    for (const card of this.buildCards.values()) {
      const cost = currentCost(this.app.state, card.kind, card.tier);
      const poor = !canAfford(this.app.state, cost);
      const armed = this.app.view.pendingBuild?.kind === card.kind &&
        (card.kind === 'extractor' || this.app.view.pendingBuild?.tier === card.tier);
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
      const state = this.app.state;
      this.refs.statusMid.textContent =
        `DEEPEST ${tierLabel(state.stats.deepestTier)}  ·  MACHINES ${state.nodes.length}  ·  LINKS ${state.links.length}` +
        (state.cores > 0 ? `  ·  CORES ${state.cores}` : '');
      updateHint(this);
    }
  }

  bankKey(state = this.app.state) {
    const keys = new Set([0]);
    for (const [tier, amount] of Object.entries(state.bank)) {
      if (amount > 0.005) keys.add(Number(tier));
    }
    keys.add(state.unlockedTier);
    keys.add(state.stats.deepestTier);
    return [...keys]
      .filter((tier) => Number.isInteger(tier) && tier >= 0)
      .sort((a, b) => a - b)
      .join(',');
  }

  syncSelection(force = false) {
    const selection = this.app.view.selection;
    if (!selection) {
      this.refs.inspector.classList.remove('is-open');
      this.refs.inspector.inert = true;
      this.lastSelectionKey = '';
      return;
    }
    const state = this.app.state;
    let key;
    if (selection.kind === 'node') {
      const node = nodeById(state, selection.id);
      if (!node) {
        this.app.view.selection = null;
        this.refs.inspector.classList.remove('is-open');
        this.refs.inspector.inert = true;
        return;
      }
      key = `node:${node.id}:${node.level}:${state.links.length}:${state.unlockedTier}`;
    } else if (selection.kind === 'anchor') {
      const link = linkById(state, selection.linkId);
      if (!link || !link.anchors?.[selection.index]) {
        this.app.view.selection = null;
        this.refs.inspector.classList.remove('is-open');
        this.refs.inspector.inert = true;
        return;
      }
      key = `anchor:${link.id}:${selection.index}:${link.anchors.length}:${link.priority}`;
    } else {
      const link = linkById(state, selection.id);
      if (!link) {
        this.app.view.selection = null;
        this.refs.inspector.classList.remove('is-open');
        this.refs.inspector.inert = true;
        return;
      }
      key = `link:${link.id}:${link.tier}:${link.priority}:${link.anchors.length}:${state.unlockedTier}`;
    }
    if (force || key !== this.lastSelectionKey) {
      this.lastSelectionKey = key;
      buildInspector(this, selection);
    }
    this.refs.inspector.classList.add('is-open');
    this.refs.inspector.inert = false;
  }

  updateLive() {
    const selection = this.app.view.selection;
    if (!selection || !this.refs.inspector.classList.contains('is-open')) return;
    const state = this.app.state;
    if (selection.kind === 'anchor') return;

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
            incoming += link._flow || 0;
          }
        }
        if (this.live.types) this.live.types.textContent = String(ledger.types);
        if (this.live.units) this.live.units.textContent = fmt(ledger.units);
        if (this.live.incoming) this.live.incoming.textContent = fmtRate(incoming);
        const holdingKey = ledger.entries.map((entry) => entry.tier).join(',');
        if (this.live.holdings) {
          if (holdingKey !== this.live.holdingKey) {
            this.live.holdingKey = holdingKey;
            this.live.holdings.innerHTML = holdingsHtml(ledger.entries.slice(0, 6));
          } else {
            for (const entry of ledger.entries) {
              const cell = this.live.holdings.querySelector(`[data-live="holding-${entry.tier}"]`);
              if (cell) cell.textContent = fmt(entry.amount);
            }
          }
        }
        if (this.live.statusRow) {
          const receiving = incoming > 0.002;
          this.live.statusRow.className = `status-row is-${receiving ? 'receiving' : 'idle'}`;
          if (this.live.statusText) this.live.statusText.textContent = receiving ? 'RECEIVING' : 'IDLE';
          const util = this.live.statusRow.querySelector('.status-util');
          if (util) util.textContent = `${wires} wire${wires === 1 ? '' : 's'}`;
        }
        return;
      }

      const status = nodeStatus(state, node);
      if (this.live.statusRow) {
        this.live.statusRow.className = `status-row is-${status}`;
        this.live.statusText.textContent = (STATUS_TEXT[status] || status).toUpperCase();
        this.live.utilText.textContent = `${Math.round((node._util || 0) * 100)}%`;
        this.live.utilBar.style.width = `${Math.min(100, Math.max(0, (node._util || 0) * 100))}%`;
      }
      const cap = bufferCap(state, node);
      if (node.kind === 'processor') {
        const recipe = recipeFor(node.tier);
        for (const input of recipe.inputs) {
          const row = this.live.bars?.[`in-${input.tier}`];
          if (row) {
            const amount = node.inputs[input.tier] || 0;
            row.fill.style.width = `${cap > 0 ? Math.min(100, amount / cap * 100) : 0}%`;
            row.val.textContent = `${fmt(amount)} / ${fmt(cap)}`;
          }
        }
      }
      if (this.live.bars?.out) {
        const amount = node.out?.amount || 0;
        this.live.bars.out.fill.style.width = `${cap > 0 ? Math.min(100, amount / cap * 100) : 0}%`;
        this.live.bars.out.val.textContent = `${fmt(amount)} / ${fmt(cap)}`;
      }
      if (this.live.flowOut) this.live.flowOut.textContent = fmtRate(node._flowOut || 0);
      if (this.live.upgradeBtn) {
        const cost = this.live.upgradeBtn._cost;
        if (cost) this.live.upgradeBtn.disabled = !canAfford(state, cost);
      }
    } else {
      const link = linkById(state, selection.id);
      if (!link) return;
      if (this.live.linkFlow) this.live.linkFlow.textContent = fmtRate(link._flow || 0);
    }
  }

  select(selection) {
    this.app.view.selection = selection;
    this.closeMobilePanels();
    this.syncSelection(true);
    this.updateLive();
  }

  deselect() {
    this.app.view.selection = null;
    this.refs.inspector.classList.remove('is-open');
    this.refs.inspector.inert = true;
    this.lastSelectionKey = '';
    this.app.view.hoverPort = null;
  }

  setPaused(paused) {
    this.refs.netStatus.classList.toggle('is-paused', paused);
    this.refs.netLabel.textContent = paused ? 'Paused' : 'Online';
    this.refs.btnPause.classList.toggle('is-active', paused);
    this.refs.btnPause.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
    this.refs.btnPause.title = paused ? 'Resume (P)' : 'Pause (P)';
    this.refs.btnPause.setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation');
    this.refs.pauseBanner.hidden = !paused;
    document.body.classList.toggle('is-paused', paused);
  }

  setMuted(muted) {
    this.refs.settingSound.checked = !muted;
    this.refs.btnSound.classList.toggle('is-active', muted);
    this.refs.btnSound.querySelector('use').setAttribute('href', muted ? '#i-mute' : '#i-sound');
    this.refs.btnSound.title = muted ? 'Sound off (M)' : 'Sound on (M)';
  }

  applySettings() {
    this.refs.settingSound.checked = !this.app.state.muted;
    this.refs.settingMotion.checked = this.app.state.motion !== false;
    this.refs.settingSnap.checked = this.app.state.snapGrid !== false;
  }

  setSaveState(label, saved = false) {
    if (label === this.lastSave && !saved) return;
    this.lastSave = label;
    this.refs.saveState.textContent = label;
    this.refs.saveState.classList.toggle('is-saved', saved);
  }

  toggleSettings() {
    const open = this.refs.settings.hidden;
    this.refs.settings.hidden = !open;
    if (open) this.refs.btnSettings.classList.add('is-active');
    else this.refs.btnSettings.classList.remove('is-active');
  }

  closeSettings() {
    this.refs.settings.hidden = true;
    this.refs.btnSettings.classList.remove('is-active');
  }

  closeMobilePanels() {
    if (this.isMobile()) this.closeSidebar();
  }

  toast({ text, sub = '', tone = '', tier = null, quiet = false, duration = 3000 }) {
    const el = document.createElement('div');
    el.className = `toast ${tone}${quiet ? ' quiet' : ''}`;
    if (tier !== null) el.style.setProperty('--tier', `hsl(${tier} 74% 63%)`);
    el.innerHTML = `<span class="toast-mark"></span><div class="toast-body"><div class="toast-text"></div>${sub ? '<div class="toast-sub"></div>' : ''}</div>`;
    el.querySelector('.toast-text').textContent = text;
    if (sub) el.querySelector('.toast-sub').textContent = sub;
    this.refs.toasts.append(el);
    while (this.refs.toasts.children.length > 4) this.refs.toasts.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 220);
    }, duration);
  }

  modal({ kicker = 'SYSTEM', title, html, actions = [] }) {
    this.closeModal();
    const root = this.refs.modalRoot;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', title);
    box.innerHTML = `
      <div class="modal-head">
        <div class="modal-kicker">${escapeHtml(kicker)}</div>
        <h2 class="modal-title">${escapeHtml(title)}</h2>
      </div>
      <div class="modal-body">${html}</div>
      <div class="modal-actions"></div>
    `;
    const actionRoot = box.querySelector('.modal-actions');
    for (const action of actions) {
      const button = document.createElement('button');
      button.className = `btn${action.primary ? ' btn-primary' : ''}`;
      button.textContent = action.label;
      if (action.danger) {
        button.style.color = 'var(--bad)';
        button.style.borderColor = 'rgba(227,123,111,.45)';
      }
      button.addEventListener('click', () => {
        this.closeModal();
        action.onClick?.();
      });
      actionRoot.append(button);
    }
    backdrop.append(box);
    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) this.closeModal();
    });
    box.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = [...box.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.disabled && el.offsetParent !== null);
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
    });
    root.append(backdrop);
    this._lastFocus = document.activeElement;
    actionRoot.querySelector('button')?.focus();
  }

  closeModal() {
    if (!this.refs.modalRoot.childElementCount) {
      this.refs.modalRoot.textContent = '';
      return;
    }
    this.refs.modalRoot.textContent = '';
    if (this._lastFocus?.isConnected && this._lastFocus?.focus) this._lastFocus.focus();
  }

  showOffline(elapsed, gains) {
    const rows = Object.entries(gains)
      .filter(([, amount]) => amount > 0.005)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 6)
      .map(([tier, amount]) => {
        const info = dataInfo(Number(tier));
        return `<div class="gain-row" style="--tier:${info.color}"><span>${escapeHtml(info.name)}</span><b>+${fmt(amount)}</b></div>`;
      }).join('');
    const next = this.nextAffordable();
    this.modal({
      kicker: 'Session recovery',
      title: 'While you were away',
      html: `
        <p>The refinery kept running for <b style="color:var(--bone);font-weight:500">${fmtDuration(elapsed)}</b>.</p>
        ${rows ? `<div class="gains">${rows}</div>` : '<p>Nothing reached the vault. Check the wiring and try again.</p>'}
        ${next ? `<p class="modal-note">${next}</p>` : ''}
      `,
      actions: [{ label: 'Resume', primary: true }],
    });
  }

  nextAffordable() {
    const state = this.app.state;
    const parts = [];
    for (let tier = 1; tier <= state.unlockedTier; tier++) {
      const cost = currentCost(state, 'processor', tier);
      if (canAfford(state, cost)) {
        parts.push(`a ${dataInfo(tier).name} forge is within reach`);
        break;
      }
    }
    const extractor = currentCost(state, 'extractor');
    if (!parts.length && canAfford(state, extractor)) parts.push('another extractor is within reach');
    if (!parts.length) return '';
    return `You can afford ${parts[0]}.`;
  }

  confirmDeepScan() {
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
    this.modal({
      kicker: 'Destructive action',
      title: 'Run a deep scan?',
      html: `
        <p>The refinery is torn down and rebuilt from bare rock. Machines, wires and banked signals are lost.</p>
        <p class="modal-note">Cores, core ranks and archive records carry over. You gain <b style="color:var(--bone)">${gain} core${gain === 1 ? '' : 's'}</b>.</p>
      `,
      actions: [
        { label: 'Cancel' },
        { label: 'Deep scan', danger: true, onClick: () => this.app.deepScan() },
      ],
    });
  }

  confirmReset() {
    this.closeSettings();
    this.modal({
      kicker: 'Destructive action',
      title: 'Wipe this instance?',
      html: '<p>Every machine, wire, and banked signal in this browser will be deleted. This cannot be undone.</p>',
      actions: [
        { label: 'Cancel' },
        { label: 'Wipe', danger: true, onClick: () => this.app.resetGame() },
      ],
    });
  }

  pickImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.append(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        const text = await file.text();
        this.app.importSave(text);
        this.closeSettings();
      } catch {
        this.toast({ text: 'That file is not a valid DATAMINE save.', tone: 'bad' });
      }
    });
    input.click();
  }
}
