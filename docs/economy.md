# Economy

Every machine price is a list of lines, and each line is paid from that tier's own bank. Nothing pools. Raw data does not buy a tier-3 processor, and a processor's output does not pay for the first copy of itself.

`Price` is `Cost[]` (`src/game/types.ts`). A purchase needs every line: `canAfford()` checks each one against its own bank, `spend()` takes all of them or none, and `costText()` prints them in tier order joined with `+`. `currentCost()` (`src/game/actions.ts`) is the only place a build price is worked out, and the extractor and processor curves live in `gamedata.ts`.

## Extractors

The starting extractor is free. It arrives from `createInitialState()` with an empty `invested` record, so dismantling it refunds nothing.

Each paid extractor adds one 100,000 line per extractor already owned, from tier 0 upward:

| Extractor bought | Price                                    |
| ---------------- | ---------------------------------------- |
| 1st              | 100,000 Raw Data                         |
| 2nd              | 100,000 Raw Data + 100,000 Clean Bits    |
| 3rd              | 100,000 Raw Data + 100,000 Clean Bits + 100,000 Signals |
| 4th              | the same three lines plus 100,000 Patterns |

The line count follows the number of extractors on the board, not the deepest tier unlocked. A player who buys ahead of the unlock ladder sees a price line they cannot pay yet, and the purchase waits.

## Processors

A tier-1 processor reads two of tier 0; higher tiers read T-1 and T-2. Copies are counted per tier, so the T01 copies do not affect the T02 price.

The first copy of tier T costs `10 × 1.62^(T-1)`, rounded up, in tier T-1: 10 raw data at T01, 17 clean bits at T02, 27 signals at T03.

The second copy costs 100 times the first, in the same tier.

From the third copy on, the price is a single line that moves one tier higher per copy and grows by 1.55 per copy. For tier T01:

| Copy | Paid in    | Amount |
| ---- | ---------- | ------ |
| 1st  | Raw Data   | 10     |
| 2nd  | Raw Data   | 1,000  |
| 3rd  | Clean Bits | 1,550  |
| 4th  | Signals    | 2,403  |

In general, copy `n` (for `n >= 3`) costs `ceil(first × 100 × 1.55^(n-2))` and is paid in tier `T-1 + (n-2)`. Rounding is applied to the amount.

That shape puts a ceiling on how wide a tier can get. The third copy of tier T is paid in T, which is already open. The fourth copy is paid in T+1, so at the deepest unlocked tier the fourth copy has to wait for the next reveal. At the archive ceiling (`CONFIG.maxTier`, tier 1024) there is no next reveal, so the fourth copy of a tier-1024 processor cannot be bought. Three copies per tier are reachable; the fourth is a reward for going deeper.

## How a price is shown

A processor price is a single line and prints as one number. Only an extractor price can run to several lines; the build card then prints the highest-tier line as the headline number and notes how many extra tier lines the price carries (`+1 tier`, `+2 tiers`). The card's hover text and the insufficient-funds toast list the whole price, sorted from the lowest tier up, using the same compact number format as the bank.

## Upgrades

An upgrade is a single line, so it never competes across tiers. The price is `ceil(6 × 2^(level-1))` in the machine's own output tier; an extractor upgrade is paid in raw data. Levels stop at `CONFIG.maxLevel` (200).

At the start of a run overclocking is far cheaper than widening. Nine extractor upgrades cost 3,066 raw data in total and leave the machine at level 10, which runs 38 times the base rate. The second extractor costs 100,000.

## Refunds

Dismantling returns every line that went into the machine, including upgrade lines, to the tier it came from. `addInvested()` records each line at build time, so a machine bought at a multi-line price refunds the same lines it was charged. The last extractor and the vault cannot be dismantled.

## Offline catch-up and the cap

The bank fills while the tab is closed, up to `CONFIG.offlineCap`, which is eight hours. Each Deep Survey rank adds an hour, and the rank caps at eight, so sixteen hours is the ceiling.

Deep Survey rank 6 raises the cap to 14 hours, which covers the second extractor at base speed.

## Pacing consequences

- The second extractor is the first real wall: 100,000 raw data at 2/s is 13h 53m of production before any speed multiplier.
- Speed multipliers, not body count, are the early answer. Level speed grows by 1.5 per level and costs 6, 12, 24 and so on, so a handful of upgrades outruns a second machine for a fraction of the price.
- Copies 1 and 2 stay in T-1 and are cheap; the third is 1.55 times the second's amount and is paid in T; the fourth is paid in T+1, so width is gated by depth.
- A tier's bank has two jobs at once: its own overclocks and extra copies, and the first copies of the tier above. Spending it flat on one starves the other.

## Constants

`CONFIG` in `src/game/gamedata.ts` holds `machineTierCost` (100,000), the per-line cost of an extractor, while processor prices use `processorBaseCost` (10), `processorTierGrowth` (1.62), `processorCopyJump` (100) and `processorCopyGrowth` (1.55). `upgradeBase` (6) and `upgradeGrowth` (2) price overclocks. `test/gamedata.test.ts` asserts exact prices, so a change to any of them fails the suite.
