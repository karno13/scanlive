import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { phraseCovers, queryYieldReport, titleCore } from '../query-yield.mjs';

const now = '2026-11-16T10:00:00.000Z';
function seed() {
  const repo = new SqliteCatalogRepository(':memory:');
  const db = repo.database;
  db.prepare(
    "INSERT INTO works(id,title,created_at,updated_at) VALUES ('w1','Ostatnie życzenie',?,?)",
  ).run(now, now);
  db.prepare(
    "INSERT INTO editions(id,work_id,title,subtitle,created_at,updated_at) VALUES ('e1','w1','Ostatnie życzenie: Saga o wiedźminie','Saga',?,?)",
  ).run(now, now);
  db.prepare(
    "INSERT INTO persons(id,name,normalized_name,created_at) VALUES ('p1','Andrzej Sapkowski','andrzej sapkowski',?)",
  ).run(now);
  db.prepare(
    "INSERT INTO edition_contributors(edition_id,person_id,role,source) VALUES ('e1','p1','author','test')",
  ).run();
  db.prepare(
    "INSERT INTO edition_series(edition_id,name,normalized_name,kind,volume,source) VALUES ('e1','Wiedźmin','wiedzmin','cycle',1,'test')",
  ).run();
  const offer = (id, title, queries, edition) => {
    db.prepare(
      'INSERT INTO offers(id,source,normalized_url,original_title,matched_queries_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    ).run(
      id,
      'Vinted',
      'https://www.vinted.pl/items/' + id,
      title,
      JSON.stringify(queries),
      now,
      now,
    );
    if (edition)
      db.prepare(
        "INSERT INTO offer_matches(id,offer_id,edition_id,method,status,valid_from,created_at) VALUES (?,?,?,'manual','active',?,?)",
      ).run('m' + id, id, edition, now, now);
  };
  offer('1', 'Wiedźmin Ostatnie życzenie Sapkowski', ['Wiedźmin', 'Sapkowski'], 'e1');
  offer('2', 'Sapkowski Ostatnie życzenie tom 1', ['Sapkowski'], 'e1');
  offer('3', 'Wiedźmin plakat', ['Wiedźmin'], null);
  return db;
}

test('helpers cut the subtitle and match whole words', () => {
  assert.equal(titleCore('Ostatnie życzenie: Saga o wiedźminie'), 'Ostatnie życzenie');
  assert.equal(phraseCovers('ostatnie zyczenie', 'Sapkowski – Ostatnie Życzenie!'), true);
  assert.equal(phraseCovers('wiedz', 'Wiedźmin'), false);
});

test('report counts unique and identified offers per phrase and proposes phrases from editions', () => {
  const report = queryYieldReport(seed(), { minOffers: 1 });
  assert.deepEqual(report.totals, { queries: 2, offers: 3, identified: 2, foundByMoreThanOne: 1 });
  const sap = report.perQuery.find((q) => q.query === 'Sapkowski');
  assert.deepEqual(
    {
      offers: sap.offers,
      unique: sap.unique,
      identified: sap.identified,
      uniqueIdentified: sap.uniqueIdentified,
    },
    { offers: 2, unique: 1, identified: 2, uniqueIdentified: 1 },
  );
  assert.deepEqual(report.drop, []);
  assert.deepEqual(queryYieldReport(seed(), { minOffers: 0.25 }).noisy, []);
  const byPhrase = Object.fromEntries(report.suggestions.map((s) => [s.phrase, s]));
  assert.equal(byPhrase['Ostatnie życzenie'].kind, 'bez podtytułu');
  assert.equal(byPhrase['Ostatnie życzenie'].covers, 2);
  assert.equal(byPhrase['Sapkowski Ostatnie życzenie'].kind, 'autor + tytuł');
  assert.equal(byPhrase['Wiedźmin'], undefined, 'an existing phrase is not proposed again');
});

test('a profile restricts the report and a phrase with only duplicates is flagged', () => {
  const report = queryYieldReport(seed(), { queries: ['Wiedźmin', 'Sapkowski'], minOffers: 1 });
  assert.equal(report.totals.queries, 2);
  const db = seed();
  db.prepare(
    'UPDATE offers SET matched_queries_json=\'["Wiedźmin","Sapkowski"]\' WHERE id=\'3\'',
  ).run();
  db.prepare(
    'UPDATE offers SET matched_queries_json=\'["Sapkowski","Wiedźmin"]\' WHERE id=\'2\'',
  ).run();
  assert.deepEqual(queryYieldReport(db, { minOffers: 1 }).drop.sort(), ['Sapkowski', 'Wiedźmin']);
});
