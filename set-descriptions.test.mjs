import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { markOfferAsSet, updateSetEdition } from './offer-sets.mjs';
import { fillSetsFromDescriptions } from './set-descriptions.mjs';

function setup() {
  const repository = new SqliteCatalogRepository(':memory:');
  const book = (title) => {
    const work = repository.createWork({ title, authors: ['Terry Pratchett'] });
    return repository.createEdition({ workId: work.id, title, publisher: 'Prószyński i S-ka' });
  };
  const editions = { blask: book('Blask fantastyczny'), wiedzmy: book('Trzy wiedźmy'), straz: book('Straż! Straż!'), mort: book('Mort') };
  const offer = (n) =>
    repository.upsertOffer({ source: 'Vinted', normalizedUrl: `https://www.vinted.pl/items/${n}-zestaw`, originalTitle: 'Zestaw Świat Dysku', currentPrice: 9000, at: '2026-11-08T10:00:00Z' });
  return { repository, editions, offer };
}
const description = 'Na sprzedaż zestaw 3 powieści Terry’ego Pratchetta (Prószyński i S-ka):\nBlask fantastyczny\nTrzy wiedźmy\nStraż! Straż!\nStan: bardzo dobry';

test('an empty set is filled once from its listing description, to be confirmed by the operator', async () => {
  const { repository, editions, offer } = setup();
  try {
    const set = offer(1);
    markOfferAsSet(repository, set.id);
    const reads = [];
    const report = await fillSetsFromDescriptions(repository, { read: async (url) => (reads.push(url), { description }) });
    assert.deepEqual(reads, ['https://www.vinted.pl/items/1-zestaw']);
    assert.equal(report.added, 3);
    const db = repository.database;
    const members = db.prepare('SELECT edition_id FROM offer_set_editions WHERE offer_id=? ORDER BY edition_id').all(set.id).map((row) => row.edition_id);
    assert.deepEqual(members, [editions.blask.id, editions.wiedzmy.id, editions.straz.id].sort());
    assert.equal(db.prepare('SELECT composition_confirmed FROM offer_sets WHERE offer_id=?').get(set.id).composition_confirmed, 0);
    // The operator removes a book: the next pass neither reads the page again nor puts it back.
    updateSetEdition(repository, set.id, editions.straz.id, false);
    const again = await fillSetsFromDescriptions(repository, { read: async () => assert.fail('read twice') });
    assert.equal(again.checked, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM offer_set_editions WHERE offer_id=?').get(set.id).n, 2);
  } finally {
    repository.close?.();
  }
});

test('a set the operator already filled keeps its books; a throttled source stops the batch', async () => {
  const { repository, editions, offer } = setup();
  try {
    const filled = offer(1);
    markOfferAsSet(repository, filled.id);
    updateSetEdition(repository, filled.id, editions.mort.id, true);
    const throttled = offer(2);
    markOfferAsSet(repository, throttled.id);
    const report = await fillSetsFromDescriptions(repository, {
      read: async (url) => {
        if (url.includes('/2-')) throw Object.assign(Error('SOURCE_HTTP_429'), { status: 429 });
        return { description };
      },
    });
    assert.equal(report.paused, true);
    const db = repository.database;
    assert.deepEqual(db.prepare('SELECT edition_id FROM offer_set_editions WHERE offer_id=?').all(filled.id).map((row) => row.edition_id), [editions.mort.id]);
    assert.equal(db.prepare('SELECT status FROM offer_descriptions WHERE offer_id=?').get(throttled.id).status, 'error');
  } finally {
    repository.close?.();
  }
});
