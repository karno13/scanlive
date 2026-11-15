import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { estimateValue, marketValuations, valuationSummary } from '../market-valuation.mjs';
import { listCatalogWorks, listCatalogOfferGroups } from '../catalog-api.mjs';
import { workPriceOverview } from '../edition-variants.mjs';

const AT = Date.parse('2026-11-15T12:00:00Z');
const daysAgo = (days) => new Date(AT - days * 86_400_000).toISOString();
const copy = (price, extra = {}) => ({
  price,
  state: 'live',
  kind: 'private',
  condition: 'good',
  firstSeenAt: daysAgo(10),
  ...extra,
});

test('no prices: no amount, the uncertainty is stated', () => {
  const value = estimateValue([], AT);
  assert.equal(value.estimate, null);
  assert.equal(value.confidence, 'none');
  assert.match(value.reasons[0], /Brak cen/);
  assert.equal(valuationSummary(value), 'brak danych do wyceny');
});

test('confirmed sales lead, asking prices count below face value', () => {
  const value = estimateValue(
    [
      copy(8000, { state: 'sold', soldAt: daysAgo(20) }),
      copy(8500, { state: 'sold', soldAt: daysAgo(30) }),
      copy(9000, { state: 'sold', soldAt: daysAgo(40) }),
      copy(12000),
    ],
    AT,
  );
  assert.equal(value.basis, 'mixed');
  assert.equal(value.confidence, 'high');
  assert.ok(value.estimate >= 8000 && value.estimate <= 9000, String(value.estimate));
  assert.ok(value.low < value.estimate && value.high > value.estimate);
  assert.ok(value.reasons.some((reason) => /3 potwierdzone sprzedaże/.test(reason)));
});

test('an inflated price is left out and named in the reasons', () => {
  const prices = [3000, 3200, 3500, 3300, 30000];
  const value = estimateValue(
    prices.map((price) => copy(price)),
    AT,
  );
  assert.equal(value.excluded, 1);
  assert.ok(value.high < 5000, String(value.high));
  assert.ok(value.reasons.some((reason) => /nietypow/.test(reason)));
  // Only asking prices: no sale behind it, so not high confidence.
  assert.notEqual(value.confidence, 'high');
  assert.equal(value.basis, 'asking');
});

test('one offer gives a wide range and low confidence', () => {
  const value = estimateValue([copy(5000)], AT);
  assert.equal(value.confidence, 'low');
  assert.ok(value.high / value.low >= 1.5);
  assert.ok(value.reasons.some((reason) => /orientacyjn/.test(reason)));
});

test('condition and shop prices are brought to a good used copy', () => {
  const worn = estimateValue([copy(4000, { condition: 'satisfactory' })], AT);
  const good = estimateValue([copy(4000)], AT);
  assert.ok(worn.estimate < good.estimate);
  const shop = estimateValue([copy(5000, { kind: 'new_shop', condition: 'unknown' })], AT);
  assert.equal(shop.confidence, 'low');
  assert.ok(shop.estimate <= 3000, String(shop.estimate));
  assert.ok(shop.reasons.some((reason) => /sklep/.test(reason)));
});

test('trend of sold prices and a plentiful supply are reported', () => {
  const observations = [
    copy(4000, { state: 'sold', soldAt: daysAgo(10) }),
    copy(4200, { state: 'sold', soldAt: daysAgo(20) }),
    copy(3000, { state: 'sold', soldAt: daysAgo(150) }),
    copy(3000, { state: 'sold', soldAt: daysAgo(160) }),
    ...Array.from({ length: 8 }, () => copy(3800)),
  ];
  const value = estimateValue(observations, AT);
  assert.equal(value.trend.basis, 'sold');
  assert.ok(value.trend.percent > 30);
  assert.equal(value.supply, 'plentiful');
  assert.ok(value.reasons.some((reason) => /Duża podaż/.test(reason)));
});

test('valuations come with the works list, the edition groups and the book page', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    repository.createWork({ id: 'w', title: 'Mort', authors: ['Pratchett, Terry'] });
    repository.createEdition({ id: 'e', workId: 'w', title: 'Mort', publisher: 'Prószyński' });
    repository.createWork({ id: 'w2', title: 'Pusta', authors: [] });
    const add = (id, price, availability) => {
      repository.upsertOffer({
        id,
        source: 'Vinted',
        normalizedUrl: `https://example.test/${id}`,
        originalTitle: 'Mort',
        currentPrice: price,
        conditionClass: 'good',
        availability,
      });
      repository.assignOfferToEdition(id, 'e', {
        id: 'm_' + id,
        method: 'manual',
        status: 'active',
      });
    };
    add('a', 2500, 'sold');
    add('b', 2600, 'sold');
    add('c', 2800);
    add('d', 2700, 'unavailable');
    const works = listCatalogWorks(repository, {}).items;
    const mort = works.find((row) => row.id === 'w').valuation;
    assert.equal(mort.sold, 2);
    assert.equal(mort.live, 1, 'a removed listing is not counted');
    assert.ok(mort.estimate >= 2400 && mort.estimate <= 2800, String(mort.estimate));
    assert.equal(works.find((row) => row.id === 'w2').valuation.confidence, 'none');
    const group = listCatalogOfferGroups(repository, {}).items.find((row) => row.editionId === 'e');
    assert.deepEqual(group.valuation, mort);
    const overview = workPriceOverview(repository, 'w');
    assert.deepEqual(overview.valuation, mort);
    assert.deepEqual(overview.editionValuations.e, mort);
    // Many ids at once: one query, every id answered.
    const many = marketValuations(repository.database, 'work', ['w', 'w2', 'missing']);
    assert.equal(many.size, 3);
  } finally {
    repository.close();
  }
});
