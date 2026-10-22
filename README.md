# DATAMINE

A browser-only signal refinery. Extract raw noise, wire it through forges, and bank the result. The network does not end.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173. `npm run build` produces a static bundle in `dist/`; `npm run preview` serves it.

## Play

- Click a machine in the Build panel, then click the board to place it. Shift-click keeps the tool armed.
- Click a machine's output port, then click the board to lay out wire points, then click an input port to make the wire. Right-click undoes the last point, Esc cancels the wire. Dragging from a port to a port still works.
- The vault takes a wire on all four sides, so it can be fed from wherever the refinery grows.
- Drag empty space to pan, scroll to zoom. Middle-drag or hold Space also pans.
- Click a machine or wire to open its inspector. Upgrades are paid from the bank.
- A forge can be turned: select it and press `R`, or use "Turn 90°" in its inspector. The input and output faces move together, and the wires follow.
- Dismantling refunds the full build and upgrade cost. The vault and your final extractor are permanent anchors.
- Bank one unit of a signal to reveal the next tier. Every forge consumes the two signals below it, so older tiers keep working.

The first connection is the one that matters: get the extractor's output into the vault.

## The floor

Machines and wires share one 24-unit grid. Machine centres, machine edges, ports and wire points all land on it, so a wire meets a port exactly and a route reads like a plan. Hold `G` (or turn off "Snap to grid" in Settings) to place them freely.

Wires can be routed. Double-click a wire to drop an anchor, drag the handle to bend the route, right-click to remove it. A routed wire draws as a hard path through its anchors instead of a curve.

When one output feeds several inputs, every wire takes a share of the flow. Set a wire to High or Low priority in its inspector to decide who gets served first. A wire to the vault starts on Low, so your chain keeps priority and the bank takes the spill; raise it when you need to bank harder.

## The Ops board

The Ops tab holds two things.

**Directives** are standing orders, three at a time: bank a quantity of a signal, hold a forge above 95% load for a while, run more machines, reach a deeper tier. Each one pays out in banked signals, and the harder ones pay cores. They complete on their own and issue a replacement.

**Cores** are the meta currency. They buy permanent ranks in the core exchange: more speed, bigger buffers, richer directives, longer offline catch-up.

**Deep scan** tears the refinery down and rebuilds it from bare rock, in exchange for cores. Cores, ranks and archive records survive. It unlocks once the archive reaches tier 06.

## Controls

| Key       | Action                                                                               |
| --------- | ------------------------------------------------------------------------------------ |
| `P`       | Pause / resume                                                                       |
| `M`       | Mute / unmute                                                                        |
| `H`       | Fit the network                                                                      |
| `B` / `C` | Build / Codex                                                                        |
| `G`       | Toggle grid snap                                                                     |
| `R`       | Turn the selected forge a quarter turn                                                |
| `+` / `-` | Zoom                                                                                 |
| `Esc`     | Cancel placement, wire, or selection                                                 |
| `Delete`  | Dismantle the selected machine, cut the selected wire, or remove the selected anchor |

Touch: drag to pan, pinch to zoom, tap to select.

## Saves

- Desktop: Settings (gear) → Export / Import.
- The game saves automatically, and catches up while the tab was hidden for up to eight hours (longer with Deep Survey).
- If another tab writes a newer save, autosave pauses with a `CONFLICT` marker instead of overwriting it.
- Settings → Restore guidance hints brings the hint bar back after it has been dismissed.
- To start over without touching the file system, use Settings → Wipe instance.

## Development

```bash
npm test           # node --test, Node strips the TypeScript natively
npm run typecheck  # tsc --noEmit
npm run lint       # oxlint
npm run format     # oxfmt
```

The board is WebGL (PixiJS v8) and everything around it is DOM. The simulation, save format and economy are pure TypeScript with no DOM dependency, so the test suite runs in plain Node.

`docs/GDD.md` explains the design: the loop, the progression, and why each system exists.
