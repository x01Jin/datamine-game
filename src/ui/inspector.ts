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
import { GRID, FACE_LABEL, rotationFaces } from '../layout/geometry.ts';
import type {
  Cost,
  ExtractorNode,
  Link,
  MachineNode,
  ProcessorNode,
  Selection,
  State,
} from '../game/types.ts';
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

interface WireEnd {
  dir: 'in' | 'out';
  tier: number;
  name: string;
}

const WIRE_LIMIT = 3;

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

function buildNode(ui: UI, node: ExtractorNode | ProcessorNode): void {
  const state = ui.app.state;
  const root = ui.refs.inspector;
  const isExtractor = node.kind === 'extractor';
  const tier = isExtractor ? 0 : node.tier;
  const info = dataInfo(tier);
  const title = isExtractor ? 'Extractor' : `${info.name} Processor`;
  const kicker = isExtractor ? `Miner · ${tierLabel(0)}` : `Processor · ${tierLabel(tier)}`;
  const status = nodeStatus(state, node);
  const util = node._util || 0;
  const cap = bufferCap(state, node);
  const speed = speedOf(state, node);
  const cost = upgradeCost(node);
  const atMax = node.level >= CONFIG.maxLevel;
  const can = !atMax && canAfford(state, cost);

  tierVars(root, tier);

  const recipe = isExtractor ? null : recipeFor(node.tier);
  const cycle = recipe ? recipe.cycle / speed : 0;
  const recipeLine = isExtractor
    ? '<span class="t">Raw Data</span><span class="muted">from the network</span>'
    : recipeMarkup(tier);
  const recipeTitle = isExtractor
    ? 'Mines raw data continuously. Raw data buys extractors and feeds the first processor.'
    : `One cycle every ${fmt(cycle)}s. Buffer holds ${fmt(cap)} of each stream.`;

  const bars: string[] = [];
  if (recipe) {
    for (const input of recipe.inputs) {
      bars.push(
        barRow(
          `in-${input.tier}`,
          `${tierLabel(input.tier)} in`,
          tierHex(input.tier),
          node.kind === 'processor' ? node.inputs[input.tier] || 0 : 0,
          cap,
        ),
      );
    }
  }
  bars.push(barRow('out', isExtractor ? 'out' : 'output', tierHex(tier), node.out.amount, cap));

  const faces = rotationFaces(node);
  const stats = isExtractor
    ? ''
    : statCell(
        'Face',
        `${faces.in.toUpperCase()}→${faces.out.toUpperCase()}`,
        '',
        `${FACE_LABEL[faces.in]} in · ${FACE_LABEL[faces.out]} out`,
      );
  const statGrid = [
    stats,
    statCell('Rate', fmtRate(nominalRate(state, node)), '', 'Theoretical output at full speed'),
    statCell('Out', fmtRate(node._flowOut || 0), 'flow', 'Actual output rate'),
    statCell('Level', `L${node.level}`, '', `Overclock level ${node.level} · ×${fmt(speed)} speed`),
  ].join('');

  const actions = isExtractor
    ? `<button class="btn btn-danger" data-action="dismantle" type="button" title="Refund ${escapeHtml(creditsLabel(node.invested))}. Wires attached to this machine are removed.">Dismantle</button>`
    : `<button class="btn btn-quiet" data-action="rotate" type="button" title="Turn 90° (R). Attached wires follow the new ports.">Turn 90°</button>
       <button class="btn btn-danger" data-action="dismantle" type="button" title="Refund ${escapeHtml(creditsLabel(node.invested))}. Wires attached to this machine are removed.">Dismantle</button>`;

  root.innerHTML = `
    <div class="insp-head">
      <span class="insp-glyph">${glyphSvg(tier)}</span>
      <div class="insp-title"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(kicker)}</p></div>
      <button class="icon-btn" data-action="close" type="button" aria-label="Close inspector">
        <svg aria-hidden="true"><use href="#i-close"></use></svg>
      </button>
    </div>
    <div class="insp-body">
      <section class="insp-sec">
        <div class="status-row is-${status}" data-live="status">
          <span class="status-dot" aria-hidden="true"></span>
          <span class="status-text">${escapeHtml(statusLabel(status))}</span>
          <span class="status-util">${Math.round(util * 100)}%</span>
        </div>
        <div class="meter"><i data-live="util" style="width:${Math.min(100, util * 100)}%"></i></div>
      </section>

      <section class="insp-sec">
        <div class="insp-label">Recipe</div>
        <div class="recipe-line" title="${escapeHtml(recipeTitle)}">${recipeLine}${
          isExtractor
            ? ''
            : `<span class="recipe-meta">${cycle < 0.005 ? '&lt;0.01' : fmt(cycle)}s/cycle</span>`
        }</div>
      </section>

      <section class="insp-sec">
        <div class="insp-label">Buffers</div>
        <div class="bars">${bars.join('')}</div>
      </section>

      <section class="insp-sec">
        <div class="insp-label">Wiring</div>
        ${wiringHtml(state, node)}
      </section>

      <section class="insp-sec">
        <div class="stat-grid">${statGrid}</div>
      </section>
    </div>
    <div class="insp-foot">
      <button class="btn btn-primary btn-block" data-action="upgrade" type="button" ${can ? '' : 'disabled'} title="${
        atMax
          ? 'This machine cannot be overclocked further.'
          : `Cost doubles each level. Paid in ${dataInfo(cost.tier).name}.`
      }">
        <span>${atMax ? 'Fully overclocked' : `Overclock → L${node.level + 1}`}</span>${
          atMax
            ? ''
            : `<span class="price">${fmt(cost.amount)} ${escapeHtml(dataInfo(cost.tier).name)}</span>`
        }
      </button>
      <div class="insp-actions">${actions}</div>
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
    <div class="insp-body">
      <section class="insp-sec">
        <div class="status-row is-${status}" data-live="status">
          <span class="status-dot" aria-hidden="true"></span>
          <span class="status-text">${status === 'receiving' ? 'Receiving' : 'Idle'}</span>
          <span class="status-util">${wires} wire${wires === 1 ? '' : 's'}</span>
        </div>
      </section>

      <section class="insp-sec">
        <div class="stat-grid">
          ${statCell('Types', String(ledger.types), 'types', 'Signal types held')}
          ${statCell('Units', fmt(ledger.units), 'units', 'Total units held')}
          ${statCell('In', fmtRate(incoming), 'incoming', 'Incoming rate')}
          ${statCell('Wires', String(wires), '', 'Wires feeding the vault')}
        </div>
      </section>

      <section class="insp-sec">
        <div class="insp-label">Holdings</div>
        <div class="kv" data-live="holdings">${holdingsHtml(ledger.entries.slice(0, 6))}</div>
      </section>

      <section class="insp-sec">
        <div class="insp-label">Deposit</div>
        <div class="recipe-line" title="The vault accepts every tier. Banked data is currency and can never be lost.">
          <span class="t">Any signal</span><span class="muted">→</span><span class="out">banked</span>
        </div>
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
  const fromName = from ? machineName(from) : '?';
  const toName = to ? machineName(to) : '?';
  const sourceRate = from ? nominalRate(state, from) : 0;
  const anchors = link.anchors || [];
  const anchor = anchorIndex >= 0 ? anchors[anchorIndex] : null;
  const priority = link.priority;

  tierVars(root, link.tier);

  const anchorBlock = anchor
    ? `
      <section class="insp-sec">
        <div class="insp-label">Anchor ${anchorIndex + 1}</div>
        <div class="stat-grid">
          ${statCell('X', String(Math.round(anchor.x)))}
          ${statCell('Y', String(Math.round(anchor.y)))}
          ${statCell('Grid', anchor.x % GRID.cell === 0 && anchor.y % GRID.cell === 0 ? 'snapped' : 'free')}
        </div>
        <div class="nudge-row">
          <button class="btn btn-quiet" data-action="nudge-anchor" data-dx="-1" data-dy="0" type="button" aria-label="Nudge anchor left">←</button>
          <button class="btn btn-quiet" data-action="nudge-anchor" data-dx="1" data-dy="0" type="button" aria-label="Nudge anchor right">→</button>
          <button class="btn btn-quiet" data-action="nudge-anchor" data-dx="0" data-dy="-1" type="button" aria-label="Nudge anchor up">↑</button>
          <button class="btn btn-quiet" data-action="nudge-anchor" data-dx="0" data-dy="1" type="button" aria-label="Nudge anchor down">↓</button>
        </div>
        <button class="btn btn-danger btn-block" data-action="remove-anchor" type="button">
          <svg aria-hidden="true"><use href="#i-trash"></use></svg>
          <span>Remove anchor</span>
        </button>
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
    <div class="insp-body">
      <section class="insp-sec">
        <div class="insp-label">Route</div>
        <div class="link-route">
          <span>${escapeHtml(fromName)}</span>
          <i class="route-line" aria-hidden="true"></i>
          <span>${escapeHtml(toName)}</span>
        </div>
        <div class="insp-actions">
          <button class="btn btn-quiet" data-action="add-anchor" type="button" title="Add a route point between the two machines, then drag it into place.">Add anchor</button>
          <button class="btn btn-quiet" data-action="clear-route" type="button" ${anchors.length ? '' : 'disabled'}>Clear route</button>
        </div>
      </section>

      ${anchorBlock}

      <section class="insp-sec">
        <div class="insp-label">Priority</div>
        <div class="seg" role="group" aria-label="Wire priority">
          <button class="seg-btn${priority === 0.5 ? ' is-active' : ''}" data-action="set-priority" data-priority="0.5" type="button">Low</button>
          <button class="seg-btn${priority === 1 ? ' is-active' : ''}" data-action="set-priority" data-priority="1" type="button">Normal</button>
          <button class="seg-btn${priority === 2 ? ' is-active' : ''}" data-action="set-priority" data-priority="2" type="button">High</button>
        </div>
      </section>

      <section class="insp-sec">
        <div class="stat-grid">
          ${statCell('Rate', fmtRate((link as { _flow?: number })._flow || 0), 'link-flow', 'Flow through this wire')}
          ${statCell('Source', fmtRate(sourceRate), '', 'Nominal rate of the feeding machine')}
          ${statCell('Anchors', String(anchors.length), '', 'Route points on this wire')}
        </div>
      </section>
    </div>
    <div class="insp-foot">
      <button class="btn btn-danger btn-block" data-action="remove-link" type="button">
        <svg aria-hidden="true"><use href="#i-trash"></use></svg>
        <span>Cut this wire</span>
      </button>
    </div>
  `;

  ui.live.linkFlow = root.querySelector('[data-live="link-flow"]');
}

function machineName(node: MachineNode): string {
  if (node.kind === 'vault') return 'The Vault';
  if (node.kind === 'extractor') return 'Raw Data Extractor';
  return `${dataInfo(node.tier).name} Processor`;
}

function wiringRows(state: State, node: MachineNode): WireEnd[] {
  const rows: WireEnd[] = [];
  const seen = new Set<number>();
  for (const link of state.links) {
    if (link.to !== node.id || seen.has(link.from)) continue;
    const source = nodeById(state, link.from);
    if (!source) continue;
    seen.add(link.from);
    rows.push({ dir: 'in', tier: link.tier, name: machineName(source) });
  }
  seen.clear();
  for (const link of state.links) {
    if (link.from !== node.id || seen.has(link.to)) continue;
    const target = nodeById(state, link.to);
    if (!target) continue;
    seen.add(link.to);
    rows.push({ dir: 'out', tier: link.tier, name: machineName(target) });
  }
  return rows;
}

function wiringHtml(state: State, node: MachineNode): string {
  const rows = wiringRows(state, node);
  if (!rows.length) {
    return '<p class="insp-note">No wires attached. Connect an output port to this machine.</p>';
  }
  const inbound = rows.filter((row) => row.dir === 'in');
  const outbound = rows.filter((row) => row.dir === 'out');
  const lines: string[] = [];
  for (const group of [inbound, outbound]) {
    if (!group.length) continue;
    for (const row of group.slice(0, WIRE_LIMIT)) {
      lines.push(wireRow(row));
    }
    if (group.length > WIRE_LIMIT) {
      lines.push(
        `<div class="wire-row wire-more"><span class="wire-dir"></span><span>+${group.length - WIRE_LIMIT} more</span></div>`,
      );
    }
  }
  return `<div class="wiring">${lines.join('')}</div>`;
}

function wireRow(row: WireEnd): string {
  return `<div class="wire-row">
    <span class="wire-dir">${row.dir === 'in' ? 'In' : 'Out'}</span>
    <i class="wire-dot" style="background:${tierHex(row.tier)}"></i>
    <span class="wire-name">${escapeHtml(row.name)}</span>
  </div>`;
}

function statCell(label: string, value: string, live = '', title = ''): string {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  const liveAttr = live ? ` data-live="${live}"` : '';
  return `<div class="stat"${titleAttr}><span class="stat-k">${escapeHtml(label)}</span><span class="stat-v"${liveAttr}>${escapeHtml(value)}</span></div>`;
}

function barRow(key: string, label: string, color: string, amount: number, cap: number): string {
  const share = cap > 0 ? Math.min(100, (amount / cap) * 100) : 0;
  return `<div class="bar-row" data-bar="${key}">
    <span class="bar-label">${escapeHtml(label)}</span>
    <div class="bar-track"><div class="bar-fill" style="--tier:${color};width:${share}%"></div></div>
    <span class="bar-val">${fmt(amount)} / ${fmt(cap)}</span>
  </div>`;
}
