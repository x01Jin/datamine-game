import {
  CONFIG, dataInfo, recipeFor, speedOf, bufferCap, nominalRate, fmt, fmtRate,
  tierLabel, upgradeCost, normalizePriority,
} from './gamedata.js';
import { GRID } from './layout.js';
import { nodeById, linkById } from './state.js';
import { canAfford, creditsLabel } from './actions.js';
import { nodeStatus } from './sim.js';
import { glyphSvg } from './glyphs.js';
import { escapeHtml, STATUS_TEXT, recipeHtml as sharedRecipeHtml } from './dom.js';

export function buildInspector(ui, selection) {
  const state = ui.app.state;
  const root = ui.refs.inspector;
  ui.live = { bars: {} };
  root.style.removeProperty('--tier');

  if (selection.kind === 'link') {
    buildLink(ui, linkById(state, selection.id));
    return;
  }
  if (selection.kind === 'anchor') {
    const link = linkById(state, selection.linkId);
    if (!link) {
      ui.app.view.selection = null;
      return;
    }
    buildLink(ui, link, selection.index);
    return;
  }
  const node = nodeById(state, selection.id);
  if (!node) return;
  if (node.kind === 'vault') buildVault(ui, node);
  else buildNode(ui, node);
}

function buildNode(ui, node) {
  const state = ui.app.state;
  const root = ui.refs.inspector;
  const tier = node.kind === 'extractor' ? 0 : node.tier;
  const info = dataInfo(tier);
  const isExtractor = node.kind === 'extractor';
  const title = isExtractor ? 'Extractor' : `${info.name} Forge`;
  const kicker = isExtractor ? `Miner · ${tierLabel(0)}` : `Forge · ${tierLabel(tier)}`;
  const status = nodeStatus(state, node);
  const util = node._util || 0;
  const cap = bufferCap(state, node);
  const speed = speedOf(state, node);
  const cost = upgradeCost(node);
  const atMax = node.level >= CONFIG.maxLevel;
  const can = !atMax && canAfford(state, cost);

  setTier(root, info);

  const recipe = isExtractor ? null : recipeFor(node.tier);
  let recipeHtml;
  let recipeNote;
  if (isExtractor) {
    recipeHtml = '<span class="t">Raw Noise</span><span class="muted">from the network</span>';
    recipeNote = 'Mines raw noise continuously. Raw noise buys extractors and feeds the first forge.';
  } else {
    recipeHtml = sharedRecipeHtml(node.tier);
    const actualCycle = recipe.cycle / speed;
    recipeNote = `One cycle every ${fmt(actualCycle)}s. Buffer holds ${fmt(cap)} of each stream.`;
  }

  const bars = [];
  if (recipe) {
    for (const input of recipe.inputs) {
      const inputInfo = dataInfo(input.tier);
      bars.push(barRow(`in-${input.tier}`, `${tierLabel(input.tier)} in`, inputInfo.color, node.inputs[input.tier] || 0, cap));
    }
  }
  bars.push(barRow('out', isExtractor ? 'out' : 'output', info.color, node.out.amount || 0, cap));

  root.innerHTML = `
    <div class="insp-head">
      <span class="insp-glyph">${glyphSvg(tier)}</span>
      <div class="insp-title"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(kicker)}</p></div>
      <button class="icon-btn" data-action="close" aria-label="Close inspector">
        <svg><use href="#i-close"></use></svg>
      </button>
    </div>
    <div class="insp-scroll">
      <section class="insp-section">
        <div class="insp-label">Status</div>
        <div class="status-row is-${status}" data-live="status">
          <span class="status-dot"></span>
          <span class="status-text">${STATUS_TEXT[status] || status}</span>
          <span class="status-util">${Math.round(util * 100)}%</span>
        </div>
        <div class="meter"><i data-live="util" style="width:${Math.min(100, util * 100)}%"></i></div>
      </section>

      <section class="insp-section">
        <div class="insp-label">Recipe</div>
        <div class="recipe-line">${recipeHtml}</div>
        <div class="insp-recipe-note">${recipeNote}</div>
      </section>

      <section class="insp-section">
        <div class="insp-label">Buffers</div>
        <div class="bars">${bars.join('')}</div>
      </section>

      <section class="insp-section">
        <div class="insp-label">Flow</div>
        <div class="kv">
          <div class="kv-row"><span>Nominal</span><b>${fmtRate(nominalRate(state, node))}</b></div>
          <div class="kv-row"><span>Outbound</span><b data-live="flow">${fmtRate(node._flowOut || 0)}</b></div>
          <div class="kv-row"><span>Level</span><b>L${node.level} · ×${fmt(speed)} speed</b></div>
        </div>
      </section>

      <section class="insp-section">
        <div class="insp-label">Overclock</div>
        <div class="upgrade-box">
          <div class="upgrade-top"><span>${atMax ? `Level ${node.level}` : `Level ${node.level} → ${node.level + 1}`}</span><b>${atMax ? 'MAX' : '+50% speed'}</b></div>
          <button class="btn btn-primary btn-block" data-action="upgrade" ${can ? '' : 'disabled'}>
            <span>${atMax ? 'Fully overclocked' : 'Overclock'}</span>${atMax ? '' : `<span class="price">${fmt(cost.amount)} ${escapeHtml(dataInfo(cost.tier).name)}</span>`}
          </button>
          <div class="upgrade-delta">${atMax ? 'This machine cannot be overclocked further.' : `Cost doubles each level · paid in ${escapeHtml(dataInfo(cost.tier).name)}`}</div>
        </div>
      </section>

      <section class="insp-section">
        <div class="insp-label">Salvage</div>
        <button class="btn btn-danger-quiet btn-icon-label" data-action="dismantle" title="Refund: ${escapeHtml(creditsLabel(node.invested))}">
          <svg><use href="#i-trash"></use></svg>
          <span>Dismantle · refund ${escapeHtml(creditsLabel(node.invested))}</span>
        </button>
        <div class="insp-recipe-note">Full refund. Wires attached to this machine are removed.</div>
      </section>
    </div>
  `;

  ui.live.statusRow = root.querySelector('[data-live="status"]');
  ui.live.statusText = root.querySelector('[data-live="status"] .status-text');
  ui.live.utilText = root.querySelector('[data-live="status"] .status-util');
  ui.live.utilBar = root.querySelector('[data-live="util"]');
  ui.live.flowOut = root.querySelector('[data-live="flow"]');
  ui.live.upgradeBtn = root.querySelector('[data-action="upgrade"]');
  ui.live.upgradeBtn._cost = atMax ? null : cost;
  for (const row of root.querySelectorAll('.bar-row')) {
    ui.live.bars[row.dataset.bar] = {
      fill: row.querySelector('.bar-fill'),
      val: row.querySelector('.bar-val'),
    };
  }
}

