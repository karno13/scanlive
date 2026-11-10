import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { listCatalogOfferGroups, listCatalogOffers } from './catalog-api.mjs';

test('offers grouped by edition: count, price range, sources; filters apply; unassigned counted', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const at = '2026-11-08T10:00:00Z';
    const work = repository.createWork({ title: 'Fourth Wing', authors: ['Rebecca Yarros'] });
    const edition = repository.createEdition({ workId: work.id, title: 'Fourth Wing', publisher: 'Filia', publicationYear: 2023 });
    const other = repository.createWork({ title: 'Iron Flame', authors: ['Rebecca Yarros'] });
    const ironEdition = repository.createEdition({ workId: other.id, title: 'Iron Flame', publisher: 'Filia', publicationYear: 2024 });
    const offer = (n, source, price, editionId) => {
      const row = repository.upsertOffer({ source, normalizedUrl: `https://www.vinted.pl/items/${n}-x`, originalTitle: 'Fourth wing ' + n, currentPrice: price, at });
      if (editionId) repository.assignOfferToEdition(row.id, editionId, { id: 'm' + n, method: 'structured_isbn', status: 'active', reason: 'isbn', createdBy: 'system', at });
      return row;
    };
    offer(1, 'Vinted', 5000, edition.id);
    offer(2, 'Vinted', 3000, edition.id);
    offer(3, 'Vinted', 10052, edition.id);
    offer(4, 'Vinted', 8000, ironEdition.id);
    offer(5, 'Vinted', 4000, null);
    const groups = listCatalogOfferGroups(repository, {});
    assert.equal(groups.total, 2);
    assert.equal(groups.unassigned, 1);
    const fourth = groups.items[0];
    assert.deepEqual(
      { title: fourth.workTitle, offers: fourth.offers, min: fourth.minPrice, max: fourth.maxPrice, sources: fourth.sources, publisher: fourth.publisher },
      { title: 'Fourth Wing', offers: 3, min: 3000, max: 10052, sources: ['Vinted'], publisher: 'Filia' },
    );
    assert.equal(listCatalogOfferGroups(repository, { maxPrice: '40' }).total, 1);
    assert.equal(listCatalogOffers(repository, { edition: edition.id }).total, 3);
  } finally {
    repository.close?.();
  }
});
