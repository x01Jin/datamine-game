import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');
const files = readdirSync(srcDir).filter((file) => file.endsWith('.js'));

test('every module under src parses', () => {
  assert.ok(files.length >= 14);
  for (const file of files) {
    execFileSync(process.execPath, ['--check', join(srcDir, file)], { stdio: 'pipe' });
  }
});

test('every side effect free module under src imports', async () => {
  for (const file of files) {
    if (file === 'main.js') continue;
    const module = await import(pathToFileURL(join(srcDir, file)).href);
    assert.ok(module, `${file} did not export a module`);
  }
});
