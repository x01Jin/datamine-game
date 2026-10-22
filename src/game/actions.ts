import {
  CONFIG,
  extractorCost,
  processorCost,
  upgradeCost,
  dataInfo,
  costText,
  coreUpgradeCost,
  deepScanReward,
  ledgerBonus,
  normalizePriority,
  CORE_UPGRADES,
} from './gamedata.ts';
import {
  addInvested,
  makeProcessor,
  processorCopyCount,
  nodeById,
  linkById,
  createInitialState,
} from './state.ts';
import { overlapsNode } from '../layout/geometry.ts';
import { directiveComplete, generateDirective } from './directives.ts';
import type {
  App,
  Cost,
  CoreRanks,
  Directive,
  ExtractorNode,
  Face,
  Invested,
  Link,
  NodeKind,
  Point,
  Priority,
  ProcessorNode,
  State,
} from './types.ts';
import { MAX_ANCHORS } from './types.ts';

export interface ConnectOptions {
  points?: Point[];
  side?: Face;
}

function lookup(map: { [tier: number]: number }, key: number): number | undefined {
  return map[key] as number | undefined;
}

export function bankOf(state: State, tier: number): number {
  return state.bank[tier] || 0;
}

export function canAfford(state: State, cost: Cost): boolean {
  return bankOf(state, cost.tier) + 1e-9 >= cost.amount;
}

function spend(state: State, cost: Cost): boolean {
  if (!canAfford(state, cost)) return false;
  state.bank[cost.tier] = Math.max(0, bankOf(state, cost.tier) - cost.amount);
  return true;
}

function refund(state: State, credits: Invested): void {
  for (const [tier, amount] of Object.entries(credits)) {
    const t = Number(tier);
    if (Number.isFinite(t) && amount > 0) {
      state.bank[t] = bankOf(state, t) + amount;
    }
  }
}

export function extractorCount(state: State): number {
  return state.nodes.filter((node) => node.kind === 'extractor').length;
}

export function currentCost(state: State, kind: NodeKind, tier: number | null = null): Cost {
  if (kind === 'extractor') return extractorCost(extractorCount(state));
  return processorCost(tier, processorCopyCount(state, tier as number));
}

export function placeExtractor(app: App, x: number, y: number, keepArmed = false): ExtractorNode | null {
  if (app.state.nodes.length >= CONFIG.maxNodes) {
    app.audio.deny();
    app.toast({
      text: 'Machine limit reached. Dismantle something first.',
      tone: 'bad',
      quiet: true,
    });
    return null;
  }
  const cost = currentCost(app.state, 'extractor');
  if (!canAfford(app.state, cost)) {
    app.audio.deny();
    app.toast({ text: `Need ${costText(cost)}`, tone: 'bad', quiet: true });
    return null;
  }
  if (overlapsNode(app.state.nodes, x, y, 'extractor')) {
    app.audio.deny();
    app.toast({ text: 'Too close to another machine.', tone: 'bad', quiet: true });
    return null;
  }
  if (!spend(app.state, cost)) return null;

  const node: ExtractorNode = {
    id: app.state.nextId++,
    kind: 'extractor',
    x,
    y,
    level: 1,
    out: { tier: 0, amount: 0 },
    invested: {},
  };
  addInvested(node, cost);
  app.state.nodes.push(node);
  app.state.stats.built++;
  app.audio.place();
  app.afterChange();
  if (!keepArmed) app.setPendingBuild(null);
  app.toast({ text: 'Extractor online', tone: 'ok', quiet: true });
  return node;
}

export function placeProcessor(
  app: App,
  tier: number,
  x: number,
  y: number,
  keepArmed = false,
): ProcessorNode | null {
  if (app.state.nodes.length >= CONFIG.maxNodes) {
    app.audio.deny();
    app.toast({
      text: 'Machine limit reached. Dismantle something first.',
      tone: 'bad',
      quiet: true,
    });
    return null;
  }
  const cost = currentCost(app.state, 'processor', tier);
  if (!canAfford(app.state, cost)) {
    app.audio.deny();
    app.toast({ text: `Need ${costText(cost)}`, tone: 'bad', quiet: true });
    return null;
  }
  if (overlapsNode(app.state.nodes, x, y, 'processor')) {
    app.audio.deny();
    app.toast({ text: 'Too close to another machine.', tone: 'bad', quiet: true });
    return null;
  }
  if (!spend(app.state, cost)) return null;

  const node = makeProcessor(app.state.nextId++, tier, x, y);
  addInvested(node, cost);
  app.state.nodes.push(node);
  app.state.stats.built++;
  app.audio.place();
  app.afterChange();
  if (!keepArmed) app.setPendingBuild(null);
  app.toast({ text: `${dataInfo(tier).name} forge online`, tone: 'ok', quiet: true });
  return node;
}

