import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRouter } from '../router.mjs';
import { apiRoutes } from '../api-routes.mjs';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { createProductionCatalog } from '../catalog-production.mjs';
import { listIdentificationJobs } from '../review-queue.mjs';
import { findWorkByKey, refreshWorkKeys } from '../work-grouping.mjs';
import { DEFAULT_UNIVERSES, saveUniverse, setUniverses } from '../universes.mjs';
import { runOnce } from '../startup-jobs.mjs';

test('the router matches in order, decodes parameters once and tells a wrong method from an unknown path', () => {
  const calls = [];
  const router = createRouter()
    .add('GET', '/api/catalog/works/:id/prices', () => calls.push('prices'))
    .add('GET', '/api/catalog/works/:id', () => calls.push('work'))
    .add(['POST', 'DELETE'], '/api/set-unknown/:offerId/:itemId?', () => calls.push('unknown'))
    .add('*', '/api/buyback/*', () => calls.push('buyback'));
  assert.deepEqual(router.match('GET', '/api/catalog/works/Vinted%3A42/prices').params, {
    id: 'Vinted:42',
  });
  assert.equal(router.match('GET', '/api/catalog/works/w%2F1').params.id, 'w/1');
  assert.deepEqual(router.match('DELETE', '/api/set-unknown/a/b').params, {
    offerId: 'a',
    itemId: 'b',
  });
  assert.deepEqual(router.match('POST', '/api/set-unknown/a').params, { offerId: 'a' });
  assert.ok(router.match('PUT', '/api/buyback').handler);
  assert.ok(router.match('GET', '/api/buyback/quotes').handler);
  assert.deepEqual(router.match('PUT', '/api/catalog/works/x'), { methodNotAllowed: true });
  assert.equal(router.match('GET', '/api/nothing'), null);
  // api-routes's own table: what used to be a prefix regex in local-app.mjs.
  assert.ok(apiRoutes.match('PUT', '/api/catalog/works/w1').handler);
  assert.ok(
    !apiRoutes.match('GET', '/api/catalog/works/w1').handler,
    'GET of a work is served by local-app',
  );
  assert.ok(apiRoutes.match('POST', '/api/offer-relists/Vinted%3A1/undo').handler);
});

test('offer_queries follows matched_queries_json on every write', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    const offer = repo.upsertOffer({
      source: 'Vinted',
      normalizedUrl: 'https://www.vinted.pl/items/11-x',
      originalTitle: 'X',
      currentPrice: 1000,
      matchedQueries: ['Mort', 'Pratchett'],
    });
    const rows = () =>
      repo.database
        .prepare('SELECT query FROM offer_queries WHERE offer_id=? ORDER BY position')
        .all(offer.id)
        .map((row) => row.query);
    assert.deepEqual(rows(), ['Mort', 'Pratchett']);
    repo.upsertOffer({
      id: offer.id,
      source: 'Vinted',
      normalizedUrl: 'https://www.vinted.pl/items/11-x',
      matchedQueries: ['Świat Dysku'],
    });
    assert.deepEqual(rows(), ['Świat Dysku']);
    repo.database
      .prepare('UPDATE offers SET matched_queries_json=\'["A","A","B"]\' WHERE id=?')
      .run(offer.id);
    assert.deepEqual(rows(), ['A', 'B']);
  } finally {
    repo.close();
  }
});

test('work keys are indexed and follow edits of a work and of the universes', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    repo.createWork({ id: 'w1', title: 'Wiedźmin: Krew elfów', authors: ['Sapkowski, Andrzej'] });
    repo.createWork({ id: 'w2', title: 'Mort', authors: ['Pratchett, Terry'] });
    assert.equal(findWorkByKey(repo, 'Mort', ['Terry Pratchett'])?.id, 'w2');
    assert.equal(repo.database.prepare('SELECT count(*) AS n FROM work_keys_dirty').get().n, 0);
    assert.equal(findWorkByKey(repo, 'Krew elfów', ['Andrzej Sapkowski']), null);
    // A new universe changes the main title of w1: its key is recomputed.
    saveUniverse(repo, { name: 'Wiedźmin', names: ['The Witcher'] });
    assert.equal(findWorkByKey(repo, 'Krew elfów', ['Andrzej Sapkowski'])?.id, 'w1');
    // A renamed work is found under its new key only.
    repo.database.prepare("UPDATE works SET title='Mort (nowe wydanie)' WHERE id='w2'").run();
    assert.equal(findWorkByKey(repo, 'Mort', ['Terry Pratchett']), null);
    assert.equal(refreshWorkKeys(repo), 0, 'nothing left to recompute');
  } finally {
    repo.close();
    setUniverses(DEFAULT_UNIVERSES);
  }
});

test('one-time start-up jobs run once and leave a flag', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookflip-startup-'));
  const path = join(directory, 'catalog.sqlite');
  try {
    let store = createProductionCatalog({
      databasePath: path,
      fetcher: async () => assert.fail('no network'),
    });
    const flags = store.repository.database
      .prepare(
        "SELECT key FROM app_preferences WHERE key IN ('repeat_rejections_undo_v1','repeat_rejections_v1','foreign_editions_v1','publisher_names_v1') ORDER BY key",
      )
      .all()
      .map((row) => row.key);
    assert.deepEqual(flags, [
      'foreign_editions_v1',
      'publisher_names_v1',
      'repeat_rejections_undo_v1',
      'repeat_rejections_v1',
    ]);
    let ran = 0;
    assert.deepEqual(
      runOnce(store.repository, 'test_job_v1', () => ({ ran: ++ran })),
      { ran: 1 },
    );
    store.repository.close();
    store = createProductionCatalog({
      databasePath: path,
      fetcher: async () => assert.fail('no network'),
    });
    assert.deepEqual(
      runOnce(store.repository, 'test_job_v1', () => ({ ran: ++ran })),
      { skipped: true },
    );
    assert.equal(ran, 1);
    store.repository.close();
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('the review queue sorts by offer price either way, offers without a price last', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    for (const [n, price] of [
      [1, 2000],
      [2, null],
      [3, 9000],
      [4, 500],
    ]) {
      const offer = repo.upsertOffer({
        source: 'Vinted',
        normalizedUrl: `https://www.vinted.pl/items/${n}0-x`,
        originalTitle: 'T' + n,
        currentPrice: price,
      });
      repo.putIdentificationJob({ offerId: offer.id, status: 'review_required' });
    }
    const order = (sort) =>
      listIdentificationJobs(repo, { status: 'review_required', sort }).items.map(
        (job) => job.offer.currentPrice,
      );
    assert.deepEqual(order('price-desc'), [9000, 2000, 500, null]);
    assert.deepEqual(order('price'), [500, 2000, 9000, null]);
  } finally {
    repo.close();
  }
});
