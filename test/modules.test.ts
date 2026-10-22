import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PURE_MODULES = [
  'src/game/gamedata.ts',
  'src/game/palette.ts',
  'src/game/state.ts',
  'src/game/sim.ts',
  'src/game/actions.ts',
  'src/game/directives.ts',
  'src/layout/geometry.ts',
];

test('every pure module imports without a DOM', async () => {
  const modules = await Promise.all(
    PURE_MODULES.map((file) => import(pathToFileURL(resolve(process.cwd(), file)).href)),
  );
  for (const [index, module] of modules.entries()) {
    assert.ok(Object.keys(module).length > 0, `${PURE_MODULES[index]} exports nothing`);
  }
});

test('the source tree only holds TypeScript', async () => {
  const root = resolve(process.cwd(), 'src');
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const stale = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => join(entry.parentPath, entry.name));
  assert.deepEqual(stale, []);
});
