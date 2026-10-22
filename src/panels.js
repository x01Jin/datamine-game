import {
  CONFIG, CORE_UPGRADES, dataInfo, recipeFor, nominalRate, fmt, fmtRate,
  tierLabel, costText, coreUpgradeCost, deepScanReward, offlineCap,
} from './gamedata.js';
import { currentCost, extractorCount, bankOf } from './actions.js';
import { processorCopyCount } from './state.js';
import { glyphSvg } from './glyphs.js';
import { directiveProgress } from './directives.js';
import { escapeHtml, shortName, pct, recipeHtml } from './dom.js';

export function renderBank(ui, force) {
  const state = ui.app.state;
  const list = ui.bankKey(state).split(',').filter((tier) => tier !== '').map(Number);

  const key = list.join(',');
  if (!force && key === ui.bankKeys) return;
  ui.bankKeys = key;

  const scrollLeft = ui.refs.bank.scrollLeft;
  ui.refs.bank.textContent = '';
  ui.bankAmounts.clear();
  for (const tier of list) {
    const info = dataInfo(tier);
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.dataset.tier = tier;
    chip.title = `${info.name} · Tier ${tier}`;
    chip.setAttribute('aria-label', `${info.name}, tier ${tier}. Open in codex.`);
    chip.style.setProperty('--tier', info.color);
    chip.innerHTML = `<span class="chip-glyph"></span><span class="chip-name">${escapeHtml(shortName(info.name))}</span><span class="chip-amount">${fmt(bankOf(state, tier))}</span>`;
    ui.refs.bank.append(chip);
    ui.bankAmounts.set(tier, chip.querySelector('.chip-amount'));
  }
  ui.refs.bank.scrollLeft = scrollLeft;
}

