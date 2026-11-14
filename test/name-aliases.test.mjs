import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { listNames, mergeNames, removeNameAlias, loadNameAliases } from '../name-aliases.mjs';
import { normalizePublisher, setPublisherAliasOverrides } from '../publisher-names.mjs';

test('merging publisher spellings renames editions now and editions saved later', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const work = repository.createWork({ title: 'Mort', authors: ['Terry Pratchett'] });
    const a = repository.createEdition({
      workId: work.id,
      title: 'Mort',
      publisher: 'Prószyński Media',
    });
    repository.createEdition({
      workId: work.id,
      title: 'Mort (2)',
      publisher: 'Prószyński i S-ka',
    });
    const result = mergeNames(repository, {
      kind: 'publisher',
      from: 'Prószyński Media',
      into: 'Prószyński i S-ka',
    });
    assert.deepEqual(result, {
      kind: 'publisher',
      from: 'Prószyński Media',
      into: 'Prószyński i S-ka',
      renamed: 1,
    });
    assert.equal(
      repository.database.prepare('SELECT publisher FROM editions WHERE id=?').get(a.id).publisher,
      'Prószyński i S-ka',
    );
    // A later edition from Open Library spelled "Proszynski Media" gets the joined name too.
    const later = repository.createEdition({
      workId: work.id,
      title: 'Mort (3)',
      publisher: 'Proszynski Media',
    });
    assert.equal(
      repository.database.prepare('SELECT publisher FROM editions WHERE id=?').get(later.id)
        .publisher,
      'Prószyński i S-ka',
    );
    const names = listNames(repository);
    assert.deepEqual(names.publishers, [
      { name: 'Prószyński i S-ka', editions: 3, variants: ['proszynski media'] },
    ]);
    removeNameAlias(repository, { kind: 'publisher', alias: 'Prószyński Media' });
    assert.equal(normalizePublisher('Proszynski Media'), 'Prószyński Media');
    assert.throws(
      () => mergeNames(repository, { kind: 'publisher', from: 'ISA', into: 'Isa' }),
      /SAME_NAME/,
    );
  } finally {
    setPublisherAliasOverrides(new Map());
    repository.close?.();
  }
});

test('merging series spellings moves editions to one series name, without duplicates', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const db = repository.database;
    const work = repository.createWork({ title: 'Mort', authors: ['Terry Pratchett'] });
    const a = repository.createEdition({ workId: work.id, title: 'Mort' });
    const b = repository.createEdition({ workId: work.id, title: 'Mort (2)' });
    const insert = db.prepare(
      "INSERT INTO edition_series(edition_id,name,normalized_name,kind,volume,source) VALUES(?,?,?,'universe',NULL,'bn')",
    );
    insert.run(a.id, 'Discworld series', 'discworld series');
    insert.run(a.id, 'Świat Dysku', 'swiat dysku');
    insert.run(b.id, 'Discworld series', 'discworld series');
    const result = mergeNames(repository, {
      kind: 'series',
      from: 'Discworld series',
      into: 'Świat Dysku',
    });
    assert.equal(result.renamed, 1);
    const rows = db
      .prepare('SELECT edition_id, name FROM edition_series ORDER BY edition_id')
      .all()
      .map((row) => ({ ...row }));
    assert.deepEqual(
      rows,
      [
        { edition_id: a.id, name: 'Świat Dysku' },
        { edition_id: b.id, name: 'Świat Dysku' },
      ].sort((x, y) => x.edition_id.localeCompare(y.edition_id)),
    );
    assert.deepEqual(listNames(repository).series, [
      { name: 'Świat Dysku', kind: 'universe', editions: 2, variants: ['discworld series'] },
    ]);
    assert.equal(loadNameAliases(repository), 0);
  } finally {
    setPublisherAliasOverrides(new Map());
    repository.close?.();
  }
});
