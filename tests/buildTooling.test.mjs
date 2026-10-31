import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSW } from 'workbox-build';
import { rimraf } from 'rimraf';

test('Workbox generates a production worker with the updated glob and template dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'urofolium-workbox-'));
  try {
    await writeFile(join(directory, 'index.html'), '<!doctype html><title>Synthetic fixture</title>');
    const result = await generateSW({
      globDirectory: directory, globPatterns: ['*.html'], swDest: join(directory, 'sw.js'),
      inlineWorkboxRuntime: false, mode: 'production', sourcemap: false,
    });
    assert.equal(result.count, 1);
    assert.deepEqual(result.warnings, []);
    assert.match(await readFile(join(directory, 'sw.js'), 'utf8'), /index\.html/);
    assert.ok((await readdir(directory)).some(name => /^workbox-.*\.js$/.test(name)));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Capacitor removal tooling expands globs while preserving unmatched files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'urofolium-rimraf-'));
  try {
    await Promise.all(['remove-a.txt', 'remove-b.txt', 'keep.txt'].map(name => writeFile(join(directory, name), 'synthetic')));
    await rimraf(join(directory, 'remove-*.txt'), { glob: true });
    assert.deepEqual(await readdir(directory), ['keep.txt']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
