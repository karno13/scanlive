import assert from 'node:assert/strict';
import test from 'node:test';

import { blockedSources } from './source-blocks.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

test('a source is reported blocked only when every recent scan was refused', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const run = (at, errors) =>
      repository.database.prepare('INSERT INTO scan_runs(scanned_at,summary_json,created_at) VALUES(?,?,?)').run(at, JSON.stringify({ errors }), at);
    run('2026-11-01T00:00:00Z', [{ source: 'Allegro', code: 'SOURCE_CAPTCHA' }]);
    run('2026-11-02T00:00:00Z', [{ source: 'Allegro', code: 'SOURCE_CAPTCHA' }, { source: 'OLX', code: 'SOURCE_HTTP_403' }]);
    run('2026-11-03T00:00:00Z', [{ source: 'Allegro', code: 'SOURCE_CAPTCHA' }, { source: 'OLX', code: 'SOURCE_HTTP_403' }, { source: 'Vinted', code: 'SOURCE_HTTP_500' }]);
    assert.deepEqual(blockedSources(repository), { Allegro: 'SOURCE_CAPTCHA' });
    assert.deepEqual(blockedSources(repository, { recentRuns: 2 }), { Allegro: 'SOURCE_CAPTCHA', OLX: 'SOURCE_HTTP_403' });
  } finally {
    repository.close();
  }
});
