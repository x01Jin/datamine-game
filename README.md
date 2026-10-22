# DATAMINE

A browser-only idle game about running a data refinery. Extract raw data, push it through forges, and bank the output.

Play at [x01jin.github.io/datamine-game](https://x01jin.github.io/datamine-game/).

## The Canvas

Machines and wires share a 24-unit grid, so wire endpoints land on ports. `G` toggles snapping, and Settings has the same switch.

Double-click a wire to add an anchor, drag the handle to bend the route, right-click to remove it. A wire with anchors draws as a rounded polyline; a wire without them draws as a curve.

When one output feeds several inputs, each wire takes a proportional share. Set a wire to Low, Normal or High in its inspector. Wires to the vault start on Low so the chain keeps the flow; raise one when you want the bank fed first.

## The Ops board

**Directives** are three standing orders generated from the current board: bank a quantity of a signal, hold a forge above 95% load, run more machines, bank new signal types, reach a deeper tier. Each pays banked signals, and some also pay cores. Completing one issues a replacement.

**Cores** buy permanent ranks in the core exchange: machine speed, buffer size, directive payouts, offline catch-up.

**Deep scan** resets the refinery and pays cores based on your deepest tier and total banked. It unlocks at tier 06. Cores, ranks and archive records survive; the machines and the bank do not.

## Controls

| Key       | Action                                                       |
| --------- | ------------------------------------------------------------ |
| `P`       | Pause / resume                                               |
| `M`       | Mute / unmute                                                |
| `H`       | Fit the network                                              |
| `B` / `C` | Build / Codex                                                |
| `G`       | Toggle grid snap                                             |
| `R`       | Turn the selected forge a quarter turn                       |
| `+` / `-` | Zoom                                                         |
| `Esc`     | Cancel placement, wire or selection                          |
| `Delete`  | Dismantle the selected machine, cut a wire, remove an anchor |

Touch: drag to pan, pinch to zoom, tap to select.

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

`docs/GDD.md` covers the design: the core loop, the tier progression, the economy and the pacing.
