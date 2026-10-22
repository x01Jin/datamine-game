import {
  CONFIG, recipeFor, bufferCap, offlineCap, speedOf, normalizePriority,
} from './gamedata.js';

function smooth(previous, next, weight = 0.28) {
  if (!Number.isFinite(previous)) return next;
  return previous + (next - previous) * weight;
}

export function step(state, dt, options = {}) {
  const telemetry = options.telemetry !== false;
  if (!(dt > 0) || state.nodes.length === 0) return;

  const byId = new Map();
  for (const node of state.nodes) byId.set(node.id, node);

  const outgoing = new Map();
  for (const link of state.links) {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to || !from.out) continue;
    if (to.kind === 'processor' && to.inputs[link.tier] === undefined) continue;
    if (to.kind !== 'processor' && to.kind !== 'vault') continue;
    if (!outgoing.has(from.id)) outgoing.set(from.id, []);
    outgoing.get(from.id).push({ link, from, to });
    if (telemetry) link._moved = 0;
  }

  const caps = new Map();
  const capOf = (node) => {
    let cap = caps.get(node.id);
    if (cap === undefined) {
      cap = bufferCap(state, node);
      caps.set(node.id, cap);
    }
    return cap;
  };

  const speeds = new Map();
  const speedOfNode = (node) => {
    let speed = speeds.get(node.id);
    if (speed === undefined) {
      speed = speedOf(state, node);
      speeds.set(node.id, speed);
    }
    return speed;
  };

  for (const node of state.nodes) {
    if (node.kind === 'extractor') {
      const speed = speedOfNode(node);
      const cap = capOf(node);
      const before = node.out.amount;
      const potential = CONFIG.extractorRate * speed * dt;
      node.out.amount = Math.min(cap, before + potential);
      if (telemetry) {
        const produced = node.out.amount - before;
        node._util = smooth(node._util, potential > 0 ? produced / potential : 0);
      }
    } else if (node.kind === 'processor') {
      const recipe = recipeFor(node.tier);
      const speed = speedOfNode(node);
      const wanted = (speed / recipe.cycle) * dt;
      let cycles = wanted;

      for (const input of recipe.inputs) {
        const have = node.inputs[input.tier] || 0;
        cycles = Math.min(cycles, have / input.amount);
      }
      const cap = capOf(node);
      cycles = Math.min(cycles, Math.max(0, (cap - node.out.amount) / recipe.output.amount));
      if (cycles > 1e-9) {
        for (const input of recipe.inputs) {
          node.inputs[input.tier] = Math.max(0, (node.inputs[input.tier] || 0) - cycles * input.amount);
        }
        node.out.amount = Math.min(cap, node.out.amount + cycles * recipe.output.amount);
      }
      if (telemetry) {
        node._util = smooth(node._util, wanted > 0 ? cycles / wanted : 0);
        node._cycles = cycles / dt;
        if (node._util >= 0.95) {
          state.stats.uptime[node.tier] = (state.stats.uptime[node.tier] || 0) + dt;
        }
      }
    }
  }

  for (const node of state.nodes) {
    if (!node.out) continue;
    const links = outgoing.get(node.id);
    if (!links || links.length === 0 || node.out.amount <= 1e-9) {
      if (telemetry) {
        node._flowOut = smooth(node._flowOut, 0);
        for (const entry of links || []) entry.link._flow = smooth(entry.link._flow, 0);
      }
      continue;
    }

    const before = node.out.amount;
    let remaining = before;
    const consumers = links.filter(({ to, link }) =>
      to.kind === 'vault' || (to.kind === 'processor' && to.inputs[link.tier] !== undefined),
    );

    remaining = distribute(
      consumers,
      remaining,
      (entry) => (entry.to.kind === 'vault'
        ? Infinity
        : Math.max(0, capOf(entry.to) - (entry.to.inputs[entry.link.tier] || 0))),
      (entry, amount) => {
        if (entry.to.kind === 'vault') {
          deposit(state, node.out.tier, amount);
        } else {
          entry.to.inputs[entry.link.tier] = (entry.to.inputs[entry.link.tier] || 0) + amount;
        }
        entry.link._moved = (entry.link._moved || 0) + amount;
      },
    );

    node.out.amount = remaining;
    if (telemetry) {
      node._flowOut = smooth(node._flowOut, (before - remaining) / dt);
      for (const entry of links) {
        const instant = (entry.link._moved || 0) / dt;
        entry.link._flow = smooth(entry.link._flow, instant);
      }
    }
  }

  if (telemetry) {
    for (const link of state.links) {
      if (link._moved === undefined) {
        link._flow = smooth(link._flow, 0);
      }
    }
    state.stats.playTime += dt;
  }
}