export function renderBuild(ui) {
  const state = ui.app.state;
  const list = ui.refs.buildList;
  const scroll = list.closest('.panel-scroll');
  const previousScroll = scroll ? scroll.scrollTop : 0;
  const atBottom = scroll ? scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40 : true;

  let extractor = ui.buildCards.get('extractor')?.el;
  if (!extractor) {
    extractor = document.createElement('button');
    extractor.className = 'build-card';
    extractor.dataset.kind = 'extractor';
    extractor.innerHTML = `
      <span class="build-glyph">${glyphSvg(0)}</span>
      <span class="build-info">
        <span class="build-name"><span class="name">Extractor</span> <span class="owned"></span></span>
        <span class="build-sub"></span>
        <span class="build-recipe">Extracts Raw Noise</span>
      </span>
      <span class="build-cost"><b></b><small></small></span>
    `;
    list.append(extractor);
    ui.buildCards.set('extractor', {
      el: extractor,
      kind: 'extractor',
      tier: null,
      refs: {
        owned: extractor.querySelector('.owned'),
        sub: extractor.querySelector('.build-sub'),
        amount: extractor.querySelector('.build-cost b'),
        unit: extractor.querySelector('.build-cost small'),
      },
    });
  }

  for (let tier = 1; tier <= state.unlockedTier; tier++) {
    if (ui.buildCards.has(`p${tier}`)) continue;
    const info = dataInfo(tier);
    const card = document.createElement('button');
    card.className = 'build-card';
    card.dataset.kind = 'processor';
    card.dataset.tier = tier;
    card.innerHTML = `
      <span class="build-glyph">${glyphSvg(tier)}</span>
      <span class="build-info">
        <span class="build-name"><span class="name"></span> <span class="owned"></span></span>
        <span class="build-sub"></span>
        <span class="build-recipe"></span>
      </span>
      <span class="build-cost"><b></b><small></small></span>
    `;
    card.style.setProperty('--tier', info.color);
    card.style.setProperty('--tier-soft', info.soft);
    card.style.setProperty('--tier-border', info.color.replace(/[\d.]+\)$/, '0.32)'));
    list.append(card);
    ui.buildCards.set(`p${tier}`, {
      el: card,
      kind: 'processor',
      tier,
      refs: {
        name: card.querySelector('.build-name .name'),
        owned: card.querySelector('.owned'),
        sub: card.querySelector('.build-sub'),
        recipe: card.querySelector('.build-recipe'),
        amount: card.querySelector('.build-cost b'),
        unit: card.querySelector('.build-cost small'),
      },
    });
  }

  for (const [key, entry] of ui.buildCards) {
    if (entry.kind === 'extractor') continue;
    if (entry.tier > state.unlockedTier) {
      entry.el.remove();
      ui.buildCards.delete(key);
    }
  }

  for (const entry of ui.buildCards.values()) {
    const { el, kind, tier, refs } = entry;
    const cost = currentCost(state, kind, tier);
    const info = kind === 'extractor' ? dataInfo(0) : dataInfo(tier);
    el.style.setProperty('--tier', info.color);
    el.style.setProperty('--tier-soft', info.soft);
    el.style.setProperty('--tier-border', info.color.replace(/[\d.]+\)$/, '0.32)'));
    if (kind === 'extractor') {
      refs.owned.textContent = `×${extractorCount(state)}`;
      refs.sub.textContent = `Raw Noise · ${fmtRate(nominalRate(state, { kind: 'extractor', level: 1 }))}`;
      el.title = `Add an extractor. Cost: ${costText(cost)}. Produces Raw Noise.`;
    } else {
      const recipe = recipeFor(tier);
      const recipeText = recipe.inputs.map((input) => `${input.amount} ${dataInfo(input.tier).name}`).join(' + ');
      refs.name.textContent = `${info.name} Forge`;
      refs.owned.textContent = `×${processorCopyCount(state, tier)}`;
      refs.sub.textContent = `${tierLabel(tier)} · ${fmtRate(nominalRate(state, { kind: 'processor', tier, level: 1 }))}`;
      const recipeLabel = `${recipeText} → ${info.name}`;
      if (refs.recipe.textContent !== recipeLabel) refs.recipe.textContent = recipeLabel;
      el.title = `${recipeText} → 1 ${info.name}. Cost: ${costText(cost)}.`;
    }
    const costTextValue = fmt(cost.amount);
    if (refs.amount.textContent !== costTextValue) refs.amount.textContent = costTextValue;
    const costInfo = dataInfo(cost.tier);
    if (refs.unit.textContent !== costInfo.name) refs.unit.textContent = costInfo.name;
    refs.unit.style.color = costInfo.color;
  }

  if (scroll) {
    requestAnimationFrame(() => {
      scroll.scrollTop = atBottom ? scroll.scrollHeight : previousScroll;
    });
  }
}

export function renderNextLock(ui) {
  const state = ui.app.state;
  const current = dataInfo(state.unlockedTier);
  const next = state.unlockedTier + 1;
  const maxed = state.unlockedTier >= CONFIG.maxTier;
  ui.refs.nextLock.innerHTML = maxed
    ? `
      <svg><use href="#i-lock"></use></svg>
      <span><b>Deep archive reached.</b> Everything you have banked still compounds.</span>
    `
    : `
      <svg><use href="#i-lock"></use></svg>
      <span><b>${tierLabel(next)} sealed.</b> Bank ${escapeHtml(current.name)} to reveal the next signal.</span>
    `;
}

