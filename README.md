# DATAMINE

A browser-only idle game about running a data refinery. Extract raw data, push it through processors, and bank the output.

Play at [x01jin.github.io/datamine-game](https://x01jin.github.io/datamine-game/).

## The Canvas

Machines and wires share a 24-unit grid, so wire endpoints land on ports. `G` toggles snapping, and Settings has the same switch.

Double-click a wire to add an anchor, drag the handle to bend the route, right-click to remove it. A wire with anchors draws as a rounded polyline; a wire without them draws as a curve.

When one output feeds several inputs, each wire takes a proportional share. Set a wire to Low, Normal or High in its inspector. Wires to the vault start on Low so the chain keeps the flow; raise one when you want the bank fed first.

## The Ops board

**Directives** are three standing orders generated from the current board: bank a quantity of a signal, hold a processor above 95% load, run more machines, bank new signal types, reach a deeper tier. Each pays banked signals, and some also pay cores. Completing one issues a replacement.

**Cores** buy permanent ranks in the core exchange: machine speed, buffer size, directive payouts, offline catch-up.

**Deep scan** resets the refinery and pays cores based on your deepest tier and total banked. It unlocks at tier 06. Cores, ranks and archive records survive; the machines and the bank do not.

## Economy

Money is per tier and never pooled: each price is a list of lines, and every line is paid from its own bank. A paid extractor adds one line per extractor already owned, from tier 0 upward; each new line enters at the base while every line already in the price grows 1.3 per copy, with 1.28 per archive tier on top, so miners stay hard to buy. Processors climb by copy and by tier. The cost model, curves and pacing are in [docs/economy.md](docs/economy.md).

## Controls

`P` pause, `M` mute, `H` fit, `B`/`C` build and codex, `G` grid snap, `R` turn, `+`/`-` zoom, `Esc` cancel, `Delete` dismantle. Key bindings, placement and the touch limitation are in [docs/controls.md](docs/controls.md).

## Saves

- The game saves automatically and catches up on up to eight hours away. Deep Survey raises the cap.
- If another tab writes a newer save, autosave stops and the status bar shows `CONFLICT` instead of overwriting it.
- Settings → Export / Import moves a save between browsers.
- Settings → Restore guidance hints brings the hint bar back.
- Settings → Wipe instance replaces the current save with a fresh one.

## Development

```bash
npm test           # node --test, Node strips the TypeScript natively
npm run typecheck  # tsc --noEmit
npm run lint       # oxlint
npm run format     # oxfmt
```

The board is WebGL (PixiJS v8) and the chrome around it is DOM. The simulation and economy are plain TypeScript with no browser dependency, so the test suite runs in Node.

`docs/GDD.md` covers the design: the core loop, the tier progression and the pacing. [docs/economy.md](docs/economy.md) is the cost model, and [docs/controls.md](docs/controls.md) is the key and pointer reference.
