import test from 'node:test';
import assert from 'node:assert/strict';
import { localPreselection, collapseSameIsbn } from './review.js';

test('a clear best book is preselected; editions of it do not count as a tie', () => {
  const plan = localPreselection([
    { workId: 'w1', editionId: 'e1', score: 0.91 },
    { workId: 'w1', editionId: 'e2', score: 0.91 },
    { workId: 'w1', editionId: 'e3', score: 0.91 },
  ]);
  assert.equal(plan.preselect, true);
  assert.equal(plan.tie, false);
  assert.match(plan.note, /3 wydania tej samej książki/);
});

test('two different books with the same score are a tie and nothing is chosen', () => {
  const plan = localPreselection([
    { workId: 'w1', editionId: 'e1', score: 0.9 },
    { workId: 'w2', editionId: 'e2', score: 0.89 },
  ]);
  assert.equal(plan.preselect, false);
  assert.equal(plan.tie, true);
});

test('a weak match is shown but not chosen', () => {
  assert.equal(localPreselection([{ workId: 'w1', editionId: 'e1', score: 0.84 }]).preselect, false);
  assert.equal(localPreselection([]).preselect, false);
});

test('offers that follow the first decision on their ISBN are listed once with a count', () => {
  const job = (id, isbn, reason) => ({ id, offer: { observedIsbn: isbn }, result: { reason: [reason] } });
  const rows = collapseSameIsbn([
    job('a', '978-83-616-5604-3', 'isbn_not_found_in_metadata_sources'),
    job('b', '9788361656043', 'isbn_not_found_in_metadata_sources'),
    job('c', '9788361656043', 'isbn_title_mismatch'),
    job('d', '', 'no_isbn_evidence'),
  ]);
  assert.deepEqual(rows.map((row) => row.id), ['a', 'c', 'd']);
  assert.equal(rows[0].sameIsbnCount, 2);
});
