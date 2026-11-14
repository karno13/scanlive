import assert from 'node:assert/strict';
import test from 'node:test';

import { createProductionCatalog } from './catalog-production.mjs';
import { searchOffers, validateSearchInput } from './scan-engine.mjs';
import { searchUrl } from './marketplaces.mjs';
import { putScanProfile } from './scan-profiles-api.mjs';
import { createScanScheduler, getScanSchedule, saveScanSchedule } from './scan-schedule.mjs';
import { persistSqliteScan } from './sqlite-single-store.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

test('the quick scan reads one page of the newest listings, only where a source sorts by date', async () => {
  assert.throws(
    () => validateSearchInput({ queries: ['mort'], sources: ['Empik'], mode: 'newest' }),
    /NEWEST_SCAN_NEEDS_SORTABLE_SOURCE/,
  );
  assert.equal(
    validateSearchInput({ queries: ['mort'], sources: ['Vinted'] }).mode,
    undefined,
    'the full scan is unchanged',
  );
  const urls = [];
  const result = await searchOffers(
    { queries: ['mort'], sources: ['Vinted', 'Empik'], mode: 'newest', polishOnly: false },
    {
      scanner: async (task) => {
        urls.push(searchUrl({ ...task, host: task.host }));
        // Every page claims there is a next one: the quick scan must still stop after the first.
        return { offers: [], rejected: {}, pagination: { state: 'more', nextPage: task.page + 1 } };
      },
      retryWait: async () => {},
    },
  );
  assert.equal(urls.length, 1);
  assert.match(
    urls[0],
    /vinted\.pl\/catalog\/2312-books\?search_text=mort&order=newest_first&page=1/,
  );
  assert.equal(result.mode, 'newest');
  assert.equal(result.results[0].pagination.state, 'limit');
});

test('a quick scan never marks offers as gone; a full one does', () => {
  const store = createProductionCatalog({
    databasePath: ':memory:',
    fetcher: async () => assert.fail('no network'),
  });
  try {
    const db = store.repository.database;
    const offer = {
      source: 'Vinted',
      url: 'https://www.vinted.pl/items/77-mort',
      title: 'Mort',
      price: 2000,
      language: 'Polski',
      matchedQueries: ['mort'],
    };
    persistSqliteScan(store, { offers: [offer], searchedAt: '2026-11-01T10:00:00.000Z' });
    // A short phrase: one page is the whole result list ("end"), and the offer is not on it.
    const results = [
      { source: 'Vinted', query: 'mort', status: 'ok', pagination: { state: 'end' } },
    ];
    persistSqliteScan(store, {
      offers: [],
      searchedAt: '2026-11-02T10:00:00.000Z',
      scanContext: { results, mode: 'newest' },
    });
    assert.equal(db.prepare('SELECT availability FROM offers').get().availability, 'unconfirmed');
    persistSqliteScan(store, {
      offers: [],
      searchedAt: '2026-11-03T10:00:00.000Z',
      scanContext: { results },
    });
    assert.equal(db.prepare('SELECT availability FROM offers').get().availability, 'not_seen');
  } finally {
    store.close();
  }
});

test('the quick scan has its own interval, is off by default and gives way to the full scan', async () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    putScanProfile(repo, 'Fantasy', { queries: ['Warcraft'], sources: ['Vinted', 'Empik'] });
    assert.equal(getScanSchedule(repo).quick.enabled, false);
    assert.throws(
      () =>
        saveScanSchedule(repo, {
          enabled: false,
          profile: 'Fantasy',
          everyHours: 12,
          quick: { enabled: true, everyHours: 48 },
        }),
      /INVALID_QUICK_SCAN_INTERVAL/,
    );
    saveScanSchedule(repo, {
      enabled: true,
      profile: 'Fantasy',
      everyHours: 12,
      quick: { enabled: true, everyHours: 2 },
    });
    let clock = Date.parse('2026-11-10T12:00:00Z');
    const calls = [];
    const scheduler = createScanScheduler({
      getRepository: () => repo,
      runScan: async (input) => (calls.push(input), 200),
      now: () => clock,
    });
    await scheduler.tick();
    assert.deepEqual(
      calls.at(-1),
      { queries: ['Warcraft'], sources: ['Vinted', 'Empik'] },
      'the full scan first',
    );
    clock += 3 * 3_600_000;
    await scheduler.tick();
    assert.deepEqual(calls.at(-1), { queries: ['Warcraft'], sources: ['Vinted'], mode: 'newest' });
    assert.equal(getScanSchedule(repo).quick.lastResult, 'ok');
    clock += 3_600_000;
    assert.deepEqual(await scheduler.tick(), { skipped: 'not-due' });
    assert.equal(calls.length, 2);
  } finally {
    repo.close();
  }
});
