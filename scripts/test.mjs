import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'urofolium-tests-'));
try {
  const bundled = ['backupValidation', 'catalog', 'encryptedVault', 'migrationReview'];
  for (const name of bundled) {
    await build({ entryPoints: [`tests/${name}.test.ts`], bundle: true, platform: 'node', format: 'cjs', outfile: join(directory, `${name}.test.cjs`), logLevel: 'silent' });
  }
  const result = spawnSync(process.execPath, ['--test', ...bundled.map(name => join(directory, `${name}.test.cjs`)), resolve('tests/database.test.ts'), resolve('tests/procedureWorkbook.test.mjs'), resolve('tests/backupService.test.mjs')], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