export function renderCodex(ui, scroll = false) {
  const state = ui.app.state;
  const list = ui.refs.codexList;
  const previousScroll = ui.refs.codexView.scrollTop;
  list.textContent = '';
  ui.codexAmounts.clear();
  const top = state.unlockedTier;

  for (let tier = 0; tier <= top; tier++) {
    const info = dataInfo(tier);
    const recipe = recipeFor(tier);
    const row = document.createElement('div');
    row.className = 'codex-row' + (tier === top ? ' is-current' : '');
    row.id = `codex-tier-${tier}`;
    row.style.setProperty('--tier', info.color);
    row.style.setProperty('--tier-soft', info.soft);
    let recipeMarkup;
    if (tier === 0) {
      recipeMarkup = '<span class="t">Extracted from the network.</span>';
    } else {
      recipeMarkup = recipeHtml(tier);
    }
    row.innerHTML = `
      <span class="codex-dot" style="background:${info.color}"></span>
      <div class="codex-head">
        <span class="codex-name">${escapeHtml(info.name)}</span>
        <span class="codex-tier">${tierLabel(tier)}</span>
        <span class="codex-bank">${fmt(bankOf(state, tier))}</span>
      </div>
      <div class="codex-recipe">${recipeMarkup}</div>
    `;
    ui.codexAmounts.set(tier, row.querySelector('.codex-bank'));
    list.append(row);
  }

  if (top < CONFIG.maxTier) {
    const next = document.createElement('div');
    next.className = 'codex-row is-locked';
    next.innerHTML = `
      <span class="codex-dot" style="background:transparent;border-color:var(--line-2)"></span>
      <div class="codex-head"><span class="codex-name">? ? ?</span><span class="codex-tier">${tierLabel(top + 1)}</span></div>
      <div class="codex-recipe"><span class="t">Bank ${escapeHtml(dataInfo(top).name)} to reveal.</span></div>
    `;
    list.append(next);
  }

  requestAnimationFrame(() => {
    if (scroll && ui.tab === 'codex') {
      ui.refs.codexView.scrollTop = ui.refs.codexView.scrollHeight;
    } else {
      ui.refs.codexView.scrollTop = previousScroll;
    }
  });
}

export function renderOps(ui) {
  if (!ui.ops) {
    ui.ops = { cards: [], coreRows: new Map() };
    const list = ui.refs.directiveList;
    list.textContent = '';
    for (let i = 0; i < CONFIG.directiveCount; i++) {
      const card = document.createElement('article');
      card.className = 'directive';
      card.innerHTML = `
        <div class="dir-head"><span class="dir-title"></span><span class="dir-reward"></span></div>
        <p class="dir-brief"></p>
        <div class="dir-bar"><i></i></div>
        <div class="dir-foot"><span class="dir-progress"></span><span class="dir-kind"></span></div>
      `;
      list.append(card);
      ui.ops.cards.push({
        el: card,
        title: card.querySelector('.dir-title'),
        reward: card.querySelector('.dir-reward'),
        brief: card.querySelector('.dir-brief'),
        fill: card.querySelector('.dir-bar i'),
        progress: card.querySelector('.dir-progress'),
        kind: card.querySelector('.dir-kind'),
      });
    }

    const coreList = ui.refs.coreList;
    coreList.textContent = '';
    for (const upgrade of CORE_UPGRADES) {
      const row = document.createElement('div');
      row.className = 'core-row';
      row.innerHTML = `
        <div class="core-info">
          <b>${escapeHtml(upgrade.name)}</b>
          <small>${escapeHtml(upgrade.effect)}</small>
        </div>
        <button class="btn btn-quiet core-buy" data-core="${upgrade.id}">
          <span class="core-rank"></span><span class="price"></span>
        </button>
      `;
      coreList.append(row);
      ui.ops.coreRows.set(upgrade.id, {
        el: row,
        rank: row.querySelector('.core-rank'),
        price: row.querySelector('.price'),
        button: row.querySelector('.core-buy'),
      });
    }
  }
  updateOps(ui);
}

