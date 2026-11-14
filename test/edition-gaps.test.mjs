import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import {
  cleanGapPublisher,
  cleanGapYear,
  fillEditionGaps,
  listGapFillBatches,
  pendingGapEditions,
  undoGapFills,
} from '../edition-gaps.mjs';

function setup() {
  const repository = new SqliteCatalogRepository(':memory:');
  repository.createWork({
    id: 'w',
    title: 'Książka',
    authors: ['A B'],
    verificationStatus: 'verified',
  });
  const edition = (id, extra = {}) => {
    repository.createEdition({
      id,
      workId: 'w',
      title: 'Książka ' + id,
      verificationStatus: 'verified',
      ...extra,
    });
    repository.database
      .prepare(
        'INSERT INTO edition_identifiers (edition_id, scheme, normalized_value, source, created_at) VALUES (?,?,?,?,?)',
      )
      .run(id, 'isbn13', '97883616566' + id.padStart(2, '0'), 'test', '2026-11-01T00:00:00.000Z');
  };
  edition('1');
  edition('2', { publisher: 'Ręczne', publicationYear: 2001 });
  edition('3');
  repository.database
    .prepare("UPDATE editions SET verification_status='manual' WHERE id='3'")
    .run();
  return repository;
}
const catalogFor = (repository, records, error = false) => ({
  repository,
  lookupGapRecords: async () => ({ error, records }),
});

test('cleaning drops placeholders and impossible years', () => {
  assert.equal(cleanGapPublisher('n/a'), null);
  assert.equal(cleanGapPublisher('  '), null);
  assert.equal(cleanGapPublisher('Wydawnictwo Zysk i S-ka'), 'Zysk i S-ka');
  assert.equal(cleanGapYear('2019'), 2019);
  assert.equal(cleanGapYear(1200), null);
  assert.equal(cleanGapYear(2099, new Date('2026-11-12')), null);
});

test('fills only empty fields of editions that are not manual, and can be undone', async () => {
  const repository = setup();
  try {
    assert.deepEqual(
      pendingGapEditions(repository).map((row) => row.id),
      ['1'],
    );
    const report = await fillEditionGaps(
      catalogFor(repository, [
        { source: 'e_isbn', publisher: 'Copernicus Corporation', publicationYear: 2020 },
      ]),
    );
    assert.equal(report.filled, 1);
    assert.equal(report.fields, 2);
    const read = (id) =>
      repository.database
        .prepare('SELECT publisher, publication_year AS year FROM editions WHERE id=?')
        .get(id);
    assert.deepEqual({ ...read('1') }, { publisher: 'Copernicus Corporation', year: 2020 });
    assert.deepEqual({ ...read('2') }, { publisher: 'Ręczne', year: 2001 });
    assert.deepEqual({ ...read('3') }, { publisher: null, year: null });
    // The same edition is not asked again right away.
    assert.equal(pendingGapEditions(repository).length, 0);
    const [batch] = listGapFillBatches(repository);
    assert.equal(batch.open, 2);
    // The operator edits the publisher by hand: undo leaves it, restores the year.
    repository.database.prepare("UPDATE editions SET publisher='Moje' WHERE id='1'").run();
    assert.deepEqual({ ...undoGapFills(repository, batch.id) }, { reopened: 1, kept: 1 });
    assert.deepEqual({ ...read('1') }, { publisher: 'Moje', year: null });
    assert.throws(() => undoGapFills(repository, batch.id), /DECISION_NOT_FOUND/);
  } finally {
    repository.close();
  }
});

test('a failed lookup is retried the next day, an empty one after a month', async () => {
  const repository = setup();
  try {
    const t0 = new Date('2026-11-12T10:00:00Z');
    const report = await fillEditionGaps(catalogFor(repository, [], true), { now: () => t0 });
    assert.equal(report.errors, 1);
    assert.equal(
      pendingGapEditions(repository, { now: () => new Date(t0.getTime() + 3_600_000) }).length,
      0,
    );
    assert.equal(
      pendingGapEditions(repository, { now: () => new Date(t0.getTime() + 25 * 3_600_000) }).length,
      1,
    );
    await fillEditionGaps(catalogFor(repository, []), {
      now: () => new Date(t0.getTime() + 25 * 3_600_000),
    });
    assert.equal(
      pendingGapEditions(repository, { now: () => new Date(t0.getTime() + 10 * 86_400_000) })
        .length,
      0,
    );
    assert.equal(
      pendingGapEditions(repository, { now: () => new Date(t0.getTime() + 40 * 86_400_000) })
        .length,
      1,
    );
  } finally {
    repository.close();
  }
});
