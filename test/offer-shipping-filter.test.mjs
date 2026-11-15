import assert from 'node:assert/strict';
import test from 'node:test';

import { countCatalogOffers, listCatalogOffers } from '../catalog-api.mjs';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';

test('Oferty can be filtered by delivery: free, paid, unknown', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const at = '2026-11-15T00:00:00.000Z';
    for (const [id, cost] of [
      ['free', 0],
      ['paid', 999],
      ['unknown', null],
    ]) {
      repository.upsertOffer({
        id,
        source: 'Vinted',
        normalizedUrl: 'https://www.vinted.pl/items/1' + id.length + '-' + id,
        originalTitle: id,
        currentPrice: 2000,
        lastSeenAt: at,
        firstSeenAt: at,
      });
      repository.database.prepare('UPDATE offers SET shipping_cost=? WHERE id=?').run(cost, id);
    }
    const ids = (shipping) => {
      const result = listCatalogOffers(repository, { shipping });
      const rows = Array.isArray(result) ? result : (result.items ?? result.offers);
      return rows.map((row) => row.id).sort();
    };
    assert.deepEqual(ids('free'), ['free']);
    assert.deepEqual(ids('paid'), ['paid']);
    assert.deepEqual(ids('unknown'), ['unknown']);
    assert.deepEqual(ids(''), ['free', 'paid', 'unknown']);
    assert.equal(countCatalogOffers(repository, { shipping: 'free' }), 1);
  } finally {
    repository.close?.();
  }
});
