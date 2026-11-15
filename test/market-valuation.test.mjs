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
  // A worn copy at 40 zł means a good one is worth more, a new one at 40 zł means less.
  assert.ok(worn.estimate > good.estimate);
  assert.ok(worn.reasons.some((reason) => /zadowalający \+25%/.test(reason)));
  assert.ok(!good.reasons.some((reason) => /sprowadzone/.test(reason)));
  assert.ok(estimateValue([copy(4000, { condition: 'new' })], AT).estimate < good.estimate);
  const shop = estimateValue([copy(5000, { kind: 'new_shop', condition: 'unknown' })], AT);
  assert.equal(shop.confidence, 'low');
  assert.equal(shop.estimate, 3000);
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

test('shop offers are not supply, and old sales alone do not give high confidence', () => {
  const shops = Array.from({ length: 9 }, () => copy(5000, { kind: 'new_shop' }));
  const value = estimateValue([...shops, copy(3000), copy(3200)], AT);
  assert.equal(value.supply, 'normal');
  const old = estimateValue(
    [400, 500, 600].map((days) => copy(8000, { state: 'sold', soldAt: daysAgo(days) })),
    AT,
  );
  assert.equal(old.confidence, 'medium');
});

test('asking-price trend needs a real share of changed used offers', () => {
  const steady = Array.from({ length: 20 }, () => copy(3000, { firstPrice: 3000 }));
  const few = estimateValue(
    [...steady, copy(1500, { firstPrice: 3000 }), copy(1500, { firstPrice: 3000 })],
    AT,
  );
  assert.equal(few.trend, null);
  const shop = copy(9000, { kind: 'new_shop', firstPrice: 3000 });
  const many = estimateValue(
    [shop, copy(3000), ...[2700, 2700, 2400].map((price) => copy(price, { firstPrice: 3000 }))],
    AT,
  );
  assert.deepEqual(many.trend, { percent: -10, basis: 'asking', changed: 3, of: 4 });
  assert.ok(many.reasons.some((reason) => /3 z 4 ofert zmieniło cenę, zwykle o −10%/.test(reason)));
});

test('new listings are reported only with a history to compare with', () => {
  const fresh = [copy(3000), copy(3100), copy(3200)];
  const text = (value) => value.reasons.join(' ');
  assert.doesNotMatch(
    text(estimateValue(fresh, AT, { trackedSince: AT - 14 * 86_400_000 })),
    /nowe oferty/,
  );
  assert.match(
    text(estimateValue(fresh, AT, { trackedSince: AT - 90 * 86_400_000 })),
    /3 nowe oferty/,
  );
});

test('a book whose editions are priced apart gets the range of its editions', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    repository.createWork({ id: 'w', title: 'Mort', authors: [] });
    repository.createEdition({ id: 'hard', workId: 'w', title: 'Mort', binding: 'oprawa twarda' });
    repository.createEdition({ id: 'soft', workId: 'w', title: 'Mort', binding: 'oprawa miękka' });
    const add = (id, edition, price) => {
      repository.upsertOffer({
        id,
        source: 'Vinted',
        normalizedUrl: `https://example.test/${id}`,
        originalTitle: 'Mort',
        currentPrice: price,
        conditionClass: 'good',
      });
      repository.assignOfferToEdition(id, edition, {
        id: 'm_' + id,
        method: 'manual',
        status: 'active',
      });
    };
    add('a', 'hard', 6000);
    add('b', 'hard', 6400);
    add('c', 'soft', 2000);
    add('d', 'soft', 2200);
    const value = marketValuations(repository.database, 'work', ['w']).get('w');
    assert.deepEqual(value.editionRange, { low: 1800, high: 5500, editions: 2 });
    assert.equal(
      marketValuations(repository.database, 'edition', ['hard']).get('hard').editionRange,
      undefined,
    );
  } finally {
    repository.close();
  }
});
