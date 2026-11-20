import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { catalogInsights } from '../catalog-insights.mjs';

test('series progress counts offers per first phrase, identified and waiting in review', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    repository.createWork({ id: 'w', title: 'Mort', authors: ['Pratchett, Terry'] });
    repository.createEdition({ id: 'e', workId: 'w', title: 'Mort' });
    const add = (id, queries) =>
      repository.upsertOffer({
        id,
        source: 'Vinted',
        normalizedUrl: `https://example.test/${id}`,
        originalTitle: 'Mort ' + id,
        currentPrice: 2000,
        matchedQueries: queries,
      });
    add('a', ['Pratchett']);
    add('b', ['Pratchett']);
    add('c', ['Pratchett']);
    add('d', ['Warhammer']);
    repository.assignOfferToEdition('a', 'e', { id: 'm_a', method: 'manual', status: 'active' });
    repository.putIdentificationJob({ offerId: 'b', status: 'review_required' });
    repository.putIdentificationJob({ offerId: 'd', status: 'queued' });
    const series = Object.fromEntries(catalogInsights(repository).series.map((s) => [s.phrase, s]));
    assert.deepEqual(
      {
        offers: series.Pratchett.offers,
        matched: series.Pratchett.matched,
        review: series.Pratchett.review,
      },
      { offers: 3, matched: 1, review: 1 },
    );
    assert.equal(series.Warhammer.review, 0, 'a queued job is not waiting for a decision');
  } finally {
    repository.close();
  }
});
