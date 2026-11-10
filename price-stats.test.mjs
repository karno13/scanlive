import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { workPriceOverview } from './edition-variants.mjs';
import { offerKind, offerKindSql } from './offer-kinds.mjs';
import { groupedPriceStats } from './price-stats.mjs';

test('the kind of an offer follows from where it is sold', () => {
  assert.equal(offerKind({ source: 'Empik', sellerName: 'Empik' }), 'new_shop');
  assert.equal(
    offerKind({ source: 'Empik', sellerName: 'Antykwariat i Księgarnia Tezeusz' }),
    'antiquarian',
  );
  assert.equal(offerKind({ source: 'Empik', sellerName: 'Bookland' }), 'new_shop');
  assert.equal(offerKind({ source: 'Dedalus.pl' }), 'new_shop');
  assert.equal(offerKind({ source: 'Tezeusz.pl' }), 'antiquarian');
  assert.equal(offerKind({ source: 'Vinted' }), 'private');
  assert.equal(offerKind({ source: 'Allegro Lokalnie' }), 'private');
  // The SQL expression applies the same rules.
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const rows = [
      ['Empik', 'Empik', 'new_shop'],
      ['Empik', 'Antykwariat Tezeusz', 'antiquarian'],
      ['Tezeusz.pl', null, 'antiquarian'],
      ['Vinted', null, 'private'],
    ];
    for (const [source, sellerName, kind] of rows) {
      const offer = repository.upsertOffer({
        source,
        normalizedUrl: `https://example.test/${source}/${kind}`,
        originalTitle: 'X',
        currentPrice: 1000,
        sellerName,
      });
      assert.equal(
        repository.database
          .prepare(`SELECT ${offerKindSql('o')} AS kind FROM offers o WHERE id=?`)
          .get(offer.id).kind,
        kind,
      );
    }
  } finally {
    repository.close();
  }
});

test('the SQL median matches the usual definition for odd and even counts', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const prices = [1000, 4000, 2000, 3000, 9000];
    prices.forEach((price, index) =>
      repository.upsertOffer({
        id: 'o' + index,
        source: 'Vinted',
        normalizedUrl: `https://www.vinted.pl/items/${index}1-x`,
        originalTitle: 'X',
        currentPrice: price,
      }),
    );
    const all = groupedPriceStats(repository.database, 'SELECT id AS offer_id FROM offers').all;
    assert.deepEqual([all.live, all.median, all.min, all.max], [5, 3000, 1000, 9000]);
    const even = groupedPriceStats(
      repository.database,
      "SELECT id AS offer_id FROM offers WHERE id<>'o4'",
    ).all;
    assert.equal(even.median, 2500);
  } finally {
    repository.close();
  }
});

test('book prices compare like with like: per kind, per condition, Vinted sales apart', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    repository.createWork({ id: 'w', title: 'Mort', authors: ['Pratchett, Terry'] });
    repository.createEdition({
      id: 'e',
      workId: 'w',
      title: 'Mort',
      publisher: 'Prószyński i S-ka',
      publicationYear: 2010,
    });
    const add = (id, source, price, { sellerName = null, condition = null, availability } = {}) => {
      repository.upsertOffer({
        id,
        source,
        normalizedUrl: `https://example.test/${id}`,
        originalTitle: 'Mort',
        currentPrice: price,
        sellerName,
        conditionText: condition,
        conditionClass:
          condition === 'Bardzo dobry' ? 'very_good' : condition === 'Dobry' ? 'good' : undefined,
        availability,
      });
      repository.assignOfferToEdition(id, 'e', {
        id: 'm_' + id,
        method: 'manual',
        status: 'active',
      });
    };
    add('empik', 'Empik', 4999, { sellerName: 'Empik' });
    add('antyk', 'Empik', 2500, { sellerName: 'Antykwariat i Księgarnia Tezeusz' });
    add('v1', 'Vinted', 1500, { condition: 'Bardzo dobry' });
    add('v2', 'Vinted', 2500, { condition: 'Dobry' });
    add('v3', 'Vinted', 3000, { condition: 'Bardzo dobry', availability: 'sold' });
    add('v4', 'Vinted', 2000, { condition: 'Dobry', availability: 'sold' });
    const overview = workPriceOverview(repository, 'w');
    const kind = (name) => overview.kinds.find((row) => row.kind === name);
    assert.deepEqual([kind('new_shop').live, kind('new_shop').median], [1, 4999]);
    assert.deepEqual([kind('antiquarian').live, kind('antiquarian').median], [1, 2500]);
    assert.deepEqual(
      [kind('private').live, kind('private').median, kind('private').sold],
      [2, 2000, 2],
    );
    assert.deepEqual(overview.vintedSold, { count: 2, median: 2500, min: 2000, max: 3000 });
    const condition = (name) => overview.conditions.find((row) => row.condition === name);
    assert.equal(condition('very_good').median, 1500);
    assert.equal(condition('very_good').soldMedian, 3000);
    assert.equal(condition('unknown').live, 2, 'shop offers have no condition');
    assert.equal(overview.offers.find((row) => row.id === 'antyk').kind, 'antiquarian');
  } finally {
    repository.close();
  }
});
