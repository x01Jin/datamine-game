import {
  CONFIG,
  CORE_UPGRADES,
  coreUpgradeCost,
  dataInfo,
  deepScanReward,
  fmt,
  fmtRate,
  nominalRate,
  offlineCap,
  recipeFor,
  tierLabel,
} from '../game/gamedata.ts';
import { bankOf, currentCost, extractorCount } from '../game/actions.ts';
import { processorCopyCount } from '../game/state.ts';
import { directiveProgress } from '../game/directives.ts';
import type { MachineNode, NodeKind } from '../game/types.ts';
import {
  el,
  escapeHtml,
  glyphSvg,
  pct,
  recipeMarkup,
  setText,
  shortName,
  sortedBy,
  tierHex,
  tierVars,
} from './dom.ts';
import type { UI } from './ui.ts';

export interface BankLane {
  lane: HTMLElement;
  value: HTMLElement;
  weight: number;
}

export interface BuildCard {
  el: HTMLButtonElement;
  kind: NodeKind;
  tier: number | null;
  poor: boolean;
  armed: boolean;
  name: HTMLElement;
  owned: HTMLElement;
  meta: HTMLElement;
  recipe: HTMLElement;
  amount: HTMLElement;
  unit: HTMLElement;
}

export interface DirectiveCard {
  el: HTMLElement;
  title: HTMLElement;
  reward: HTMLElement;
  brief: HTMLElement;
  fill: HTMLElement;
  progress: HTMLElement;
  kind: HTMLElement;
}

export interface CoreRow {
  el: HTMLElement;
  rank: HTMLElement;
  price: HTMLElement;
  button: HTMLButtonElement;
}

export interface OpsRefs {
  cards: DirectiveCard[];
  coreRows: Map<string, CoreRow>;
}

export function bankTiers(ui: UI): number[] {
  const state = ui.app.state;
  const tiers = new Set<number>([0]);
  for (const [tier, amount] of Object.entries(state.bank)) {
    if (amount > 0.005) tiers.add(Number(tier));
  }
  tiers.add(state.unlockedTier);
  tiers.add(state.stats.deepestTier);
  return sortedBy(
    [...tiers].filter((tier) => Number.isInteger(tier) && tier >= 0),
    (a, b) => a - b,
  );
}

export function renderBank(ui: UI, force: boolean): void {
  const state = ui.app.state;
  const tiers = bankTiers(ui);
  const key = tiers.join(',');
  if (!force && key === ui.bankKeyCache) return;
  ui.bankKeyCache = key;

  const host = ui.refs.bank;
  host.textContent = '';
  ui.bankAmounts.clear();
  ui.bankLanes.clear();

  for (const tier of tiers) {
    const info = dataInfo(tier);
    const lane = el('button', 'bank-lane');
    lane.type = 'button';
    lane.dataset.tier = String(tier);
    lane.title = `${info.name} · tier ${tier}. Open in the codex.`;
    lane.setAttribute(
      'aria-label',
      `${info.name}, tier ${tier}, ${fmt(bankOf(state, tier))} banked. Open in the codex.`,
    );
    tierVars(lane, tier);

    const value = el('span', 'lane-value', fmt(bankOf(state, tier)));
    const tierTag = el('span', 'lane-tier', tierLabel(tier));
    const name = el('span', 'lane-name', shortName(info.name));
    const head = el('span', 'lane-head');
    head.append(name, tierTag);
    lane.append(head, value);
    host.append(lane);

    ui.bankAmounts.set(tier, value);
    ui.bankLanes.set(tier, { lane, value, weight: 0 });
  }

  const master = ui.refs.bankTotal;
  master.textContent = '';
  const masterHead = el('span', 'lane-head');
  masterHead.append(el('span', 'lane-name', 'Total banked'), el('span', 'lane-tier', 'ALL TIME'));
  const masterValue = el('span', 'lane-value', fmt(state.stats.totalBanked));
  master.append(masterHead, masterValue);
  ui.bankTotal = masterValue;

  updateBankWidths(ui, true);
}

export function updateBankWidths(ui: UI, force: boolean): void {
  const state = ui.app.state;
  const lanes = [...ui.bankLanes.entries()];
  if (!lanes.length) return;
  for (const [tier, lane] of lanes) {
    const amount = bankOf(state, tier);
    const empty = amount <= 0.005;
    if (!force && lane.weight === (empty ? 0 : 1)) continue;
    lane.weight = empty ? 0 : 1;
    lane.lane.classList.toggle('is-empty', empty);
  }
}

