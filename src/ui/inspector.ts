import {
  CONFIG,
  bufferCap,
  dataInfo,
  fmt,
  fmtRate,
  nominalRate,
  recipeFor,
  speedOf,
  tierLabel,
  upgradeCost,
} from '../game/gamedata.ts';
import { canAfford, creditsLabel } from '../game/actions.ts';
import { linkById, nodeById } from '../game/state.ts';
import { nodeStatus } from '../game/sim.ts';
import { GRID } from '../layout/geometry.ts';
import type { Cost, Link, MachineNode, Selection } from '../game/types.ts';
import { escapeHtml, glyphSvg, recipeMarkup, sortedBy, statusLabel, tierHex, tierVars } from './dom.ts';
import type { UI } from './ui.ts';

export interface LiveBar {
  fill: HTMLElement;
  val: HTMLElement;
}

export interface Live {
  bars: Record<string, LiveBar>;
  statusRow?: HTMLElement | null;
  statusText?: HTMLElement | null;
  utilText?: HTMLElement | null;
  utilBar?: HTMLElement | null;
  flowOut?: HTMLElement | null;
  linkFlow?: HTMLElement | null;
  upgradeBtn?: HTMLButtonElement | null;
  upgradeCost?: Cost | null;
  types?: HTMLElement | null;
  units?: HTMLElement | null;
  incoming?: HTMLElement | null;
  holdings?: HTMLElement | null;
  holdingKey?: string;
}

export interface VaultEntry {
  tier: number;
  amount: number;
  name: string;
  color: string;
}

export interface VaultLedger {
  entries: VaultEntry[];
  types: number;
  units: number;
}

export function buildInspector(ui: UI, selection: Selection): void {
  const state = ui.app.state;
  const root = ui.refs.inspector;
  ui.live = { bars: {} };
  root.style.removeProperty('--tier');
  const scrollTop = root.scrollTop;

  if (selection.kind === 'link') {
    buildLink(ui, linkById(state, selection.id));
  } else if (selection.kind === 'anchor') {
    const link = linkById(state, selection.linkId);
    if (!link) {
      ui.app.view.selection = null;
      return;
    }
    buildLink(ui, link, selection.index);
  } else {
    const node = nodeById(state, selection.id);
    if (!node) return;
    if (node.kind === 'vault') buildVault(ui, node);
    else buildNode(ui, node);
  }
  root.scrollTop = scrollTop;
}

export function vaultLedger(state: { bank: { [tier: number]: number } }): VaultLedger {
  const entries = sortedBy(
    Object.entries(state.bank)
      .filter(([, amount]) => Number.isFinite(amount) && amount > 0.005)
      .map(([tier, amount]) => {
        const t = Number(tier);
        return { tier: t, amount, name: dataInfo(t).name, color: tierHex(t) };
      }),
    (a, b) => b.amount - a.amount,
  );
  return {
    entries,
    types: entries.length,
    units: entries.reduce((sum, entry) => sum + entry.amount, 0),
  };
}

export function holdingsHtml(entries: VaultEntry[]): string {
  if (!entries.length) {
    return '<div class="kv-row"><span>No signals banked</span><b>0</b></div>';
  }
  return entries
    .map(
      (entry) => `
      <div class="kv-row">
        <span class="kv-name"><i style="background:${entry.color}"></i>${escapeHtml(entry.name)}</span>
        <b data-live="holding-${entry.tier}">${fmt(entry.amount)}</b>
      </div>
    `,
    )
    .join('');
}

