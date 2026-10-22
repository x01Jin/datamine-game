export const SAVE_KEY = 'datamine.save.v1';
export const SAVE_VERSION = 1;
export const MAX_ANCHORS = 24;

export type NodeKind = 'extractor' | 'processor' | 'vault';

export type Face = 'n' | 's' | 'e' | 'w';

export type Rot = 0 | 1 | 2 | 3;

export type Priority = 0.5 | 1 | 2;

export interface Point {
  x: number;
  y: number;
}

export interface Vector {
  dx: number;
  dy: number;
}

export interface Invested {
  [tier: number]: number;
}

export interface Telemetry {
  _util?: number;
  _cycles?: number;
  _flowOut?: number;
}

export interface Bank {
  [tier: number]: number;
}

export interface ExtractorNode extends Telemetry {
  id: number;
  kind: 'extractor';
  tier?: undefined;
  x: number;
  y: number;
  level: number;
  out: { tier: 0; amount: number };
  invested: Invested;
}

export interface ProcessorNode extends Telemetry {
  id: number;
  kind: 'processor';
  tier: number;
  rot: Rot;
  x: number;
  y: number;
  level: number;
  inputs: { [tier: number]: number };
  out: { tier: number; amount: number };
  invested: Invested;
}

export interface VaultNode extends Telemetry {
  id: number;
  kind: 'vault';
  tier?: undefined;
  out?: undefined;
  x: number;
  y: number;
  level: number;
  invested: Invested;
}

export type MachineNode = ExtractorNode | ProcessorNode | VaultNode;

export interface Link {
  id: number;
  from: number;
  to: number;
  tier: number;
  priority: Priority;
  side?: Face | null;
  anchors: Point[];
  _flow?: number;
  _moved?: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Stats {
  totalBanked: number;
  deepestTier: number;
  built: number;
  playTime: number;
  bankedByTier: { [tier: number]: number };
  uptime: { [tier: number]: number };
  scans: number;
  bestDeepest: number;
}

export interface CoreRanks {
  momentum: number;
  reservoir: number;
  ledger: number;
  survey: number;
}

export type DirectiveKind = 'bank' | 'uptime' | 'types' | 'fleet' | 'depth';

export interface Directive {
  kind: DirectiveKind;
  tier: number;
  goal: number;
  base?: number;
  title: string;
  brief: string;
  reward: { tier: number; amount: number };
  cores: number;
}

export interface State {
  version: number;
  createdAt: number;
  savedAt: number;
  nextId: number;
  nodes: MachineNode[];
  links: Link[];
  bank: Bank;
  unlockedTier: number;
  cores: number;
  coreRanks: CoreRanks;
  directives: Directive[];
  stats: Stats;
  camera: Camera;
  muted: boolean;
  motion: boolean;
  snapGrid: boolean;
  hintDismissed: boolean;
}

export type Selection =
  | { kind: 'node'; id: number }
  | { kind: 'link'; id: number }
  | { kind: 'anchor'; linkId: number; index: number };

export interface HoverPort {
  nodeId: number;
  dir: 'in' | 'out';
  tier: number | null;
  index: number;
}

export interface LinkDraft {
  fromId: number;
  tier: number;
  points: Point[];
  x: number;
  y: number;
  targetId: number | null;
  targetTier: number | null;
  targetFace: Face | null;
  targetPos: Point | null;
}

export interface Ghost {
  x: number;
  y: number;
  kind: NodeKind;
  tier: number | null;
  valid: boolean;
}

export interface View {
  selection: Selection | null;
  hoverNode: number | null;
  hoverPort: HoverPort | null;
  hoverAnchor: { linkId: number; index: number } | null;
  ghost: Ghost | null;
  linkDraft: LinkDraft | null;
  pendingBuild: { kind: NodeKind; tier: number | null } | null;
  dragCell: { x: number; y: number; kind: NodeKind } | null;
  motion: boolean;
  paused: boolean;
}

export interface Cost {
  tier: number;
  amount: number;
}

export interface RecipeInput {
  tier: number;
  amount: number;
}

export interface Recipe {
  tier: number;
  cycle: number;
  inputs: RecipeInput[];
  output: { tier: number; amount: number };
}

export interface TierInfo {
  tier: number;
  name: string;
  shape: string;
  color: string;
  bright: string;
  dim: string;
  soft: string;
  faint: string;
}

export interface CoreUpgrade {
  id: string;
  name: string;
  effect: string;
  baseCost: number;
  growth: number;
  max: number;
}

export interface ToastOptions {
  text: string;
  sub?: string;
  tone?: 'ok' | 'bad' | 'discover';
  quiet?: boolean;
  duration?: number;
  tier?: number;
}

export interface SaveState {
  state: State;
  fresh: boolean;
  elapsed: number;
  error: string | null;
}

export interface Audio {
  place(): void;
  deny(): void;
  connect(): void;
  disconnect(): void;
  upgrade(): void;
  dismantle(): void;
  click(): void;
  discover(): void;
  setMuted(muted: boolean): void;
}

export interface App {
  state: State;
  view: View;
  audio: Audio;
  toast(options: ToastOptions): void;
  afterChange(): void;
  setPendingBuild(pending: { kind: NodeKind; tier: number | null } | null): void;
  saveSoon(): void;
  saveNow(force?: boolean): boolean;
  isNarrow?(): boolean;
  replaceState(next: State): void;
  board?: { fit(): void };
  ui?: unknown;
}