export function renderBuild(ui: UI): void {
  const state = ui.app.state;
  const list = ui.refs.buildList;

  let extractor = ui.buildCards.get('extractor');
  if (!extractor) {
    const card = el('button', 'build-card');
    card.type = 'button';
    card.dataset.kind = 'extractor';
    card.innerHTML = `
      <span class="card-glyph">${glyphSvg(0)}</span>
      <span class="card-text">
        <span class="card-title"><span class="card-name"></span><span class="card-owned"></span></span>
        <span class="card-meta"></span>
        <span class="card-recipe"></span>
      </span>
      <span class="card-cost"><b></b><small></small></span>
    `;
    list.append(card);
    extractor = {
      el: card,
      kind: 'extractor',
      tier: null,
      poor: false,
      armed: false,
      name: card.querySelector('.card-name') as HTMLElement,
      owned: card.querySelector('.card-owned') as HTMLElement,
      meta: card.querySelector('.card-meta') as HTMLElement,
      recipe: card.querySelector('.card-recipe') as HTMLElement,
      amount: card.querySelector('.card-cost b') as HTMLElement,
      unit: card.querySelector('.card-cost small') as HTMLElement,
    };
    ui.buildCards.set('extractor', extractor);
  }

  for (let tier = 1; tier <= state.unlockedTier; tier++) {
    if (ui.buildCards.has(`p${tier}`)) continue;
    const card = el('button', 'build-card');
    card.type = 'button';
    card.dataset.kind = 'processor';
    card.dataset.tier = String(tier);
    card.innerHTML = `
      <span class="card-glyph">${glyphSvg(tier)}</span>
      <span class="card-text">
        <span class="card-title"><span class="card-name"></span><span class="card-owned"></span></span>
        <span class="card-meta"></span>
        <span class="card-recipe"></span>
      </span>
      <span class="card-cost"><b></b><small></small></span>
    `;
    list.append(card);
    ui.buildCards.set(`p${tier}`, {
      el: card,
      kind: 'processor',
      tier,
      poor: false,
      armed: false,
      name: card.querySelector('.card-name') as HTMLElement,
      owned: card.querySelector('.card-owned') as HTMLElement,
      meta: card.querySelector('.card-meta') as HTMLElement,
      recipe: card.querySelector('.card-recipe') as HTMLElement,
      amount: card.querySelector('.card-cost b') as HTMLElement,
      unit: card.querySelector('.card-cost small') as HTMLElement,
    });
  }

  for (const [key, entry] of ui.buildCards) {
    if (entry.kind === 'extractor') continue;
    if ((entry.tier ?? 0) > state.unlockedTier) {
      entry.el.remove();
      ui.buildCards.delete(key);
    }
  }

  for (const entry of ui.buildCards.values()) {
    const { el: card, kind, tier } = entry;
    const cost = currentCost(state, kind, tier);
    const info = kind === 'extractor' ? dataInfo(0) : dataInfo(tier ?? 0);
    tierVars(card, kind === 'extractor' ? 0 : (tier ?? 0));

    if (kind === 'extractor') {
      setText(entry.name, 'Extractor');
      setText(entry.owned, `×${extractorCount(state)}`);
      setText(
        entry.meta,
        `T00 · ${fmtRate(nominalRate(state, { kind: 'extractor', level: 1 } as MachineNode))}`,
      );
      setText(entry.recipe, 'Extracts Raw Noise');
      card.title = `Add an extractor. Cost: ${fmt(cost.amount)} ${info.name}. Produces Raw Noise.`;
    } else {
      const recipe = recipeFor(tier ?? 1);
      const inputs = (recipe?.inputs ?? [])
        .map((input) => `${input.amount}× ${dataInfo(input.tier).name}`)
        .join(' + ');
      setText(entry.name, `${info.name} Forge`);
      setText(entry.owned, `×${processorCopyCount(state, tier ?? 0)}`);
      setText(
        entry.meta,
        `${tierLabel(tier ?? 0)} · ${fmtRate(
          nominalRate(state, { kind: 'processor', tier: tier ?? 1, level: 1 } as MachineNode),
        )}`,
      );
      setText(entry.recipe, `${inputs} → ${info.name}`);
      card.title = `${inputs} → 1 ${info.name}. Cost: ${fmt(cost.amount)} ${info.name}.`;
    }

    setText(entry.amount, fmt(cost.amount));
    setText(entry.unit, dataInfo(cost.tier).name);
    entry.unit.style.color = tierHex(cost.tier);
  }
}

export function renderNextLock(ui: UI): void {
  const state = ui.app.state;
  const current = dataInfo(state.unlockedTier);
  const next = state.unlockedTier + 1;
  const maxed = state.unlockedTier >= CONFIG.maxTier;
  ui.refs.nextLock.innerHTML = maxed
    ? `<svg aria-hidden="true"><use href="#i-lock"></use></svg><span><b>Deep archive reached.</b> Everything you have banked still compounds.</span>`
    : `<svg aria-hidden="true"><use href="#i-lock"></use></svg><span><b>${tierLabel(next)} sealed.</b> Bank ${escapeHtml(current.name)} to reveal the next signal.</span>`;
}

