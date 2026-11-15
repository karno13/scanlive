import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { createLocalAppServer } from '../local-app.mjs';
import { listDeals } from '../deals.mjs';

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
