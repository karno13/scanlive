import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { catalogGaps } from '../catalog-insights.mjs';
import { listCatalogWorks } from '../catalog-api.mjs';

test('"Braki w katalogu" counts equal the totals of the works list filtered by gap', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const add = (id, edition) => {
      repository.createWork({
        id,
        title: 'Dzieło ' + id,
        authors: ['A'],
        verificationStatus: 'verified',
      });
      repository.createEdition({
        id: 'e' + id,
        workId: id,
        title: 'Dzieło ' + id,
        verificationStatus: 'verified',
        ...edition,
      });
    };
    add('w1', { publisher: 'Zysk', publicationYear: 2020 });
    add('w2', { publicationYear: 2019 });
    add('w3', { publisher: 'Rebis' });
    add('w4', {});
    add('w5', { publisher: 'Rebis', publicationYear: 2001 });
    repository.database
      .prepare(
        "UPDATE editions SET is_unknown=1, publisher=NULL, publication_year=NULL WHERE id='ew4'",
      )
      .run();
    const gaps = catalogGaps(repository);
    // The unsettled edition of w4 is not a gap of publisher or year: it has neither by design.
    assert.deepEqual(
      {
        p: gaps.withoutPublisher,
        y: gaps.withoutYear,
        u: gaps.unknown,
        real: gaps.editions,
        ok: gaps.completeEditions,
        pct: gaps.completePct,
      },
      { p: 1, y: 1, u: 1, real: 4, ok: 2, pct: 50 },
    );
    const total = (gap) => listCatalogWorks(repository, { gap, limit: 50 }).total;
    assert.equal(total('publisher'), gaps.withoutPublisher);
    assert.equal(total('year'), gaps.withoutYear);
    assert.equal(total('unknown'), gaps.unknown);
    assert.equal(listCatalogWorks(repository, { limit: 50 }).total, 5);
  } finally {
    repository.close();
  }
});
