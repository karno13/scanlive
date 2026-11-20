import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { createLocalAppServer } from '../local-app.mjs';
import { apiRoute } from '../api-routes.mjs';
import { editionDemand, listDeals, removeDealVerdict, saveDealVerdict } from '../deals.mjs';

function catalogue() {
  const repository = new SqliteCatalogRepository(':memory:');
  repository.createWork({ id: 'w', title: 'Mort', authors: ['Pratchett, Terry'] });
  repository.createEdition({ id: 'e', workId: 'w', title: 'Mort', publisher: 'Prószyński' });
  const add = (id, price, extra = {}) => {
    repository.upsertOffer({
      id,
      source: 'Vinted',
      normalizedUrl: `https://example.test/${id}`,
      originalTitle: 'Mort ' + id,
      currentPrice: price,
      conditionClass: 'good',
      availability: 'available',
      ...extra,
    });
    repository.assignOfferToEdition(id, 'e', {
      id: 'm_' + id,
      method: 'manual',
      status: 'active',
    });
  };
  return { repository, add };
}

test('an offer clearly below the value of its edition is a deal; the rest is not', () => {
  const { repository, add } = catalogue();
  try {
    add('s1', 4000, { availability: 'sold' });
    add('s2', 4200, { availability: 'sold' });
    add('a', 4400);
    add('b', 4500);
    add('cheap', 2000);
    add('gone', 1000, { availability: 'unavailable' });
    add('worn', 3000, { conditionClass: 'satisfactory' });
    const { items } = listDeals(repository);
    assert.deepEqual(
      items.map((item) => item.offerId),
      ['cheap'],
      'market-priced, removed and worn-but-fairly-priced offers are not deals',
    );
    const [deal] = items;
    // Worth comes from the other offers: the cheap one does not lower its own reference.
    assert.equal(deal.worth, 4000);
    assert.equal(deal.saving, 2000);
    assert.equal(deal.discount, 50);
    assert.equal(deal.suspicious, false);
    assert.equal(deal.workId, 'w');
    assert.ok(deal.reasons.length);
  } finally {
    repository.close();
  }
});

test('a deal carries its own favourites and the demand of the other Vinted listings of its edition', () => {
  const { repository, add } = catalogue();
  try {
    add('s1', 4000, { availability: 'sold', favouriteCount: 9 });
    add('a', 4400, { favouriteCount: 12 });
    add('b', 4500, { favouriteCount: 3 });
    add('cheap', 2000, { favouriteCount: 40 });
    const [deal] = listDeals(repository).items;
    assert.equal(deal.offerId, 'cheap');
    assert.equal(deal.favourites, 40);
    // Its own 40 favourites are left out of the edition's demand: median of 3, 9, 12.
    assert.deepEqual(deal.demand, { median: 9, offers: 3, level: 'high' });
  } finally {
    repository.close();
  }
});

test('edition demand needs two listings and is graded by the median', () => {
  assert.equal(editionDemand([5]), null);
  assert.deepEqual(editionDemand([1, 2]), { median: 1, offers: 2, level: 'low' });
  assert.deepEqual(editionDemand([4, 5, 0]), { median: 4, offers: 3, level: 'medium' });
});

test('no deal without two other prices, and a far too cheap offer is flagged', () => {
  const { repository, add } = catalogue();
  try {
    add('a', 4000);
    add('cheap', 1000);
    assert.deepEqual(listDeals(repository).items, []);
    add('b', 4200);
    add('c', 4400);
    const [deal] = listDeals(repository).items;
    assert.equal(deal.offerId, 'cheap');
    assert.equal(deal.suspicious, true);
  } finally {
    repository.close();
  }
});

test('GET /api/deals returns the list', async () => {
  const { repository, add } = catalogue();
  add('a', 4000);
  add('b', 4200);
  add('c', 4400);
  add('cheap', 2500);
  const server = createLocalAppServer({ catalogProvider: () => ({ repository }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(null)));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/deals`);
    assert.equal(response.status, 200);
    const { items } = await response.json();
    assert.deepEqual(
      items.map((item) => item.offerId),
      ['cheap'],
    );
  } finally {
    await new Promise((resolve) => server.close(() => resolve(null)));
    repository.close();
  }
});

test('a verdict is stored with the deal as listed, replaces the previous one and can be taken back', () => {
  const { repository, add } = catalogue();
  try {
    add('a', 4000);
    add('b', 4200);
    add('c', 4400);
    add('cheap', 2000);
    add('fair', 4300);
    const at = Date.parse('2026-11-17T12:00:00Z');
    const saved = saveDealVerdict(repository, 'cheap', 'wrong_match', { at });
    assert.equal(saved.verdict, 'wrong_match');
    const row = repository.database
      .prepare('SELECT verdict, price, worth, confidence FROM deal_verdicts WHERE offer_id=?')
      .get('cheap');
    assert.deepEqual(
      { ...row },
      {
        verdict: 'wrong_match',
        price: 2000,
        worth: listDeals(repository).items[0].worth,
        confidence: listDeals(repository).items[0].confidence,
      },
    );
    saveDealVerdict(repository, 'cheap', 'good', { at });
    // An offer that is not on the list can still be rated; its snapshot is empty.
    saveDealVerdict(repository, 'fair', 'overvalued', { at });
    const { items, verdicts } = listDeals(repository);
    assert.equal(items.find((item) => item.offerId === 'cheap').verdict, 'good');
    assert.equal(verdicts.total, 2);
    assert.deepEqual(verdicts.counts, { good: 1, wrong_match: 0, condition: 0, overvalued: 1 });
    assert.equal(verdicts.byConfidence.none.total, 1, 'the off-list verdict has no confidence');
    assert.equal(removeDealVerdict(repository, 'cheap').verdicts.total, 1);
    assert.equal(listDeals(repository).items[0].verdict, null);
    assert.throws(() => saveDealVerdict(repository, 'cheap', 'maybe'), /INVALID_DEAL_VERDICT/);
    assert.throws(() => saveDealVerdict(repository, 'nope', 'good'), /OFFER_NOT_FOUND/);
  } finally {
    repository.close();
  }
});

test('PUT and DELETE /api/deals/:offerId/verdict', async () => {
  const { repository, add } = catalogue();
  try {
    add('a', 4000);
    add('b', 4200);
    add('c', 4400);
    add('cheap', 2500);
    const path = '/api/deals/cheap/verdict';
    const saved = await apiRoute({
      repo: repository,
      method: 'PUT',
      path,
      input: { verdict: 'good' },
    });
    assert.equal(saved.verdicts.counts.good, 1);
    await assert.rejects(
      apiRoute({ repo: repository, method: 'PUT', path, input: { verdict: 'x' } }),
      (error) => error.statusCode === 400,
    );
    const removed = await apiRoute({ repo: repository, method: 'DELETE', path });
    assert.equal(removed.verdicts.total, 0);
  } finally {
    repository.close();
  }
});
