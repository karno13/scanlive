// The Sets endpoints over HTTP: adding and removing a book, suggestions, unmarking.
// (Until 2026-11-08 the route counted path parts with the "/api/sets" prefix and matched nothing.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { createLocalAppServer } from './local-app.mjs';
import { markOfferAsSet } from './offer-sets.mjs';

test('a set gets books, loses one, suggests from its title and can be unmarked', async (t) => {
  const repo = new SqliteCatalogRepository(process.env.BOOKFLIP_CATALOG_DB);
  const offer = repo.upsertOffer({ id: 'Vinted:42', source: 'Vinted', normalizedUrl: 'https://www.vinted.pl/items/42', originalTitle: 'Terry Pratchett Mort i Kolor magii zestaw', currentPrice: 4000 });
  repo.putIdentificationJob({ offerId: offer.id, status: 'review_required' });
  for (const [work, title] of [['w-mort', 'Mort'], ['w-kolor', 'Kolor magii']]) {
    repo.createWork({ id: work, title, authors: ['Pratchett, Terry'] });
    repo.createEdition({ id: 'e-' + work, workId: work, title });
  }
  markOfferAsSet(repo, offer.id);
  repo.close();

  const server = createLocalAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: base },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const id = encodeURIComponent('Vinted:42');

  const suggestions = await call('GET', `/api/sets/${id}/candidates`);
  assert.equal(suggestions.status, 200);
  assert.deepEqual(suggestions.data.items.map((item) => item.editionId).sort(), ['e-w-kolor', 'e-w-mort']);

  assert.equal((await call('POST', `/api/sets/${id}/editions`, { editionId: 'e-w-mort' })).status, 200);
  assert.equal((await call('POST', `/api/sets/${id}/editions`, { editionId: 'e-w-kolor' })).status, 200);
  let sets = (await call('GET', '/api/sets')).data.items;
  assert.deepEqual(sets[0].editions.map((item) => item.editionId).sort(), ['e-w-kolor', 'e-w-mort']);

  assert.equal((await call('DELETE', `/api/sets/${id}/editions/e-w-kolor`, {})).status, 200);
  sets = (await call('GET', '/api/sets')).data.items;
  assert.deepEqual(sets[0].editions.map((item) => item.editionId), ['e-w-mort']);

  assert.equal((await call('DELETE', `/api/sets/${id}`, {})).status, 200);
  assert.equal((await call('GET', '/api/sets')).data.items.length, 0);
});
