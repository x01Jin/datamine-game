import { App } from './app.ts';
import { connectNodes } from './game/actions.ts';
import { fmt, fmtDuration } from './game/gamedata.ts';
import type { Rot, State } from './game/types.ts';
import { createInitialState, importGame, loadGame, makeProcessor, serialize } from './game/state.ts';
import { simulate, step } from './game/sim.ts';
import { Interaction } from './input/interaction.ts';
import { Board } from './render/board.ts';
import { installFonts, waitForFonts } from './render/labels.ts';
import { applyCssVars } from './render/theme.ts';
import { UI } from './ui/ui.ts';

const SIM_STEP = 0.1;
const SYNC_INTERVAL = 120;

async function boot(): Promise<void> {
  applyCssVars();
  await waitForFonts();
  installFonts();

  const canvas = document.getElementById('board') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('board canvas missing');

  const loaded = loadGame();
  let state = loaded.state;
  if (loaded.fresh && window.innerWidth <= 900) {
    state = createInitialState(true);
  }
  const loadedSavedAt = state.savedAt;
  state.savedAt = Date.now();

  const view = {
    selection: null,
    hoverNode: null,
    hoverPort: null,
    hoverAnchor: null,
    ghost: null,
    linkDraft: null,
    pendingBuild: null,
    dragCell: null,
    motion: state.motion,
    paused: false,
  };

  const board = new Board(canvas, state, view);
  await board.init();
  board.setState(state);

  const app = new App(board, state, view);
  const ui = new UI(app);
  app.ui = ui;
  const interaction = new Interaction(board.app.canvas as HTMLCanvasElement, app);
  app.interaction = interaction;

  app.seedAutosave(loaded.fresh ? 0 : loadedSavedAt);
  app.installAutosave();
  ui.setSaveState(loaded.fresh ? 'READY' : 'SAVED', !loaded.fresh);
  ui.applySettings();

  if (loaded.fresh) board.fit();
  else if (window.innerWidth <= 900) {
    const vault = state.nodes.find((node) => node.kind === 'vault');
    const point = vault ? board.worldToScreen(vault.x, vault.y) : null;
    const visible =
      point &&
      point.x > 40 &&
      point.x < window.innerWidth - 40 &&
      point.y > 90 &&
      point.y < window.innerHeight - 170;
    if (!visible) board.fit();
  }

  if (loaded.error) {
    ui.toast({
      text: 'Save could not be read. Started a new instance.',
      tone: 'bad',
      duration: 6000,
    });
  }

  let offlineGains: Record<number, number> = {};
  const bankBefore = { ...state.bank };
  if (!loaded.fresh && loaded.elapsed > 5) {
    runCatchUp(app, loaded.elapsed, (next) => {
      for (const [tier, amount] of Object.entries(next.bank) as [string, number][]) {
        const gain = amount - (bankBefore[Number(tier)] ?? 0);
        if (gain > 0.001) offlineGains[Number(tier)] = gain;
      }
      app.replaceState(next);
      const gainTotal = Object.values(offlineGains).reduce((sum, amount) => sum + amount, 0);
      if (loaded.elapsed >= 60 && (gainTotal > 0.5 || loaded.elapsed >= 1800)) {
        ui.showOffline(loaded.elapsed, offlineGains);
      }
    });
  }

  let last = performance.now();
  let acc = 0;
  let syncAt = 0;
  let directiveAt = 0;
  let hiddenAt = document.hidden ? Date.now() : 0;

  board.ticker.add(() => {
    const now = performance.now();
    const dt = Math.min(0.5, Math.max(0, (now - last) / 1000));
    last = now;

    if (!view.paused) {
      acc += dt;
      let iterations = 0;
      while (acc >= SIM_STEP && iterations < 3) {
        step(app.state, SIM_STEP, { telemetry: true });
        acc -= SIM_STEP;
        iterations += 1;
      }
      if (acc > 0.5) acc = 0.5;
    }

    if (now - directiveAt > 600) {
      directiveAt = now;
      app.checkDirectives();
    }

    if (now - syncAt > SYNC_INTERVAL) {
      syncAt = now;
      board.sync();
      ui.tick(now);
    }

    board.render(now);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      app.saveNow();
      return;
    }
    const away = hiddenAt ? Math.min(app.offlineCap(), (Date.now() - hiddenAt) / 1000) : 0;
    hiddenAt = 0;
    last = performance.now();
    acc = 0;
    if (view.paused || away < 5) return;

    const before = { ...app.state.bank };
    runCatchUp(app, away, (next) => {
      app.replaceState(next);
      let gained = 0;
      for (const [tier, amount] of Object.entries(next.bank) as [string, number][]) {
        gained += Math.max(0, amount - (before[Number(tier)] ?? 0));
      }
      app.saveNow();
      if (gained > 0.5) {
        ui.toast({
          text: `Recovered ${fmtDuration(away)} of output`,
          sub: `+${fmt(gained)} banked`,
          tone: 'ok',
          quiet: true,
          duration: 4200,
        });
      }
    });
  });

  const debug = {
    app,
    get state() {
      return app.state;
    },
    get view() {
      return app.view;
    },
    give(tier: number, amount = 1000) {
      const t = Math.max(0, Math.floor(tier));
      app.state.bank[t] = (app.state.bank[t] || 0) + amount;
      ui.refresh(true);
      app.saveSoon();
    },
    unlock(tier = app.state.unlockedTier + 1) {
      app.state.unlockedTier = Math.min(1024, Math.max(app.state.unlockedTier, Math.floor(tier)));
      ui.refresh(true);
      app.saveSoon();
    },
    save: () => app.saveNow(true),
    toast(text: string, options = {}) {
      ui.toast({ text, ...options });
    },
    spawn(kind: 'extractor' | 'processor', tier = 1, x = 0, y = 0, rot: Rot = 0) {
      const node =
        kind === 'extractor'
          ? {
              id: app.state.nextId++,
              kind: 'extractor' as const,
              x,
              y,
              level: 1,
              out: { tier: 0 as const, amount: 0 },
              invested: {},
            }
          : makeProcessor(app.state.nextId++, tier, x, y, rot);
      app.state.nodes.push(node);
      app.afterChange();
      return node;
    },
    link(from: number, to: number) {
      return connectNodes(app, from, to);
    },
    step(seconds = 10) {
      simulate(app.state, seconds, 0.1);
      ui.refresh(true);
      app.saveSoon();
    },
    dump: () => serialize(app.state),
  };
  (window as unknown as { __datamine: unknown }).__datamine = debug;
}

function runCatchUp(app: App, seconds: number, done: (next: State) => void): void {
  const worker = new Worker(new URL('./worker/catchup.worker.ts', import.meta.url), { type: 'module' });
  const fail = (): void => {
    worker.terminate();
    app.toast({ text: 'Offline catch-up failed.', tone: 'bad', quiet: true });
  };
  worker.addEventListener('message', (event: MessageEvent<{ save?: string }>) => {
    const save = event.data?.save;
    if (!save) {
      fail();
      return;
    }
    worker.terminate();
    try {
      done(importGame(save));
    } catch {
      fail();
    }
  });
  worker.addEventListener('error', fail);
  worker.postMessage({ id: Date.now(), save: serialize(app.state), seconds });
}

boot().catch((error) => {
  const root = document.getElementById('boot-error');
  if (root) {
    root.hidden = false;
    root.textContent = `The refinery failed to start: ${error instanceof Error ? error.message : String(error)}`;
  }
  console.error(error);
});