function buildNode(ui: UI, node: MachineNode): void {
  const state = ui.app.state;
  const root = ui.refs.inspector;
  const isExtractor = node.kind === 'extractor';
  const tier = isExtractor ? 0 : node.kind === 'processor' ? node.tier : 0;
  const info = dataInfo(tier);
  const title = isExtractor ? 'Extractor' : `${info.name} Forge`;
  const kicker = isExtractor ? `Miner · ${tierLabel(0)}` : `Forge · ${tierLabel(tier)}`;
  const status = nodeStatus(state, node);
  const util = (node as { _util?: number })._util || 0;
  const cap = bufferCap(state, node);
  const speed = speedOf(state, node);
  const cost = upgradeCost(node);
  const atMax = node.level >= CONFIG.maxLevel;
  const can = !atMax && canAfford(state, cost);

  tierVars(root, tier);

  const recipe = isExtractor ? null : recipeFor(tier);
  let recipeHtml: string;
  let recipeNote: string;
  if (isExtractor) {
    recipeHtml = '<span class="t">Raw Noise</span><span class="muted">from the network</span>';
    recipeNote = 'Mines raw noise continuously. Raw noise buys extractors and feeds the first forge.';
  } else {
    recipeHtml = recipeMarkup(tier);
    const cycle = (recipe?.cycle ?? CONFIG.processorCycle) / speed;
    recipeNote = `One cycle every ${fmt(cycle)}s. Buffer holds ${fmt(cap)} of each stream.`;
  }

  const bars: string[] = [];
  if (recipe) {
    for (const input of recipe.inputs) {
      bars.push(
        barRow(
          `in-${input.tier}`,
          `${tierLabel(input.tier)} in`,
          tierHex(input.tier),
          (node.kind === 'processor' ? node.inputs[input.tier] : 0) || 0,
          cap,
        ),
      );
    }
  }
  const outAmount = node.kind === 'processor' || node.kind === 'extractor' ? node.out.amount : 0;
  bars.push(barRow('out', isExtractor ? 'out' : 'output', tierHex(tier), outAmount, cap));

  root.innerHTML = `
    <div class="insp-head">
      <span class="insp-glyph">${glyphSvg(tier)}</span>
      <div class="insp-title"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(kicker)}</p></div>
      <button class="icon-btn" data-action="close" type="button" aria-label="Close inspector">
        <svg aria-hidden="true"><use href="#i-close"></use></svg>
      </button>
    </div>
    <div class="insp-scroll">
      <section class="insp-block">
        <div class="insp-label">Status</div>
        <div class="status-row is-${status}" data-live="status">
          <span class="status-dot" aria-hidden="true"></span>
          <span class="status-text">${escapeHtml(statusLabel(status))}</span>
          <span class="status-util">${Math.round(util * 100)}%</span>
        </div>
        <div class="meter"><i data-live="util" style="width:${Math.min(100, util * 100)}%"></i></div>
      </section>

      <section class="insp-block">
        <div class="insp-label">Recipe</div>
        <div class="recipe-line">${recipeHtml}</div>
        <p class="insp-note">${escapeHtml(recipeNote)}</p>
      </section>

      <section class="insp-block">
        <div class="insp-label">Buffers</div>
        <div class="bars">${bars.join('')}</div>
      </section>

      <section class="insp-block">
        <div class="insp-label">Flow</div>
        <div class="kv">
          <div class="kv-row"><span>Nominal</span><b>${fmtRate(nominalRate(state, node))}</b></div>
          <div class="kv-row"><span>Outbound</span><b data-live="flow">${fmtRate((node as { _flowOut?: number })._flowOut || 0)}</b></div>
          <div class="kv-row"><span>Level</span><b>L${node.level} · ×${fmt(speed)} speed</b></div>
        </div>
      </section>

      <section class="insp-block">
        <div class="insp-label">Overclock</div>
        <div class="upgrade-box">
          <div class="upgrade-top"><span>${atMax ? `Level ${node.level}` : `Level ${node.level} → ${node.level + 1}`}</span><b>${atMax ? 'MAX' : '+50% speed'}</b></div>
          <button class="btn btn-primary btn-block" data-action="upgrade" type="button" ${can ? '' : 'disabled'}>
            <span>${atMax ? 'Fully overclocked' : 'Overclock'}</span>${atMax ? '' : `<span class="price">${fmt(cost.amount)} ${escapeHtml(dataInfo(cost.tier).name)}</span>`}
          </button>
          <p class="insp-note">${atMax ? 'This machine cannot be overclocked further.' : `Cost doubles each level · paid in ${escapeHtml(dataInfo(cost.tier).name)}`}</p>
        </div>
      </section>

      <section class="insp-block">
        <div class="insp-label">Salvage</div>
        <button class="btn btn-danger btn-icon-label" data-action="dismantle" type="button" title="Refund: ${escapeHtml(creditsLabel(node.invested))}">
          <svg aria-hidden="true"><use href="#i-trash"></use></svg>
          <span>Dismantle · refund ${escapeHtml(creditsLabel(node.invested))}</span>
        </button>
        <p class="insp-note">Full refund. Wires attached to this machine are removed.</p>
      </section>
    </div>
  `;

  ui.live.statusRow = root.querySelector('[data-live="status"]');
  ui.live.statusText = root.querySelector('[data-live="status"] .status-text');
  ui.live.utilText = root.querySelector('[data-live="status"] .status-util');
  ui.live.utilBar = root.querySelector('[data-live="util"]');
  ui.live.flowOut = root.querySelector('[data-live="flow"]');
  ui.live.upgradeBtn = root.querySelector('[data-action="upgrade"]');
  ui.live.upgradeCost = atMax ? null : cost;
  for (const row of root.querySelectorAll('.bar-row')) {
    const key = (row as HTMLElement).dataset.bar;
    if (!key) continue;
    ui.live.bars[key] = {
      fill: row.querySelector('.bar-fill') as HTMLElement,
      val: row.querySelector('.bar-val') as HTMLElement,
    };
  }
}

