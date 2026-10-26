import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG,
  dataInfo,
  recipeFor,
  extractorCost,
  processorCost,
  upgradeCost,
  costText,
  levelSpeed,
  globalSpeed,
  fmt,
  fmtRate,
  fmtDuration,
  tierLabel,
} from '../src/game/gamedata.ts';
import { hex, tierColor } from '../src/game/palette.ts';

function tierColorHex(tier: number): string {
  return hex(tierColor(tier));
}

test('tier names stay unique and procedural tiers keep expanding', () => {
  const names = new Set<string>();
  for (let tier = 0; tier < 400; tier++) {
    const info = dataInfo(tier);
    assert.ok(info.name.length > 0);
    assert.ok(!names.has(info.name), `duplicate name at tier ${tier}: ${info.name}`);
    names.add(info.name);
    assert.equal(info.tier, tier);
  }
  assert.equal(dataInfo(0).name, 'Raw Data');
  assert.equal(dataInfo(9).name, 'Singularity');
  assert.match(dataInfo(10).name, / 10$/);
});

test('tier colours come from the palette ramp', () => {
  for (let tier = 0; tier < 60; tier++) {
    assert.match(dataInfo(tier).color, /^#[0-9a-f]{6}$/);
  }
  assert.notEqual(dataInfo(0).color, dataInfo(9).color);
  assert.notEqual(dataInfo(9).color, dataInfo(10).color);
  assert.equal(dataInfo(3).color, tierColorHex(3));
  assert.equal(dataInfo(13).color, tierColorHex(13));
});

test('recipes braid the two previous tiers', () => {
  assert.equal(recipeFor(0), null);
  assert.deepEqual(recipeFor(1)!.inputs, [{ tier: 0, amount: 2 }]);
  assert.deepEqual(recipeFor(2)!.inputs, [
    { tier: 1, amount: 1 },
    { tier: 0, amount: 1 },
  ]);
  assert.deepEqual(recipeFor(8)!.inputs, [
    { tier: 7, amount: 1 },
    { tier: 6, amount: 1 },
  ]);
  assert.equal(recipeFor(8)!.output.tier, 8);
  assert.equal(recipeFor(8)!.output.amount, 1);
});

test('costs are whole prices and climb with ownership and tier', () => {
  assert.deepEqual(extractorCost(0), [{ tier: 0, amount: CONFIG.machineTierCost }]);
  assert.deepEqual(extractorCost(1), [{ tier: 0, amount: 100_000 }]);
  assert.deepEqual(extractorCost(2), [
    { tier: 0, amount: 100_000 },
    { tier: 1, amount: 100_000 },
  ]);
  assert.deepEqual(processorCost(1, 0), [{ tier: 0, amount: 10 }]);
  assert.deepEqual(processorCost(2, 0), [{ tier: 1, amount: 17 }]);
  assert.deepEqual(processorCost(1, 1), [{ tier: 0, amount: 1000 }]);
  assert.deepEqual(processorCost(1, 2), [{ tier: 1, amount: 1550 }]);
  assert.deepEqual(processorCost(1, 3), [{ tier: 2, amount: 2403 }]);
  assert.deepEqual(processorCost(1, 4), [{ tier: 3, amount: 3724 }]);
  assert.deepEqual(processorCost(2, 1), [{ tier: 1, amount: 1700 }]);
  assert.deepEqual(processorCost(2, 2), [{ tier: 2, amount: 2635 }]);
  assert.deepEqual(upgradeCost({ kind: 'extractor', level: 1 }), { tier: 0, amount: 6 });
  assert.deepEqual(upgradeCost({ kind: 'processor', tier: 3, level: 2 }), { tier: 3, amount: 12 });
});

test('cost text lists every line in tier order', () => {
  assert.equal(costText({ tier: 0, amount: 6 }), '6 Raw Data');
  assert.equal(
    costText([
      { tier: 2, amount: 100_000 },
      { tier: 0, amount: 2403 },
      { tier: 1, amount: 100_000 },
    ]),
    '2.4k Raw Data + 100k Clean Bits + 100k Signals',
  );
});

test('speed curves are monotonic', () => {
  assert.equal(levelSpeed(1), 1);
  assert.equal(levelSpeed(2), 1.5);
  assert.equal(globalSpeed(1), 1);
  assert.ok(globalSpeed(10) > globalSpeed(5));
});

test('number formatting handles the long tail', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(0.5), '0.50');
  assert.equal(fmt(9.94), '9.9');
  assert.equal(fmt(999), '999');
  assert.equal(fmt(1000), '1k');
  assert.equal(fmt(1250000), '1.25M');
  assert.equal(fmt(999999), '1M');
  assert.equal(fmt(999499), '999k');
  assert.equal(fmt(1e12), '1T');
  assert.match(fmt(1e70), /e\d/);
  assert.equal(fmt(-12), '-12');
  assert.equal(fmtRate(0.5), '0.50/s');
  assert.equal(fmtRate(0.001), '<0.01/s');
  assert.equal(fmtDuration(65), '1m 05s');
  assert.equal(tierLabel(0), 'T00');
  assert.equal(tierLabel(12), 'T12');
});