export function upgradeNode(app: App, id: number): boolean {
  const node = nodeById(app.state, id);
  if (!node || node.kind === 'vault') return false;
  if (node.level >= CONFIG.maxLevel) {
    app.audio.deny();
    app.toast({ text: 'This machine is at maximum overclock.', tone: 'bad', quiet: true });
    return false;
  }
  const cost = upgradeCost(node);
  if (!canAfford(app.state, cost)) {
    app.audio.deny();
    app.toast({ text: `Need ${costText(cost)}`, tone: 'bad', quiet: true });
    return false;
  }
  if (!spend(app.state, cost)) return false;
  addInvested(node, cost);
  node.level += 1;
  app.audio.upgrade();
  app.afterChange();
  return true;
}

export function dismantleNode(app: App, id: number): boolean {
  const node = nodeById(app.state, id);
  if (!node) return false;
  if (node.kind === 'vault') {
    app.audio.deny();
    app.toast({
      text: 'The vault is the anchor. It cannot be dismantled.',
      tone: 'bad',
      quiet: true,
    });
    return false;
  }
  if (node.kind === 'extractor' && extractorCount(app.state) <= 1) {
    app.audio.deny();
    app.toast({ text: 'Keep at least one extractor running.', tone: 'bad', quiet: true });
    return false;
  }

  refund(app.state, node.invested || {});
  app.state.nodes = app.state.nodes.filter((candidate) => candidate.id !== id);
  app.state.links = app.state.links.filter((link) => link.from !== id && link.to !== id);
  app.view.selection = null;
  app.audio.dismantle();
  app.afterChange();
  return true;
}

export function connectNodes(
  app: App,
  fromId: number,
  toId: number,
  options: ConnectOptions = {},
): Link | null {
  const from = nodeById(app.state, fromId);
  const to = nodeById(app.state, toId);
  if (!from || !to) return null;
  if (from.id === to.id) {
    app.audio.deny();
    app.toast({ text: 'A machine cannot feed itself.', tone: 'bad', quiet: true });
    return null;
  }
  if (from.kind === 'vault' || !('out' in from)) {
    app.audio.deny();
    app.toast({ text: 'The vault has no output. Start at a machine.', tone: 'bad', quiet: true });
    return null;
  }
  if (to.kind !== 'processor' && to.kind !== 'vault') {
    app.audio.deny();
    app.toast({ text: 'Wires end at a forge input or the vault.', tone: 'bad', quiet: true });
    return null;
  }
  if (app.state.links.length >= CONFIG.maxLinks) {
    app.audio.deny();
    app.toast({ text: 'Wire limit reached. Cut a wire first.', tone: 'bad', quiet: true });
    return null;
  }

  const tier = from.out.tier;
  if (to.kind === 'processor' && lookup(to.inputs, tier) === undefined) {
    app.audio.deny();
    app.toast({
      text: `${dataInfo(tier).name} does not fit that input.`,
      tone: 'bad',
      quiet: true,
    });
    return null;
  }
  const duplicate = app.state.links.some(
    (link) => link.from === fromId && link.to === toId && link.tier === tier,
  );
  if (duplicate) {
    app.audio.deny();
    app.toast({ text: 'Those ports are already wired.', tone: 'bad', quiet: true });
    return null;
  }

  const link = {
    id: app.state.nextId++,
    from: fromId,
    to: toId,
    tier,
    priority: (to.kind === 'vault' ? 0.5 : 1) as Priority,
    anchors: [] as Point[],
  } as Link;
  const side = options.side;
  if (to.kind === 'vault' && (side === 'n' || side === 's' || side === 'e' || side === 'w')) link.side = side;
  const points = Array.isArray(options.points) ? options.points : [];
  for (const point of points) {
    if (link.anchors.length >= MAX_ANCHORS) break;
    link.anchors.push({ x: point.x, y: point.y });
  }
  app.state.links.push(link);
  app.audio.connect();
  app.afterChange();
  return link;
}

export function removeLink(app: App, id: number, silent = false): boolean {
  const before = app.state.links.length;
  app.state.links = app.state.links.filter((link) => link.id !== id);
  if (app.state.links.length === before) return false;
  if (app.view.selection?.kind === 'link' && app.view.selection.id === id) {
    app.view.selection = null;
  }
  if (!silent) app.audio.disconnect();
  app.afterChange();
  return true;
}

export function addLinkAnchor(app: App, linkId: number, x: number, y: number, index = -1): Point | null {
  const link = linkById(app.state, linkId);
  if (!link) return null;
  if (link.anchors.length >= MAX_ANCHORS) {
    app.audio.deny();
    app.toast({ text: 'That route already has enough anchors.', tone: 'bad', quiet: true });
    return null;
  }
  const anchor: Point = { x, y };
  if (index >= 0 && index <= link.anchors.length) {
    link.anchors.splice(index, 0, anchor);
  } else {
    link.anchors.push(anchor);
  }
  link.side = null;
  app.audio.connect();
  app.afterChange();
  return anchor;
}

export function setLinkAnchor(app: App, linkId: number, index: number, x: number, y: number): boolean {
  const link = linkById(app.state, linkId);
  const anchor = link?.anchors?.[index];
  if (!anchor) return false;
  anchor.x = x;
  anchor.y = y;
  link.side = null;
  return true;
}