export function renderCodex(ui: UI, scroll: boolean): void {
  const state = ui.app.state;
  const list = ui.refs.codexList;
  const previousScroll = ui.refs.codexView.scrollTop;
  list.textContent = '';
  ui.codexAmounts.clear();
  const top = state.unlockedTier;

  for (let tier = 0; tier <= top; tier++) {
    const info = dataInfo(tier);
    const row = el('div', `codex-row${tier === top ? ' is-current' : ''}`);
    row.id = `codex-tier-${tier}`;
    tierVars(row, tier);
    const recipe = tier === 0 ? 'Extracted from the network.' : recipeMarkup(tier);
    row.innerHTML = `
      <span class="codex-head">
        <span class="codex-name">${escapeHtml(info.name)}</span>
        <span class="codex-tier">${tierLabel(tier)}</span>
      </span>
      <span class="codex-bank">${fmt(bankOf(state, tier))}</span>
      <span class="codex-recipe">${recipe}</span>
    `;
    ui.codexAmounts.set(tier, row.querySelector('.codex-bank') as HTMLElement);
    list.append(row);
  }

  if (top < CONFIG.maxTier) {
    const next = el('div', 'codex-row is-locked');
    next.innerHTML = `
      <span class="codex-head">
        <span class="codex-name">? ? ?</span>
        <span class="codex-tier">${tierLabel(top + 1)}</span>
      </span>
      <span class="codex-bank"></span>
      <span class="codex-recipe"><span class="t">Bank ${escapeHtml(dataInfo(top).name)} to reveal.</span></span>
    `;
    list.append(next);
  }

  requestAnimationFrame(() => {
    if (scroll && ui.tab === 'codex') ui.refs.codexView.scrollTop = ui.refs.codexView.scrollHeight;
    else ui.refs.codexView.scrollTop = previousScroll;
  });
}

export function renderOps(ui: UI): void {
  if (!ui.ops) {
    const cards: DirectiveCard[] = [];
    const list = ui.refs.directiveList;
    list.textContent = '';
    for (let i = 0; i < CONFIG.directiveCount; i++) {
      const card = el('article', 'dispatch-row');
      card.innerHTML = `
        <div class="dispatch-top">
          <span class="dispatch-title"></span>
          <span class="dispatch-reward"></span>
        </div>
        <p class="dispatch-brief"></p>
        <div class="dispatch-rule" role="presentation"><i></i></div>
        <div class="dispatch-foot">
          <span class="dispatch-progress"></span>
          <span class="dispatch-tag"></span>
        </div>
      `;
      list.append(card);
      cards.push({
        el: card,
        title: card.querySelector('.dispatch-title') as HTMLElement,
        reward: card.querySelector('.dispatch-reward') as HTMLElement,
        brief: card.querySelector('.dispatch-brief') as HTMLElement,
        fill: card.querySelector('.dispatch-rule i') as HTMLElement,
        progress: card.querySelector('.dispatch-progress') as HTMLElement,
        kind: card.querySelector('.dispatch-tag') as HTMLElement,
      });
    }

    const coreRows = new Map<string, CoreRow>();
    const coreList = ui.refs.coreList;
    coreList.textContent = '';
    for (const upgrade of CORE_UPGRADES) {
      const row = el('div', 'core-row');
      row.innerHTML = `
        <div class="core-info">
          <span class="core-name">${escapeHtml(upgrade.name)}</span>
          <span class="core-rank"></span>
          <span class="core-effect">${escapeHtml(upgrade.effect)}</span>
        </div>
        <button class="btn btn-quiet core-buy" data-core="${upgrade.id}" type="button">
          <span class="price"></span>
        </button>
      `;
      coreList.append(row);
      coreRows.set(upgrade.id, {
        el: row,
        rank: row.querySelector('.core-rank') as HTMLElement,
        price: row.querySelector('.price') as HTMLElement,
        button: row.querySelector('.core-buy') as HTMLButtonElement,
      });
    }

    ui.ops = { cards, coreRows };
  }
  updateOps(ui);
}

