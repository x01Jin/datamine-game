# DATAMINE — game design

A signal refinery that never ends. You dig raw noise out of the network, refine it into higher and higher signals, and bank the results. The archive has a bottom.

## The pitch

Build a refinery that reads like a circuit board, keep it fed, and push it deeper than last time.

## Why an idle game needs three clocks

Idle games are not about the click. They are about three different time horizons, and a design fails when only one of them is tuned.

| Horizon | What the player feels | System |
| --- | --- | --- |
| Seconds | "I made that happen." | Wiring, routing, priority, overclock |
| Minutes | "I am getting somewhere." | Directives, tier unlocks |
| Hours | "I am stronger than I was." | Deep scan, core exchange, offline catch-up |

DATAMINE has one system per horizon. The first hour of play has to work on all three at once, so the moment-to-moment system cannot just be "click a button", and the long-term system cannot just be "the number goes up".

## Core loop

```
observe the network  →  find the starved or blocked machine
        ↓
rebuild the layout: a new forge, a rerouted wire, a priority change
        ↓
watch the throughput climb and the bank fill
        ↓
bank enough of a signal to reveal the next tier
        ↓
the next tier costs more, so the layout has to get smarter
```

The loop only works if the player can *see* the problem. A machine labelled STARVED is a question with an answer; a machine labelled RUNNING while the numbers crawl is a dead end. The board, the inspector and the Ops board all show the same status vocabulary for this reason (`nodeStatus()` in `sim.js` is the single source).

## The three tiers of play

### Moment to moment: the floor and the routes

Two verbs make the refinery feel authored rather than assembled:

- **Placing** snaps to a grid. The board turns into a floor plan with rows and columns, and a player who plans two steps ahead can see the shape of a factory before building it. Machines and wires share that grid, so a port and a route point always meet.
- **Routing** lets a wire carry points. A routed wire is a decision: it goes around the machines, it makes the flow legible, it can be dragged into a shape that reads at a glance. Points are laid down one click at a time from the output port, which keeps the wire on the grid the whole way.

Neither of these change the economy. They change how the player *sees* the economy, which is what makes an idle board worth looking at.

### Minutes: directives

Without objectives the player asks "what now?" and the answer is "wait for the number". Directives answer it. Three at a time, always in view, always about the current state of the board:

- bank a quantity of a specific signal
- hold a forge above 95% load for a while
- run more machines than you are running
- reach a deeper tier
- bank signal types you have never banked

Progress is measured against a snapshot taken when the order was issued, so an order always means "do this *now*", never "do this again". They pay in banked signal and, for the harder ones, in cores.

### Hours: deep scan

The signature move of the genre: throw it away to get permanently faster. The refinery is torn down, the bank is emptied, and cores are minted from how deep you got and how much you banked.

Cores are then spent in the core exchange, which is where the choices live. Momentum makes everything faster. Reservoir makes buffers bigger so fewer machines stall. Ledger makes directives pay more. Deep Survey extends offline catch-up. Four axes, no wrong answer, and the answer changes as the run gets deeper.

Deep scan is destructive, so the game says exactly what it costs before it happens and keeps the archive record (`stats.scans`, `stats.bestDeepest`) so the run has a history.

## Progression

Tiers are the spine. Tier N is forged from tier N-1 and tier N-2, so the network has to keep two tiers alive at once. A tier is revealed by banking one unit of the tier below it, which makes banking a goal rather than a side effect.

Names and shapes are procedural past the curated ten, so the archive keeps producing things the player has not seen. The Codex is the record; filling it is a completionist track that runs parallel to the numbers.

## Economy notes

- **Money is per tier.** A tier-3 forge is paid in tier-2 signal. There is no pooled currency, so the bank is a portfolio and the player is always looking at several balances at once.
- **The vault competes.** A machine with two outputs splits proportionally. The vault is one of the consumers, not a guaranteed sink, and its wire starts on Low priority so a chain keeps the flow by default. A player who wants a forge fed must say so with wire priority.
- **Bottlenecks are honest.** Buffers fill, machines block, inputs starve. The first thing a player learns is to read the status dot before buying anything.
- **Offline is capped.** Eight hours by default. Absent time should be worth something but never worth more than showing up.

## Pacing

The cost curves are tuned against a reference network (one chain forge per tier, one extractor each, everything banking) and measured from a headless run of the real simulation:

| Tier | T01 | T02 | T03 | T04 | T05 | T06 | T07 | T08 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Seconds to bank | 3 | 4 | 6 | 12 | 23 | 46 | 87 | 156 |

Each tier costs roughly 1.8x the previous one, which is the classic incremental curve: the wait grows, the machine count grows with it, and a deep scan is the answer to a wait that gets too long.

Two growth rates do the work. `processorTierGrowth` (1.62) sets how much rarer each tier is, and `globalGrowth` (1.22) hands back a speed multiplier every time the archive goes one tier deeper, so the whole network accelerates as the player climbs. `processorCopyGrowth` (1.55) and `extractorCostGrowth` (1.45) decide whether the player widens the network or overclocks what they already have.

## What is deliberately not here

- No login, no server, no analytics, no ads.
- No timers that punish the player for being away.
- No currency sinks that exist only to drain a balance.
- No random events that can destroy a run.
