import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { fillShippingCosts, pendingShippingChecks } from '../shipping-backfill.mjs';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';

const detailPage = readFileSync(
  new URL('../fixtures/details/vinted-item-captured.html', import.meta.url),
  'utf8',
);
const URL_FREE = 'https://www.vinted.pl/items/9000000002-faust-erik-terry-pratchett';

test('saved Vinted offers get their delivery price from the listing page, once', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const at = '2026-11-10T00:00:00.000Z';
    for (const [id, url, price] of [
      ['free', URL_FREE, 4000],
      ['plain', 'https://www.vinted.pl/items/9000000003-x', 3000],
      ['gone', 'https://www.vinted.pl/items/9000000004-y', 2000],
      ['sold', 'https://www.vinted.pl/items/9000000005-z', 1000],
      ['known', 'https://www.vinted.pl/items/9000000006-w', 500],
    ])
      repository.upsertOffer({
        id,
        source: 'Vinted',
        normalizedUrl: url,
        originalTitle: id,
        currentPrice: price,
        lastSeenAt: at,
        firstSeenAt: at,
      });
    const db = repository.database;
    db.prepare("UPDATE offers SET availability='sold' WHERE id='sold'").run();
    db.prepare("UPDATE offers SET shipping_cost=999 WHERE id='known'").run();
    assert.deepEqual(
      pendingShippingChecks(repository).map((row) => row.id),
      ['free', 'plain', 'gone'],
      'only listings for sale without a price, the most expensive first',
    );

    const reads = [];
    const report = await fillShippingCosts(repository, {
      now: () => new Date('2026-11-15T12:00:00.000Z'),
      fetchHtml: async (url) => {
        reads.push(url);
        if (url.includes('9000000004')) throw Object.assign(Error('HTTP_404'), { status: 404 });
        return url === URL_FREE ? detailPage : '<html></html>';
      },
    });
    assert.deepEqual(report, {
      checked: 2,
      found: 1,
      free: 1,
      missing: 1,
      removed: 1,
      paused: false,
    });
    const cost = (id) => db.prepare('SELECT shipping_cost FROM offers WHERE id=?').get(id);
    assert.equal(cost('free').shipping_cost, 0);
    assert.equal(cost('plain').shipping_cost, null);
    assert.equal(cost('known').shipping_cost, 999);
    // Every page was tried once; nothing is read again.
    assert.equal(pendingShippingChecks(repository).length, 0);
    assert.equal(reads.length, 3);
  } finally {
    repository.close?.();
  }
});

test('a refused page stops the round and nothing is marked as checked', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const at = '2026-11-10T00:00:00.000Z';
    repository.upsertOffer({
      id: 'a',
      source: 'Vinted',
      normalizedUrl: URL_FREE,
      originalTitle: 'a',
      currentPrice: 4000,
      lastSeenAt: at,
      firstSeenAt: at,
    });
    const report = await fillShippingCosts(repository, {
      fetchHtml: async () => {
        throw Object.assign(Error('SOURCE_BLOCKED'), { blocked: true });
      },
    });
    assert.equal(report.paused, true);
    assert.equal(pendingShippingChecks(repository).length, 1);
  } finally {
    repository.close?.();
  }
});
