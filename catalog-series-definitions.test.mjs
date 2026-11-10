import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import {
  catalogSeries,
  parseVolumeList,
  saveSeriesDefinition,
  volumeTitleKey,
} from './catalog-series.mjs';

test('a pasted volume list keeps explicit numbers and continues unnumbered lines', () => {
  assert.deepEqual(
    parseVolumeList(
      '1. Czas Horusa\nFałszywi bogowie\n\n15) Prospero w płomieniach\nTom 16 Era mroku',
    ),
    [
      { number: 1, title: 'Czas Horusa' },
      { number: 2, title: 'Fałszywi bogowie' },
      { number: 15, title: 'Prospero w płomieniach' },
      { number: 16, title: 'Era mroku' },
    ],
  );
  assert.equal(
    volumeTitleKey('Czas Horusa : ziarna herezji zostały zasiane'),
    volumeTitleKey('Czas Horusa'),
  );
});

test('works are numbered by the list and missing volumes get their titles', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  const db = repository.database;
  const at = '2026-11-08T00:00:00Z';
  const work = (id, title, volume = null) => {
    db.prepare(
      "INSERT INTO works(id,title,authors_json,created_at,updated_at) VALUES(?,?,'[]',?,?)",
    ).run(id, title, at, at);
    db.prepare(
      'INSERT INTO editions(id,work_id,title,created_at,updated_at) VALUES(?,?,?,?,?)',
    ).run('e-' + id, id, title, at, at);
    if (volume)
      db.prepare(
        "INSERT INTO work_series_annotations(work_id,series,volume,updated_at) VALUES(?,'Herezja Horusa',?,?)",
      ).run(id, volume, at);
  };
  work('w2', 'Fałszywi bogowie', 2);
  work('w1', 'Czas Horusa : ziarna herezji zostały zasiane');
  db.prepare(
    "INSERT INTO edition_series(edition_id,name,normalized_name,kind,volume,source) VALUES('e-w1','Herezja Horusa','herezja horusa','cycle',NULL,'bn')",
  ).run();
  saveSeriesDefinition(repository, {
    name: 'Herezja Horusa',
    text: 'Czas Horusa\nFałszywi bogowie\nGalaktyka w płomieniach',
  });
  const cycle = catalogSeries(repository)
    .flatMap((universe) => universe.cycles)
    .find((item) => item.name === 'Herezja Horusa');
  assert.deepEqual(cycle.volumes, [1, 2]);
  assert.deepEqual(cycle.missing, [3]);
  assert.equal(cycle.missingTitles[3], 'Galaktyka w płomieniach');
  assert.equal(cycle.works.find((item) => item.id === 'w1').fromList, true);
});