export function vaultLedger(state) {
  const entries = Object.entries(state.bank)
    .filter(([, amount]) => Number.isFinite(amount) && amount > 0.005)
    .map(([tier, amount]) => ({ tier: Number(tier), amount, info: dataInfo(Number(tier)) }))
    .sort((a, b) => b.amount - a.amount);
  return {
    entries,
    types: entries.length,
    units: entries.reduce((sum, entry) => sum + entry.amount, 0),
  };
}

export function holdingsHtml(entries) {
  if (!entries.length) {
    return '<div class="kv-row"><span>No signals banked</span><b>0</b></div>';
  }
  return entries.map((entry) => `
    <div class="kv-row" data-holding="${entry.tier}">
      <span style="display:inline-flex;align-items:center;gap:6px"><i style="width:6px;height:6px;border-radius:50%;background:${entry.info.color};display:inline-block"></i>${escapeHtml(entry.info.name)}</span>
      <b data-live="holding-${entry.tier}">${fmt(entry.amount)}</b>
    </div>
  `).join('');
}

function buildVault(ui, node) {
  const state = ui.app.state;
  const root = ui.refs.inspector;
  let incoming = 0;
  let wires = 0;
  for (const link of state.links) {
    if (link.to === node.id) {
      wires++;
      incoming += link._flow || 0;
    }
  }
  const ledger = vaultLedger(state);
  const status = incoming > 0 ? 'receiving' : 'idle';

  setTier(root, dataInfo(0));
  root.style.setProperty('--tier', 'var(--bone)');
  root.style.setProperty('--tier-soft', 'rgba(233,223,199,.06)');
  root.style.setProperty('--tier-border', 'rgba(233,223,199,.32)');

  const holdings = holdingsHtml(ledger.entries.slice(0, 6));

  root.innerHTML = `
    <div class="insp-head">
      <span class="insp-glyph">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" aria-hidden="true">
          <rect x="2.2" y="2.2" width="11.6" height="11.6"/>
          <circle cx="8" cy="8" r="3.1"/>
          <path d="M8 5.2v5.6M5.2 8h5.6"/>
        </svg>
      </span>
      <div class="insp-title"><h2>The Vault</h2><p>Depository · permanent</p></div>
      <button class="icon-btn" data-action="close" aria-label="Close inspector">
        <svg><use href="#i-close"></use></svg>
      </button>
    </div>
    <div class="insp-scroll">
      <section class="insp-section">
        <div class="insp-label">Status</div>
        <div class="status-row is-${status}" data-live="status">
          <span class="status-dot"></span>
          <span class="status-text">${status === 'receiving' ? 'Receiving' : 'Idle'}</span>
          <span class="status-util">${wires} wire${wires === 1 ? '' : 's'}</span>
        </div>
      </section>

      <section class="insp-section">
        <div class="insp-label">Ledger</div>
        <div class="kv">
          <div class="kv-row"><span>Signal types</span><b data-live="types">${ledger.types}</b></div>
          <div class="kv-row"><span>Units held</span><b data-live="units">${fmt(ledger.units)}</b></div>
          <div class="kv-row"><span>Incoming</span><b data-live="incoming">${fmtRate(incoming)}</b></div>
          <div class="kv-row"><span>Wires</span><b>${wires}</b></div>
        </div>
        <div class="insp-recipe-note">Each signal type is tracked separately. Units of one type are not interchangeable with another.</div>
      </section>

      <section class="insp-section"><div class="insp-label">Holdings</div><div class="kv" data-live="holdings">${holdings}</div></section>

      <section class="insp-section">
        <div class="insp-label">Deposit</div>
        <div class="recipe-line"><span class="t">Any signal</span><span class="muted">→</span><span class="out">banked</span></div>
        <div class="insp-recipe-note">The vault accepts every tier. Banked data is currency and can never be lost.</div>
      </section>

      <section class="insp-section">
        <div class="insp-label">Anchor</div>
        <div class="insp-recipe-note">The vault is permanent. It cannot be dismantled or moved. It holds the entire bank.</div>
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

function buildLink(ui, link, anchorIndex = -1) {
  if (!link) return;
  const state = ui.app.state;
  const root = ui.refs.inspector;
  const info = dataInfo(link.tier);
  const from = nodeById(state, link.from);
  const to = nodeById(state, link.to);
  const fromName = from ? (from.kind === 'extractor' ? 'Extractor' : dataInfo(from.out?.tier ?? 0).name) : '?';
  const toName = to ? (to.kind === 'vault' ? 'The Vault' : `${dataInfo(to.tier).name} Forge`) : '?';
  const sourceRate = from ? nominalRate(state, from) : 0;
  const anchors = link.anchors || [];
  const anchor = anchorIndex >= 0 ? anchors[anchorIndex] : null;
  const priority = normalizePriority(link.priority);

  setTier(root, info);

  const anchorSection = anchor ? `
      <section class="insp-section">
        <div class="insp-label">Anchor ${anchorIndex + 1}</div>
        <div class="kv">
          <div class="kv-row"><span>Position</span><b>${Math.round(anchor.x)}, ${Math.round(anchor.y)}</b></div>
          <div class="kv-row"><span>Grid</span><b>${anchor.x % GRID.cell === 0 && anchor.y % GRID.cell === 0 ? 'snapped' : 'free'}</b></div>
        </div>
        <div class="nudge-row">
          <button class="btn btn-quiet" data-action="nudge-anchor" data-dx="-1" data-dy="0">←</button>
          <button class="btn btn-quiet" data-action="nudge-anchor" data-dx="1" data-dy="0">→</button>
          <button class="btn btn-quiet" data-action="nudge-anchor" data-dx="0" data-dy="-1">↑</button>
          <button class="btn btn-quiet" data-action="nudge-anchor" data-dx="0" data-dy="1">↓</button>
        </div>
        <button class="btn btn-danger-quiet btn-icon-label" data-action="remove-anchor">
          <svg><use href="#i-trash"></use></svg>
          <span>Remove this anchor</span>
        </button>
        <div class="insp-recipe-note">Drag the handle on the board, or nudge it here. Right-click a handle removes it.</div>
      </section>
    ` : '';

  root.innerHTML = `
    <div class="insp-head">
      <span class="insp-glyph">${glyphSvg(link.tier)}</span>
      <div class="insp-title"><h2>${escapeHtml(info.name)} Wire</h2><p>Link · ${tierLabel(link.tier)}</p></div>
      <button class="icon-btn" data-action="close" aria-label="Close inspector">
        <svg><use href="#i-close"></use></svg>
      </button>
    </div>
    <div class="insp-scroll">
      <section class="insp-section">
        <div class="insp-label">Route</div>
        <div class="link-route">
          <span>${escapeHtml(fromName)}</span>
          <i class="route-line"></i>
          <span>${escapeHtml(toName)}</span>
        </div>
        <div class="kv">
          <div class="kv-row"><span>Anchors</span><b>${anchors.length}</b></div>
        </div>
        <div class="insp-actions">
          <button class="btn btn-quiet" data-action="add-anchor">Add anchor</button>
          <button class="btn btn-quiet" data-action="clear-route" ${anchors.length ? '' : 'disabled'}>Clear route</button>
        </div>
        <div class="insp-recipe-note">Click an output port, then click the board to lay out points, then click an input port. Double-click a wire to drop an anchor. Right-click a handle removes it.</div>
      </section>

      ${anchorSection}

      <section class="insp-section">
        <div class="insp-label">Priority</div>
        <div class="seg" role="group" aria-label="Wire priority">
          <button class="seg-btn${priority === 0.5 ? ' is-active' : ''}" data-action="set-priority" data-priority="0.5">Low</button>
          <button class="seg-btn${priority === 1 ? ' is-active' : ''}" data-action="set-priority" data-priority="1">Normal</button>
          <button class="seg-btn${priority === 2 ? ' is-active' : ''}" data-action="set-priority" data-priority="2">High</button>
        </div>
        <div class="insp-recipe-note">When one output feeds several inputs, each wire takes a share of the flow. High priority wires are served first.</div>
      </section>

      <section class="insp-section">
        <div class="insp-label">Throughput</div>
        <div class="link-flow" data-live="link-flow">${fmtRate(link._flow || 0)}</div>
        <div class="kv">
          <div class="kv-row"><span>Source nominal</span><b>${fmtRate(sourceRate)}</b></div>
          <div class="kv-row"><span>Payload</span><b>${escapeHtml(info.name)}</b></div>
        </div>
      </section>

      <section class="insp-section">
        <div class="insp-label">Remove</div>
        <button class="btn btn-danger-quiet btn-icon-label" data-action="remove-link">
          <svg><use href="#i-trash"></use></svg>
          <span>Cut this wire</span>
        </button>
        <div class="insp-recipe-note">The machines stay online. Nothing is refunded for wires.</div>
      </section>
    </div>
  `;

  ui.live.linkFlow = root.querySelector('[data-live="link-flow"]');
}

function setTier(root, info) {
  root.style.setProperty('--tier', info.color);
  root.style.setProperty('--tier-soft', info.soft);
  root.style.setProperty('--tier-border', info.dim);
}

function barRow(key, label, color, amount, cap) {
  const pct = cap > 0 ? Math.min(100, amount / cap * 100) : 0;
  return `<div class="bar-row" data-bar="${key}">
    <span class="bar-label">${escapeHtml(label)}</span>
    <div class="bar-track"><div class="bar-fill" style="--tier:${color};width:${pct}%"></div></div>
    <span class="bar-val">${fmt(amount)} / ${fmt(cap)}</span>
  </div>`;
}
