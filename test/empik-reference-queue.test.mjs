import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { listIdentificationJobs } from '../catalog-api.mjs';

test('Empik references remain reviewable outside the main queue and menu count', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    for (const source of ['Empik', 'Vinted']) {
      repository.upsertOffer({
        id: source,
        source,
        normalizedUrl: `https://example.test/${source}`,
        originalTitle: 'Nieznana książka',
      });
      repository.putIdentificationJob({ id: source, offerId: source, status: 'review_required' });
    }
    const main = listIdentificationJobs(repository, { status: 'review_required', view: 'list' });
    assert.equal(main.queueTotal, 1);
    assert.equal(main.total, 1);
    assert.equal(main.items[0].offer.source, 'Vinted');
    assert.equal(main.buckets.reference, 1);
    const references = listIdentificationJobs(repository, {
      status: 'review_required',
      view: 'list',
      bucket: 'reference',
    });
    assert.equal(references.total, 1);
    assert.equal(references.queueTotal, 1);
    assert.equal(references.items[0].offer.source, 'Empik');
    assert.equal(repository.database.prepare('SELECT count(*) n FROM review_decisions').get().n, 0);
  } finally {
    repository.close();
  }
});