export function updateOps(ui: UI): void {
  if (!ui.ops) return;
  const state = ui.app.state;

  for (let i = 0; i < ui.ops.cards.length; i++) {
    const card = ui.ops.cards[i];
    const directive = state.directives[i];
    if (!directive) {
      card.el.hidden = true;
      continue;
    }
    card.el.hidden = false;
    const raw = directive as unknown as {
      kind: string;
      tier: number;
      goal: number;
      title: string;
      brief: string;
      reward: { tier: number; amount: number };
      cores: number;
    };
    const progress = directiveProgress(state, directive);
    const ratio = pct(progress, raw.goal);
    setText(card.title, raw.title);
    setText(card.brief, raw.brief);
    setText(card.kind, raw.kind.toUpperCase());
    card.fill.style.width = `${ratio}%`;
    card.el.classList.toggle('is-done', progress >= raw.goal);
    tierVars(card.el, raw.tier);

    const reward = raw.reward || { tier: 0, amount: 0 };
    const rewardText = reward.amount > 0 ? `+${fmt(reward.amount)} ${dataInfo(reward.tier).name}` : '';
    const coreText = raw.cores > 0 ? ` · ${raw.cores} core${raw.cores === 1 ? '' : 's'}` : '';
    setText(card.reward, `${rewardText}${coreText}`);
    setText(
      card.progress,
      raw.kind === 'uptime'
        ? `${Math.floor(progress)}s / ${fmt(raw.goal)}s`
        : `${fmt(progress)} / ${fmt(raw.goal)}`,
    );
  }

  for (const upgrade of CORE_UPGRADES) {
    const row = ui.ops.coreRows.get(upgrade.id);
    if (!row) continue;
    const rank = state.coreRanks[upgrade.id as keyof typeof state.coreRanks] || 0;
    const maxed = rank >= upgrade.max;
    const cost = coreUpgradeCost(upgrade, rank);
    setText(row.rank, maxed ? 'MAXED' : `RANK ${rank}`);
    setText(row.price, maxed ? '' : `→ ${cost} core${cost === 1 ? '' : 's'}`);
    row.button.disabled = maxed || state.cores < cost;
    row.el.classList.toggle('is-maxed', maxed);
  }

  setText(ui.refs.coreBalance, `${state.cores}`);
  const gain = deepScanReward(state);
  const unlocked = state.stats.deepestTier >= CONFIG.deepScanTier;
  ui.refs.deepScan.disabled = !unlocked;
  setText(
    ui.refs.deepScanHint,
    unlocked
      ? `Rebuilds the refinery for ${gain} core${gain === 1 ? '' : 's'}. Cores and ranks carry over.`
      : `Unlocks at tier ${CONFIG.deepScanTier}. Current depth: ${tierLabel(state.stats.deepestTier)}.`,
  );
  ui.refs.deepScanHint.classList.toggle('is-locked', !unlocked);
  setText(
    ui.refs.archiveNote,
    state.stats.scans > 0
      ? `${state.stats.scans} deep scan${state.stats.scans === 1 ? '' : 's'} · best depth ${tierLabel(state.stats.bestDeepest)} · offline cap ${Math.round(offlineCap(state) / 3600)}h`
      : 'Cores survive every deep scan.',
  );
}

export function updateHint(ui: UI): void {
  const state = ui.app.state;
  if (state.hintDismissed) {
    ui.refs.hint.classList.add('is-hidden');
    return;
  }
  ui.refs.hint.classList.remove('is-hidden');
  const tier1 = state.nodes.find((node) => node.kind === 'processor' && node.tier === 1);
  const hasLink = state.links.length > 0;
  const rawInto1 = Boolean(tier1) && state.links.some((link) => link.to === tier1?.id);
  const outOf1 = Boolean(tier1) && state.links.some((link) => link.from === tier1?.id);
  const busy = state.nodes.find(
    (node) => node.kind !== 'vault' && ((node as { _util?: number })._util || 0) >= 0.995,
  );
  const outCount = new Map<number, number>();
  for (const link of state.links) outCount.set(link.from, (outCount.get(link.from) || 0) + 1);
  const shared = [...outCount.values()].some((count) => count > 1);

  let text: string;
  if (ui.app.view.linkDraft) {
    text =
      'Click the board to drop wire points, then click an input port. Right-click undoes the last point, Esc cancels.';
  } else if (!hasLink) {
    text = "Click the extractor's output port, then the vault's input port, to bank raw noise.";
  } else if (state.unlockedTier === 1 && !tier1) {
    text = 'Raw noise is banked and spendable. Build a Clean Bits forge from the panel.';
  } else if (tier1 && !rawInto1) {
    text = 'Wire raw noise into the Clean Bits forge.';
  } else if (tier1 && !outOf1) {
    text = "Send the forge's output into the vault to bank Clean Bits.";
  } else if (state.unlockedTier === 2) {
    text = 'A Signals forge is open. It wants Clean Bits and raw noise.';
  } else if (busy) {
    text = 'That machine is running at 100%. Overclock it to widen the flow.';
  } else if (shared) {
    text = "One output feeds several wires. Set a wire's priority to decide who is served first.";
  } else if (state.links.some((link) => (link.anchors || []).length > 0)) {
    text = 'Click an output port, then click the board to lay out points, then click an input port.';
  } else {
    text =
      'Each new signal opens a deeper tier. Scale whatever runs starved; dismantling refunds everything.';
  }

  if (text !== ui.lastHint) {
    ui.lastHint = text;
    setText(ui.refs.hintText, text);
  }
}
