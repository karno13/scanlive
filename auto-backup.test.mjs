import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runAutoBackup } from './auto-backup.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

test('automatic backups are daily, rotated to seven and never touch other backups', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookflip-auto-backup-'));
  try {
    const path = join(directory, 'bookflip-catalog.sqlite');
    new SqliteCatalogRepository(path).close();
    const backups = join(directory, 'backups');
    const extra = join(directory, 'second-disk');
    const day = (n) => new Date(Date.parse('2026-11-01T03:00:00.000Z') + n * 86_400_000);
    const first = await runAutoBackup(path, { now: day(0), extraDirectory: extra });
    assert.ok(first.local.created && first.extra.created);
    assert.equal((await runAutoBackup(path, { now: new Date(day(0).getTime() + 3_600_000) })).local.created, null, 'not twice a day');
    writeFileSync(join(backups, 'bookflip-catalog-pre-migration-2026.sqlite'), 'keep me');
    for (let n = 1; n <= 9; n++) await runAutoBackup(path, { now: day(n) });
    const names = readdirSync(backups).sort();
    assert.equal(names.filter((name) => name.includes('-auto-')).length, 7);
    assert.ok(names.includes('bookflip-catalog-pre-migration-2026.sqlite'));
    assert.ok(names.at(-2).includes('2026-11-10'), 'newest kept');
    assert.equal(readdirSync(extra).length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