export function updateOps(ui) {
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
    const progress = directiveProgress(state, directive);
    const ratio = pct(progress, directive.goal);
    card.title.textContent = directive.title;
    card.brief.textContent = directive.brief;
    card.kind.textContent = directive.kind.toUpperCase();
    card.fill.style.width = `${ratio}%`;
    card.el.classList.toggle('is-done', progress >= directive.goal);
    const reward = directive.reward || { tier: 0, amount: 0 };
    const rewardText = reward.amount > 0 ? `+${fmt(reward.amount)} ${dataInfo(reward.tier).name}` : '';
    const coreText = directive.cores > 0 ? ` · ${directive.cores} core${directive.cores === 1 ? '' : 's'}` : '';
    card.reward.textContent = `${rewardText}${coreText}`;
    const progressText = directive.kind === 'uptime'
      ? `${Math.floor(progress)}s / ${directive.goal}s`
      : `${fmt(progress)} / ${fmt(directive.goal)}`;
    card.progress.textContent = progressText;
  }

  for (const upgrade of CORE_UPGRADES) {
    const row = ui.ops.coreRows.get(upgrade.id);
    if (!row) continue;
    const rank = state.coreRanks[upgrade.id] || 0;
    const maxed = rank >= upgrade.max;
    const cost = coreUpgradeCost(upgrade, rank);
    row.rank.textContent = maxed ? 'MAXED' : `RANK ${rank}`;
    row.price.textContent = maxed ? '' : `→ ${cost} core${cost === 1 ? '' : 's'}`;
    row.button.disabled = maxed || state.cores < cost;
    row.el.classList.toggle('is-maxed', maxed);
  }

  ui.refs.coreBalance.textContent = `${state.cores}`;
  const gain = deepScanReward(state);
  const unlocked = state.stats.deepestTier >= CONFIG.deepScanTier;
  ui.refs.deepScan.disabled = !unlocked;
  ui.refs.deepScanHint.textContent = unlocked
    ? `Resets the refinery for ${gain} core${gain === 1 ? '' : 's'}. Cores and ranks carry over.`
    : `Unlocks at tier ${CONFIG.deepScanTier}. Current depth: ${tierLabel(state.stats.deepestTier)}.`;
  ui.refs.deepScanHint.classList.toggle('is-locked', !unlocked);
  ui.refs.archiveNote.textContent = state.stats.scans > 0
    ? `${state.stats.scans} deep scan${state.stats.scans === 1 ? '' : 's'} · best depth ${tierLabel(state.stats.bestDeepest)} · offline cap ${Math.round(offlineCap(state) / 3600)}h`
    : 'Cores survive every deep scan.';
}

export function updateHint(ui) {
  const state = ui.app.state;
  if (state.hintDismissed) {
    ui.refs.hint.classList.add('is-hidden');
    return;
  }
  ui.refs.hint.classList.remove('is-hidden');
  const tier1 = state.nodes.find((node) => node.kind === 'processor' && node.tier === 1);
  const hasLink = state.links.length > 0;
  const rawInto1 = tier1 && state.links.some((link) => link.to === tier1.id);
  const outOf1 = tier1 && state.links.some((link) => link.from === tier1.id);
  const busy = state.nodes.find((node) => node.kind !== 'vault' && (node._util || 0) >= 0.995);
  const outCount = new Map();
  for (const link of state.links) outCount.set(link.from, (outCount.get(link.from) || 0) + 1);
  const shared = [...outCount.values()].some((count) => count > 1);
  let text;
  if (!hasLink) {
    text = 'Drag from the extractor\'s output port into the vault to start banking raw noise.';
  } else if (state.unlockedTier === 1 && !tier1) {
    text = 'Raw noise is banked and spendable. Build a Clean Bits forge from the panel.';
  } else if (tier1 && !rawInto1) {
    text = 'Wire raw noise into the Clean Bits forge.';
  } else if (tier1 && !outOf1) {
    text = 'Send the forge\'s output into the vault to bank Clean Bits.';
  } else if (state.unlockedTier === 2) {
    text = 'A Signals forge is open. It wants Clean Bits and raw noise.';
  } else if (busy) {
    text = 'That machine is running at 100%. Overclock it to widen the flow.';
  } else if (shared) {
    text = 'One output feeds several wires. Set a wire\'s priority to decide who gets served first.';
  } else if (state.links.some((link) => (link.anchors || []).length > 0)) {
    text = 'Double-click a wire to drop an anchor and route it around the machines.';
  } else {
    text = 'Each new signal opens a deeper tier. Scale whatever runs starved; dismantling refunds everything.';
  }
  if (text !== ui.lastHint) {
    ui.lastHint = text;
    ui.refs.hintText.textContent = text;
  }
}