function buildVault(ui: UI, node: MachineNode): void {
  const state = ui.app.state;
  const root = ui.refs.inspector;
  let incoming = 0;
  let wires = 0;
  for (const link of state.links) {
    if (link.to === node.id) {
      wires++;
      incoming += (link as { _flow?: number })._flow || 0;
    }
  }
  const ledger = vaultLedger(state);
  const status = incoming > 0 ? 'receiving' : 'idle';

  root.style.setProperty('--tier', 'var(--ink)');
  root.style.setProperty('--tier-bright', 'var(--ink)');
  root.style.setProperty('--tier-dim', 'var(--ink-faint)');
  root.style.setProperty('--tier-soft', 'var(--inset)');

  root.innerHTML = `
    <div class="insp-head">
      <span class="insp-glyph">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
          <rect x="2.4" y="2.4" width="11.2" height="11.2"/>
          <circle cx="8" cy="8" r="3.1"/>
          <path d="M8 5.2v5.6M5.2 8h5.6"/>
        </svg>
      </span>
      <div class="insp-title"><h2>The Vault</h2><p>Depository · permanent</p></div>
      <button class="icon-btn" data-action="close" type="button" aria-label="Close inspector">
        <svg aria-hidden="true"><use href="#i-close"></use></svg>
      </button>
    </div>
    <div class="insp-scroll">
      <section class="insp-block">
        <div class="insp-label">Status</div>
        <div class="status-row is-${status}" data-live="status">
          <span class="status-dot" aria-hidden="true"></span>
          <span class="status-text">${status === 'receiving' ? 'Receiving' : 'Idle'}</span>
          <span class="status-util">${wires} wire${wires === 1 ? '' : 's'}</span>
        </div>
      </section>

      <section class="insp-block">
        <div class="insp-label">Ledger</div>
        <div class="kv">
          <div class="kv-row"><span>Signal types</span><b data-live="types">${ledger.types}</b></div>
          <div class="kv-row"><span>Units held</span><b data-live="units">${fmt(ledger.units)}</b></div>
          <div class="kv-row"><span>Incoming</span><b data-live="incoming">${fmtRate(incoming)}</b></div>
          <div class="kv-row"><span>Wires</span><b>${wires}</b></div>
        </div>
        <p class="insp-note">Each signal type is tracked separately. Units of one type are not interchangeable with another.</p>
      </section>

      <section class="insp-block">
        <div class="insp-label">Holdings</div>
        <div class="kv" data-live="holdings">${holdingsHtml(ledger.entries.slice(0, 6))}</div>
      </section>

      <section class="insp-block">
        <div class="insp-label">Deposit</div>
        <div class="recipe-line"><span class="t">Any signal</span><span class="muted">→</span><span class="out">banked</span></div>
        <p class="insp-note">The vault accepts every tier. Banked data is currency and can never be lost.</p>
      </section>

      <section class="insp-block">
        <div class="insp-label">Anchor</div>
        <p class="insp-note">The vault is permanent. It cannot be dismantled or moved. It holds the entire bank.</p>
      </section>
    </div>
  `;

  ui.live.statusRow = root.querySelector('[data-live="status"]');
  ui.live.statusText = root.querySelector('[data-live="status"] .status-text');
  ui.live.types = root.querySelector('[data-live="types"]');
  ui.live.units = root.querySelector('[data-live="units"]');
  ui.live.incoming = root.querySelector('[data-live="incoming"]');
  ui.live.holdings = root.querySelector('[data-live="holdings"]');
  ui.live.holdingKey = ledger.entries.map((entry) => entry.tier).join(',');
}

