import test from 'node:test';
import assert from 'node:assert/strict';

import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { listIdentificationJobs, reviewSkippedIds, updateReviewSkipped } from './catalog-api.mjs';

// Review queue paged on the server (view=list): one row per decision, phrase group sizes over the
// whole filtered queue, skipped offers kept in the database.
function queue() {
  const repository = new SqliteCatalogRepository(':memory:');
  const add = (
    id,
    { isbn = null, reason = 'no_isbn_evidence', phrase = 'Pratchett', price = 1000 } = {},
  ) => {
    repository.upsertOffer({
      id,
      source: 'fixture',
      normalizedUrl: `https://example.test/${id}`,
      originalTitle: `Oferta ${id}`,
      observedIsbn: isbn,
      currentPrice: price,
      matchedQueries: [phrase],
    });
    repository.putIdentificationJob({ id: `j_${id}`, offerId: id, status: 'review_required' });
    repository.database
      .prepare('UPDATE identification_jobs SET result_json=? WHERE id=?')
      .run(JSON.stringify({ reason: [reason] }), `j_${id}`);
  };
  // Three offers with one unknown ISBN follow one decision; a title mismatch on that ISBN does not.
  add('a', { isbn: '9788361656043', reason: 'isbn_not_found_in_metadata_sources' });
  add('b', { isbn: '978-83-616-5604-3', reason: 'isbn_not_found_in_metadata_sources' });
  add('c', { isbn: '9788361656043', reason: 'isbn_not_found_in_metadata_sources' });
  add('d', { isbn: '9788361656043', reason: 'isbn_title_mismatch' });
  for (const id of ['e', 'f', 'g']) add(id, { phrase: 'Dragonlance' });
  return repository;
}

const list = (repository, options = {}) =>
  listIdentificationJobs(repository, {
    status: 'review_required',
    view: 'list',
    sort: 'group',
    ...options,
  });

test('global decisions exclude reference jobs and survive filters and temporary skips', () => {
  const repository = queue();
  try {
    const offer = repository.upsertOffer({
      source: 'Empik',
      normalizedUrl: 'https://example.test/reference',
      originalTitle: 'Referencja',
    });
    repository.putIdentificationJob({ offerId: offer.id, status: 'review_required' });
    updateReviewSkipped(repository, { add: ['j_e'] });
    const filtered = list(repository, { query: 'Oferta a' });
    assert.equal(filtered.queueTotal, 7);
    assert.equal(filtered.queueDecisions, 5);
    assert.equal(filtered.offersTotal, 1);
    assert.equal(list(repository).total, 4, 'skipping only changes the visible queue');
  } finally {
    repository.close();
  }
});

test('one row per decision: offers sharing an ISBN decision are merged, with a count', () => {
  const repository = queue();
  try {
    const page = list(repository, { limit: 50 });
    assert.equal(page.total, 5, 'decisions');
    assert.equal(page.offersTotal, 7, 'offers they cover');
    assert.equal(page.queueTotal, 7);
    assert.equal(page.queueDecisions, 5, 'global count uses decisions, not offers');
    const merged = page.items.find((item) => item.sameIsbnCount === 3);
    assert.ok(merged, 'a, b and c are one row');
    assert.equal(page.items.filter((item) => item.offerId === 'd').length, 1);
    assert.deepEqual(
      Object.fromEntries(page.groupSizes),
      { Dragonlance: 3, Pratchett: 2 },
      'group sizes count decisions',
    );
  } finally {
    repository.close();
  }
});

test('pages count decisions and the group sizes cover pages not loaded yet', () => {
  const repository = queue();
  try {
    const first = list(repository, { limit: 2, offset: 0 });
    const second = list(repository, { limit: 2, offset: 2 });
    const third = list(repository, { limit: 2, offset: 4 });
    const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    assert.equal(new Set(ids).size, 5, 'no row twice, none missing');
    assert.equal(first.items.length, 2);
    assert.equal(third.items.length, 1);
    assert.equal(Object.fromEntries(first.groupSizes).Pratchett, 2);
    // Group order: the phrase, then the title.
    assert.deepEqual(
      ids.map(
        (id) =>
          list(repository, { limit: 50 }).items.find((item) => item.id === id).offer
            .matchedQueries[0],
      ),
      ['Dragonlance', 'Dragonlance', 'Dragonlance', 'Pratchett', 'Pratchett'],
    );
  } finally {
    repository.close();
  }
});

test('skipped offers are kept in the database, left out of the list and restored at once', () => {
  const repository = queue();
  try {
    assert.deepEqual(updateReviewSkipped(repository, { add: ['j_e', 'j_f', 'unknown'] }), {
      skippedCount: 2,
    });
    assert.deepEqual(reviewSkippedIds(repository), ['j_e', 'j_f']);
    const page = list(repository, { limit: 50 });
    assert.equal(page.total, 3);
    assert.equal(page.skippedCount, 2);
    assert.equal(page.buckets.noisbn, 1, 'tab counts leave skipped offers out too');
    assert.ok(!page.items.some((item) => ['j_e', 'j_f'].includes(item.id)));
    // Without view=list (bulk tools, older callers) nothing changes.
    assert.equal(listIdentificationJobs(repository, { status: 'review_required' }).total, 7);
    updateReviewSkipped(repository, { clear: true });
    assert.equal(list(repository, { limit: 50 }).total, 5);
  } finally {
    repository.close();
  }
});
