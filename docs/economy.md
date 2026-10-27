# Economy

Every machine price is a list of lines, and each line is paid from that tier's own bank. Nothing pools. Raw data does not buy a tier-3 processor, and a processor's output does not pay for the first copy of itself.

`Price` is `Cost[]` (`src/game/types.ts`). A purchase needs every line: `canAfford()` checks each one against its own bank, `spend()` takes all of them or none, and `costText()` prints them in tier order joined with `+`. `currentCost()` (`src/game/actions.ts`) is the only place a build price is worked out, and the extractor and processor curves live in `gamedata.ts`.

## Extractors

The starting extractor is free. It arrives from `createInitialState()` with an empty `invested` record, so dismantling it refunds nothing.

Every paid extractor adds one line per extractor already owned, from tier 0 upward. Adding a copy does two things:

- **it appends a line** at the base amount (`machineTierCost`, 100,000) in the next tier up, so the newest currency enters the price at its cheapest;
- **it multiplies every line already in the price** by `extractorCopyGrowth` (1.3), so the established banks carry the compounding bill.

Every line is also multiplied by the archive depth (`extractorTierGrowth`, 1.28, raised to `unlockedTier - 1`), so a miner bought at T20 is not pocket change next to a miner bought at T01.

```
line i amount = ceil(100,000 × 1.28^(unlockedTier - 1) × 1.3^(n - 1 - i))
```

where `n` is the number of extractors already owned (which is also the number of lines) and `i` runs from 0 at the oldest currency to `n - 1` at the line this purchase adds.

At the first tier the first paid extractor costs 100,000 raw data. The first three paid extractors look like this:

| Extractor bought | Price                                                   |
| ---------------- | ------------------------------------------------------- |
| 1st paid         | 100,000 Raw Data                                        |
| 2nd paid         | 130,000 Raw Data + 100,000 Clean Bits                   |
| 3rd paid         | 169,000 Raw Data + 130,000 Clean Bits + 100,000 Signals |

Once the archive reaches T02 the same three lines become 216,320 / 166,400 / 128,000. The line count follows the number of extractors on the board: with `n` extractors the price has `n` lines, ending at tier `n - 1`, so a player who buys ahead of the unlock ladder sees a price line they cannot pay yet.

The newest line is the cheapest and is paid in the rarest currency the price touches, while the oldest line has compounded the longest. That keeps each additional miner a portfolio decision, not a raw-data check: the bill lands in the established banks, where the next processor copy and the next overclock also compete, and the newest currency is still a gate because it has to exist at all. Mining width is deliberately the slowest axis in the game. Overclocking an extractor is the cheap early answer; a second or third miner is a project that needs the whole refinery behind it.

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

A processor price is a single line and prints as one number. Only an extractor price can run to several lines; the build card lists every line in a stacked bill, each with its tier dot and currency name, and tints a line when that bank is short. The card's hover text and the insufficient-funds toast list the whole price, sorted from the lowest tier up, using the same compact number format as the bank.

## Upgrades

An upgrade is a single line, so it never competes across tiers. The price is `ceil(6 × 2^(level-1))` in the machine's own output tier; an extractor upgrade is paid in raw data. Levels stop at `CONFIG.maxLevel` (200).

At the start of a run overclocking is far cheaper than widening. Nine extractor upgrades cost 3,066 raw data in total and leave the machine at level 10, which runs 38 times the base rate. The second extractor costs 100,000.

## Refunds

Dismantling returns every line that went into the machine, including upgrade lines, to the tier it came from. `addInvested()` records each line at build time, so a machine bought at a multi-line price refunds the same lines it was charged. The last extractor and the vault cannot be dismantled.

## Offline catch-up and the cap

The bank fills while the tab is closed, up to `CONFIG.offlineCap`, which is eight hours. Each Deep Survey rank adds an hour, and the rank caps at eight, so sixteen hours is the ceiling.

Deep Survey rank 6 raises the cap to 14 hours, which covers the second extractor at base speed.

## Pacing consequences

- The first paid extractor is the first real wall: 100,000 raw data at 2/s is 13h 53m of production before any speed multiplier.
- Speed multipliers, not body count, are the early answer. Level speed grows by 1.5 per level and costs 6, 12, 24 and so on, so a handful of upgrades outruns a second machine for a fraction of the price.
- Mining width compounds: every copy raises every line already in the price by 1.3 and appends a base-priced line one tier higher, while the archive depth raises every line by 1.28 per tier. Miners therefore stay expensive instead of aging into pocket change.
- Copies 1 and 2 of a processor stay in T-1 and are cheap; the third is 1.55 times the second's amount and is paid in T; the fourth is paid in T+1, so processor width is gated by depth.
- A tier's bank has two jobs at once: its own overclocks and extra copies, and the first copies of the tier above. Spending it flat on one starves the other.

## Constants

`CONFIG` in `src/game/gamedata.ts` holds `machineTierCost` (100,000), the per-line base of an extractor, plus `extractorCopyGrowth` (1.3) and `extractorTierGrowth` (1.28). Processor prices use `processorBaseCost` (10), `processorTierGrowth` (1.62), `processorCopyJump` (100) and `processorCopyGrowth` (1.55). `upgradeBase` (6) and `upgradeGrowth` (2) price overclocks. `test/gamedata.test.ts` asserts exact prices, so a change to any of them fails the suite.