function buildLink(ui: UI, link: Link | null, anchorIndex = -1): void {
  if (!link) return;
  const state = ui.app.state;
  const root = ui.refs.inspector;
  const info = dataInfo(link.tier);
  const from = nodeById(state, link.from);
  const to = nodeById(state, link.to);
  const fromName = from
    ? from.kind === 'extractor'
      ? 'Extractor'
      : dataInfo(from.kind === 'processor' ? from.tier : 0).name
    : '?';
  const toName = to
    ? to.kind === 'vault'
      ? 'The Vault'
      : `${dataInfo(to.kind === 'processor' ? to.tier : 0).name} Forge`
    : '?';
  const sourceRate = from ? nominalRate(state, from) : 0;
  const anchors = link.anchors || [];
  const anchor = anchorIndex >= 0 ? anchors[anchorIndex] : null;
  const priority = link.priority;

  tierVars(root, link.tier);

  const anchorBlock = anchor
    ? `
      <section class="insp-block">
        <div class="insp-label">Anchor ${anchorIndex + 1}</div>
        <div class="kv">
          <div class="kv-row"><span>Position</span><b>${Math.round(anchor.x)}, ${Math.round(anchor.y)}</b></div>
          <div class="kv-row"><span>Grid</span><b>${anchor.x % GRID.cell === 0 && anchor.y % GRID.cell === 0 ? 'snapped' : 'free'}</b></div>
        </div>
        <div class="nudge-row">
          <button class="btn btn-quiet" data-action="nudge-anchor" data-dx="-1" data-dy="0" type="button" aria-label="Nudge anchor left">←</button>
          <button class="btn btn-quiet" data-action="nudge-anchor" data-dx="1" data-dy="0" type="button" aria-label="Nudge anchor right">→</button>
          <button class="btn btn-quiet" data-action="nudge-anchor" data-dx="0" data-dy="-1" type="button" aria-label="Nudge anchor up">↑</button>
          <button class="btn btn-quiet" data-action="nudge-anchor" data-dx="0" data-dy="1" type="button" aria-label="Nudge anchor down">↓</button>
        </div>
        <button class="btn btn-danger btn-icon-label" data-action="remove-anchor" type="button">
          <svg aria-hidden="true"><use href="#i-trash"></use></svg>
          <span>Remove this anchor</span>
        </button>
        <p class="insp-note">Drag the handle on the board, or nudge it here. Right-click a handle removes it.</p>
      </section>
    `
    : '';

  root.innerHTML = `
    <div class="insp-head">
      <span class="insp-glyph">${glyphSvg(link.tier)}</span>
      <div class="insp-title"><h2>${escapeHtml(info.name)} Wire</h2><p>Link · ${tierLabel(link.tier)}</p></div>
      <button class="icon-btn" data-action="close" type="button" aria-label="Close inspector">
        <svg aria-hidden="true"><use href="#i-close"></use></svg>
      </button>
    </div>
    <div class="insp-scroll">
      <section class="insp-block">
        <div class="insp-label">Route</div>
        <div class="link-route">
          <span>${escapeHtml(fromName)}</span>
          <i class="route-line" aria-hidden="true"></i>
          <span>${escapeHtml(toName)}</span>
        </div>
        <div class="kv">
          <div class="kv-row"><span>Anchors</span><b>${anchors.length}</b></div>
        </div>
        <div class="insp-actions">
          <button class="btn btn-quiet" data-action="add-anchor" type="button">Add anchor</button>
          <button class="btn btn-quiet" data-action="clear-route" type="button" ${anchors.length ? '' : 'disabled'}>Clear route</button>
        </div>
        <p class="insp-note">Click an output port, then click the board to lay out points, then click an input port. Double-click a wire to drop an anchor. Right-click a handle removes it.</p>
      </section>

      ${anchorBlock}

      <section class="insp-block">
        <div class="insp-label">Priority</div>
        <div class="seg" role="group" aria-label="Wire priority">
          <button class="seg-btn${priority === 0.5 ? ' is-active' : ''}" data-action="set-priority" data-priority="0.5" type="button">Low</button>
          <button class="seg-btn${priority === 1 ? ' is-active' : ''}" data-action="set-priority" data-priority="1" type="button">Normal</button>
          <button class="seg-btn${priority === 2 ? ' is-active' : ''}" data-action="set-priority" data-priority="2" type="button">High</button>
        </div>
        <p class="insp-note">When one output feeds several inputs, each wire takes a share of the flow. High priority wires are served first.</p>
      </section>

      <section class="insp-block">
        <div class="insp-label">Throughput</div>
        <div class="link-flow" data-live="link-flow">${fmtRate((link as { _flow?: number })._flow || 0)}</div>
        <div class="kv">
          <div class="kv-row"><span>Source nominal</span><b>${fmtRate(sourceRate)}</b></div>
          <div class="kv-row"><span>Payload</span><b>${escapeHtml(info.name)}</b></div>
        </div>
      </section>

      <section class="insp-block">
        <div class="insp-label">Remove</div>
        <button class="btn btn-danger btn-icon-label" data-action="remove-link" type="button">
          <svg aria-hidden="true"><use href="#i-trash"></use></svg>
          <span>Cut this wire</span>
        </button>
        <p class="insp-note">The machines stay online. Nothing is refunded for wires.</p>
      </section>
    </div>
  `;

  ui.live.linkFlow = root.querySelector('[data-live="link-flow"]');
}

function barRow(key: string, label: string, color: string, amount: number, cap: number): string {
  const share = cap > 0 ? Math.min(100, (amount / cap) * 100) : 0;
  return `<div class="bar-row" data-bar="${key}">
    <span class="bar-label">${escapeHtml(label)}</span>
    <div class="bar-track"><div class="bar-fill" style="--tier:${color};width:${share}%"></div></div>
    <span class="bar-val">${fmt(amount)} / ${fmt(cap)}</span>
  </div>`;
}