function weightOf(entry) {
  return normalizePriority(entry.link.priority);
}

function distribute(links, amount, getSpace, commit) {
  let remaining = amount;
  let active = links.filter((entry) => getSpace(entry) > 1e-9);
  let guard = 0;

  while (remaining > 1e-9 && active.length > 0 && guard < 80) {
    guard++;
    const totalWeight = active.reduce((sum, entry) => sum + weightOf(entry), 0);
    const quotas = new Map();
    for (const entry of active) {
      quotas.set(entry, remaining * (weightOf(entry) / totalWeight));
    }
    let moved = 0;
    for (const entry of active) {
      if (remaining <= 1e-9) break;
      const space = getSpace(entry);
      if (space <= 1e-9) continue;
      const movedNow = Math.min(space, quotas.get(entry), remaining);
      if (movedNow <= 1e-12) continue;
      commit(entry, movedNow);
      remaining -= movedNow;
      moved += movedNow;
    }
    if (moved <= 1e-12) break;
    active = active.filter((entry) => getSpace(entry) > 1e-9);
  }
  return remaining;
}

function deposit(state, tier, amount) {
  if (amount <= 0) return;
  state.bank[tier] = (state.bank[tier] || 0) + amount;
  state.stats.totalBanked += amount;
  state.stats.bankedByTier[tier] = (state.stats.bankedByTier[tier] || 0) + amount;
  if (tier > state.stats.deepestTier) state.stats.deepestTier = tier;
  if (tier >= 1 && state.bank[tier] >= 1 && tier + 1 > state.unlockedTier) {
    state.unlockedTier = Math.min(CONFIG.maxTier, tier + 1);
  }
}

export function simulate(state, seconds, dt = 0.5) {
  const total = Math.max(0, Math.min(seconds, offlineCap(state)));
  const h = Math.max(0.05, dt);
  const iterations = Math.min(200_000, Math.ceil(total / h));
  for (let i = 0; i < iterations; i++) {
    step(state, Math.min(h, total - i * h), { telemetry: false });
  }
  return total;
}

export function incomingFlow(state, nodeId, tier) {
  let total = 0;
  for (const link of state.links) {
    if (link.to === nodeId && link.tier === tier) total += link._flow || 0;
  }
  return total;
}

export function nodeStatus(state, node) {
  if (node.kind === 'vault') return 'receiving';
  const util = node._util || 0;
  if (node.kind === 'processor') {
    const recipe = recipeFor(node.tier);
    const hasInputs = recipe.inputs.every((input) => (node.inputs[input.tier] || 0) > 0.0001);
    const cap = bufferCap(state, node);
    if (node.out.amount >= cap - 1e-6) return 'blocked';
    if (!hasInputs) return 'starved';
    if (util < 0.98) {
      const demand = speedOf(state, node) / recipe.cycle;
      const low = recipe.inputs.some((input) =>
        (node.inputs[input.tier] || 0) < demand * input.amount * 0.75,
      );
      if (low) return 'starved';
    }
  }
  if (util > 0.82) return 'running';
  if (util > 0.04) return 'limited';
  return 'idle';
}
