import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import {
  demandBucket,
  editionLiquidity,
  liquidityModel,
  marketIndex,
  sniperPhrase,
  sniperTargets,
} from '../market-index.mjs';
import { listDeals } from '../deals.mjs';
import { listDealAlerts, markDealAlertsSeen, recordDealAlerts } from '../deal-alerts.mjs';

const DAY = 86_400_000;
const AT = Date.parse('2026-11-20T12:00:00Z');
const daysAgo = (days) => new Date(AT - days * DAY).toISOString();

/** Two editions: "Mort" sells (3 of 4 listings sold within days), "Eryk" sits (4 listings, none sold). */
function market() {
  const repository = new SqliteCatalogRepository(':memory:');
  for (const [id, title] of [
    ['mort', 'Mort'],
    ['eryk', 'Eryk'],
  ]) {
    repository.createWork({ id: 'w_' + id, title, authors: ['Pratchett, Terry'] });
    repository.createEdition({ id: 'e_' + id, workId: 'w_' + id, title, publisher: 'Prószyński' });
  }
  let n = 0;
  const add = (
    edition,
    price,
    { sold = null, days = 20, favourites = 3, source = 'Vinted' } = {},
  ) => {
    const id = `${edition}_${n++}`;
    repository.upsertOffer({
      id,
      source,
      normalizedUrl: `https://example.test/${id}`,
      originalTitle: `${edition} ${id}`,
      currentPrice: price,
      conditionClass: 'good',
      availability: sold == null ? 'available' : 'sold',
      firstSeenAt: daysAgo(days),
      favouriteCount: favourites,
    });
    if (sold != null)
      repository.database
        .prepare('UPDATE offers SET availability_changed_at=? WHERE id=?')
        .run(daysAgo(days - sold), id);
    repository.assignOfferToEdition(id, 'e_' + edition, {
      id: 'm_' + id,
      method: 'manual',
      status: 'active',
    });
    return id;
  };
  add('mort', 4000, { sold: 2 });
  add('mort', 4200, { sold: 3 });
  add('mort', 4400, { sold: 5 });
  add('mort', 4500);
  for (let i = 0; i < 4; i++) add('eryk', 3000 + i * 100);
  return { repository, add };
}

test('demand buckets come from the median favourites of two or more listings', () => {
  assert.equal(demandBucket([9]), 'none');
  assert.equal(demandBucket([1, 2, 3]), 'low');
  assert.equal(demandBucket([4, 5]), 'medium');
  assert.equal(demandBucket([10, 8, 2]), 'high');
});

test('an edition that sells has a higher 30-day chance than one whose listings sit', () => {
  const { repository } = market();
  try {
    const model = liquidityModel(repository.database, AT);
    assert.equal(model.global.sales, 3);
    const mort = editionLiquidity(model, 'e_mort');
    const eryk = editionLiquidity(model, 'e_eryk');
    assert.ok(mort.chance > eryk.chance, `${mort.chance} > ${eryk.chance}`);
    assert.equal(mort.sales, 3);
    assert.equal(mort.live, 1);
    assert.equal(mort.basis, 'own');
    assert.equal(eryk.sales, 0);
    assert.ok(mort.medianDays < eryk.medianDays);
    // An edition never listed on Vinted gets the market's figures.
    const unknown = editionLiquidity(model, 'nothing');
    assert.equal(unknown.basis, 'market');
    assert.ok(unknown.chance > 0 && unknown.chance < 1);
  } finally {
    repository.close();
  }
});

test('the index lists editions with value, liquidity and turnover, in the chosen order', () => {
  const { repository } = market();
  try {
    const { items, total, market: overall } = marketIndex(repository, { at: AT });
    assert.equal(total, 2);
    assert.equal(overall.sales, 3);
    assert.deepEqual(
      items.map((item) => item.editionId),
      ['e_mort', 'e_eryk'],
    );
    const [mort] = items;
    assert.ok(mort.value > 0);
    assert.equal(mort.turnover, Math.round((mort.value * mort.liquidity.chance) / 100) * 100);
    assert.deepEqual(
      marketIndex(repository, { at: AT, query: 'eryk' }).items.map((item) => item.editionId),
      ['e_eryk'],
    );
    assert.equal(marketIndex(repository, { at: AT, limit: 1 }).items.length, 1);
  } finally {
    repository.close();
  }
});

test('sniper phrases are what a seller writes; a one-word title carries the surname', () => {
  assert.equal(sniperPhrase('Mort', ['Pratchett, Terry (1948-2015)']), 'Mort Pratchett');
  assert.equal(sniperPhrase('Straż nocna', ['Pratchett, Terry']), 'Straż nocna');
  assert.equal(
    sniperPhrase('Wywyższenie Horusa cykl Herezja Horusa', ['Dan Abnett']),
    'Wywyższenie Horusa',
  );
  assert.equal(
    sniperPhrase('Wojna grzechu. Kompletna trylogia', ['Richard Knaak']),
    'Wojna grzechu',
  );
  assert.equal(
    sniperPhrase('Ucieczka "Eisensteina" : herezja trwa', ['James Swallow']),
    'Ucieczka Eisensteina',
  );
  assert.equal(sniperPhrase('Perturabo: Młot Olympii', ['Guy Haley']), 'Perturabo Haley');
});

test('sniper targets need a medium valuation and enough value', () => {
  const { repository } = market();
  try {
    const targets = sniperTargets(repository, { at: AT, minValue: 2500 });
    assert.ok(targets.every((target) => target.value >= 2500));
    assert.ok(targets.some((target) => target.phrase === 'Mort Pratchett'));
    assert.deepEqual(sniperTargets(repository, { at: AT, minValue: 1_000_000 }), []);
  } finally {
    repository.close();
  }
});

test('deals rank by expected gain and carry the edition liquidity', () => {
  const { repository, add } = market();
  try {
    add('mort', 1500, { days: 1 });
    const [deal] = listDeals(repository, { at: AT }).items;
    assert.ok(deal.liquidity.chance > 0);
    assert.equal(deal.expected, Math.round((deal.saving * deal.liquidity.chance) / 100) * 100);
  } finally {
    repository.close();
  }
});

test('a new deal is announced once, an old listing is not news, and alerts can be marked seen', () => {
  const { repository, add } = market();
  try {
    const fresh = add('mort', 1500, { days: 1 });
    const old = add('mort', 1600, { days: 5 });
    const first = recordDealAlerts(repository, { at: AT });
    assert.deepEqual(
      first.map((item) => item.offerId),
      [fresh],
      'only offers first seen in the last 48 hours',
    );
    assert.ok(!first.some((item) => item.offerId === old));
    assert.deepEqual(recordDealAlerts(repository, { at: AT }), [], 'announced once');
    const listed = listDealAlerts(repository);
    assert.equal(listed.unseen, 1);
    assert.equal(listed.items[0].offerId, fresh);
    assert.equal(listed.items[0].gone, false);
    assert.equal(markDealAlertsSeen(repository, { at: AT }).unseen, 0);
  } finally {
    repository.close();
  }
});
