import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { createCatalogBundleDetector, reviewAutomaticBundleMatches } from './bundle-detection.mjs';

function catalogue() {
  const repository = new SqliteCatalogRepository(':memory:');
  const work = (title, authors) => {
    const created = repository.createWork({ title, authors });
    return { work: created, edition: repository.createEdition({ workId: created.id, title }) };
  };
  const books = {
    klinga: work('Bezgłośna klinga', ['R. A. Salvatore']),
    grzbiet: work('Grzbiet świata', ['R. A. Salvatore']),
    fourth: work('Fourth Wing', ['Rebecca Yarros']),
    iron: work('Iron Flame', ['Rebecca Yarros']),
    gdyby: work('Gdyby jednak', ['Rebecca Yarros']),
    studnia: work('Studnia wieczności', ['Richard A. Knaak']),
    wojna: work('Wojna starożytnych', ['Richard A. Knaak']),
    zycie: work('Terry Pratchett : życie z przypisami', ['Rob Wilkins']),
    muzyka: work('Muzyka duszy', ['Terry Pratchett']),
    smoki: work('Smoki', ['Douglas Niles']),
  };
  repository.database
    .prepare("INSERT INTO edition_series(edition_id,name,normalized_name,kind,volume,source) VALUES(?,?,?,'cycle',1,'bn')")
    .run(books.studnia.edition.id, 'Wojna starożytnych : trylogia', 'wojna starozytnych trylogia');
  return { repository, books };
}

test('two catalogue titles in one listing make it a set; references, cycles and author names do not', () => {
  const { repository, books } = catalogue();
  try {
    const detect = createCatalogBundleDetector(repository);
    assert.deepEqual(new Set(detect('R.A. Salvatore, Forgotten Realms Bezgłośna Klinga, Grzbiet Świata, Morze Mieczy')), new Set([books.klinga.work.id, books.grzbiet.work.id]));
    assert.equal(detect('Książki Fourth Wing Iron Flame').length, 2);
    assert.deepEqual(detect('Gdyby jednak | Rebecca Yarros | Romans | Autorka Fourth Wing | Bestseller'), []);
    assert.deepEqual(detect('Warcraft. Wojna Starożytnych: Studnia Wieczności Tom 1 Richard A. Knaak'), []);
    assert.deepEqual(detect('Muzyka duszy - Terry Pratchett'), []);
    assert.deepEqual(detect('Fourth Wing Rebecca Yarros twarda oprawa'), []);
  } finally {
    repository.close?.();
  }
});

test('automatic assignments of listings with two catalogue titles go back to review once', () => {
  const { repository, books } = catalogue();
  try {
    const db = repository.database;
    const at = '2026-11-08T10:00:00.000Z';
    const offer = repository.upsertOffer({ source: 'Vinted', normalizedUrl: 'https://www.vinted.pl/items/1', originalTitle: 'Fourth wing i Iron Flame', currentPrice: 9000, at });
    const single = repository.upsertOffer({ source: 'Vinted', normalizedUrl: 'https://www.vinted.pl/items/2', originalTitle: 'Fourth Wing Rebecca Yarros', currentPrice: 5000, at });
    const match = db.prepare("INSERT INTO offer_matches(id,offer_id,edition_id,method,status,confidence,reason,created_by,valid_from,created_at) VALUES(?,?,?,'structured_isbn','active',1,'isbn','system',?,?)");
    match.run('m1', offer.id, books.fourth.edition.id, at, at);
    match.run('m2', single.id, books.fourth.edition.id, at, at);
    db.prepare("INSERT INTO app_preferences(key,value_json,updated_at) VALUES('bundle_review_v1','{}',?)").run(at);
    assert.equal(reviewAutomaticBundleMatches(repository).requeued, 1);
    assert.equal(db.prepare("SELECT status FROM offer_matches WHERE id='m1'").get().status, 'superseded');
    assert.equal(db.prepare("SELECT status FROM offer_matches WHERE id='m2'").get().status, 'active');
    assert.equal(reviewAutomaticBundleMatches(repository).skipped, true);
  } finally {
    repository.close?.();
  }
});