export function removeLinkAnchor(app: App, linkId: number, index: number): boolean {
  const link = linkById(app.state, linkId);
  if (!link || index < 0 || index >= link.anchors.length) return false;
  link.anchors.splice(index, 1);
  link.side = null;
  app.audio.disconnect();
  app.afterChange();
  return true;
}

export function clearLinkAnchors(app: App, linkId: number): boolean {
  const link = linkById(app.state, linkId);
  if (!link || link.anchors.length === 0) return false;
  link.anchors.length = 0;
  link.side = null;
  app.audio.disconnect();
  app.afterChange();
  return true;
}

export function setLinkPriority(app: App, linkId: number, priority: number): boolean {
  const link = linkById(app.state, linkId);
  if (!link) return false;
  const value = normalizePriority(priority);
  if (link.priority === value) return false;
  link.priority = value;
  app.afterChange();
  return true;
}

export function checkDirectives(app: App): Directive | null {
  const state = app.state;
  let completed: Directive | null = null;
  for (let i = 0; i < state.directives.length; i++) {
    const directive = state.directives[i];
    if (!directiveComplete(state, directive)) continue;
    completed = directive;
    grantDirective(app, directive);
    const others = state.directives.filter((_, index) => index !== i);
    state.directives[i] = generateDirective(state, others);
    break;
  }
  if (completed) app.afterChange();
  return completed;
}

function grantDirective(app: App, directive: Directive): void {
  const state = app.state;
  const bonus = ledgerBonus(state);
  const reward = directive.reward || { tier: 0, amount: 0 };
  let payout = '';
  if (reward.amount > 0) {
    const amount = Math.ceil(reward.amount * bonus);
    state.bank[reward.tier] = (state.bank[reward.tier] || 0) + amount;
    payout = `+${amount} ${dataInfo(reward.tier).name}`;
  }
  const cores = Math.floor((directive.cores || 0) * bonus);
  if (cores > 0) {
    state.cores += cores;
    payout = payout
      ? `${payout} · +${cores} core${cores === 1 ? '' : 's'}`
      : `+${cores} core${cores === 1 ? '' : 's'}`;
  }
  app.audio.discover();
  app.toast({
    text: `Directive complete: ${directive.title}`,
    sub: payout || 'Reward issued',
    tone: 'discover',
    duration: 4200,
  });
}

export function deepScan(app: App): boolean {
  const state = app.state;
  if (state.stats.deepestTier < CONFIG.deepScanTier) {
    app.audio.deny();
    app.toast({
      text: `The strata are not deep enough. Reach tier ${CONFIG.deepScanTier} first.`,
      tone: 'bad',
      quiet: true,
    });
    return false;
  }
  const gained = deepScanReward(state);
  const next = createInitialState(Boolean(app.isNarrow?.()));
  next.cores = state.cores + gained;
  next.coreRanks = { ...state.coreRanks };
  next.muted = state.muted;
  next.motion = state.motion;
  next.snapGrid = state.snapGrid;
  next.hintDismissed = state.hintDismissed;
  next.stats.scans = state.stats.scans + 1;
  next.stats.bestDeepest = Math.max(state.stats.bestDeepest, state.stats.deepestTier);
  next.stats.totalBanked = state.stats.totalBanked;
  next.stats.bankedByTier = { ...state.stats.bankedByTier };
  next.stats.uptime = { ...state.stats.uptime };
  app.replaceState(next);
  app.board?.fit();
  app.saveNow(true);
  app.toast({
    text: `Deep scan complete · +${gained} core${gained === 1 ? '' : 's'}`,
    sub: 'The refinery is rebuilt from scratch. Cores and the archive carry over.',
    tone: 'discover',
    duration: 5200,
  });
  return true;
}

export function buyCoreUpgrade(app: App, id: string): boolean {
  const upgrade = CORE_UPGRADES.find((entry) => entry.id === id);
  if (!upgrade) return false;
  const key = id as keyof CoreRanks;
  const rank = app.state.coreRanks[key] || 0;
  if (rank >= upgrade.max) {
    app.audio.deny();
    app.toast({ text: `${upgrade.name} is fully ranked.`, tone: 'bad', quiet: true });
    return false;
  }
  const cost = coreUpgradeCost(upgrade, rank);
  if (app.state.cores < cost) {
    app.audio.deny();
    app.toast({ text: `Need ${cost} core${cost === 1 ? '' : 's'}`, tone: 'bad', quiet: true });
    return false;
  }
  app.state.cores -= cost;
  app.state.coreRanks[key] = rank + 1;
  app.audio.upgrade();
  app.afterChange();
  return true;
}

export function creditsLabel(credits: Invested): string {
  const parts = [];
  for (const [tier, amount] of Object.entries(credits || {})) {
    if (amount > 0) parts.push(`${Math.round(amount)} ${dataInfo(Number(tier)).name}`);
  }
  return parts.join(' + ') || 'nothing';
}
