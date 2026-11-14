import assert from 'node:assert/strict';
import test from 'node:test';
import { repairedTitle, titleFromListing, repairCatalogTitles } from '../title-repair.mjs';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';

test('Polish letters come from a listing with the same words; punctuation stays', () => {
  assert.equal(
    titleFromListing(
      'Zabojca Ghuli. Przygody Gotreka',
      'Zabójca Ghuli - Przygody Gotreka i Felixa',
    ),
    'Zabójca Ghuli. Przygody Gotreka',
  );
  assert.equal(
    repairedTitle('PROSPERO W PLOMIENIACH', [
      'Herezja Horusa 15 Prospero w płomieniach Graham McNeill',
    ]),
    'Prospero w płomieniach',
  );
  assert.equal(
    repairedTitle('Pieklo pocztowe', ['Terry Pratchett PIEKŁO POCZTOWE']),
    'Piekło pocztowe',
  );
});

test('nothing is guessed without a matching listing; a shouted title only calms down', () => {
  assert.equal(repairedTitle('Morze piaskow', ['Zupełnie inna książka']), null);
  assert.equal(repairedTitle('TYSIAC SYNOW', []), 'Tysiac synow');
  assert.equal(repairedTitle('Fourth Wing', ['FOURTH WING Rebecca Yarros']), null);
  assert.equal(repairedTitle('Mściwy duch', ['Msciwy duch']), null);
});

test('catalogue titles are rewritten from listings assigned to their edition', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  const db = repository.database;
  const at = '2026-11-08T00:00:00Z';
  db.prepare(
    "INSERT INTO works(id,title,authors_json,created_at,updated_at) VALUES('w1','PROSPERO W PLOMIENIACH','[]',?,?)",
  ).run(at, at);
  db.prepare(
    "INSERT INTO editions(id,work_id,title,created_at,updated_at) VALUES('e1','w1','PROSPERO W PLOMIENIACH',?,?)",
  ).run(at, at);
  const offer = repository.upsertOffer({
    source: 'Vinted',
    normalizedUrl: 'https://www.vinted.pl/items/1',
    originalTitle: 'Prospero w płomieniach - Herezja Horusa',
    currentPrice: 3000,
  });
  db.prepare(
    "INSERT INTO offer_matches(id,offer_id,edition_id,method,status,valid_from,created_at) VALUES('m1',?,'e1','manual','active',?,?)",
  ).run(offer.id, at, at);
  assert.equal(repairCatalogTitles(repository), 2);
  assert.equal(
    db.prepare("SELECT title FROM works WHERE id='w1'").get().title,
    'Prospero w płomieniach',
  );
  assert.equal(
    db.prepare("SELECT title FROM editions WHERE id='e1'").get().title,
    'Prospero w płomieniach',
  );
  assert.equal(repairCatalogTitles(repository), 0);
});
