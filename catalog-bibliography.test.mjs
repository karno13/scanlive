import assert from 'node:assert/strict';
import test from 'node:test';

import { KINSLAYER } from './fixtures/metadata/bn-kinslayer.mjs';
import { reviewAutomaticBundleMatches } from './bundle-detection.mjs';
import {
  catalogPersons,
  editionContributors,
  editionSeries,
  enrichEdition,
  personWorks,
  upgradeCatalogBibliography,
} from './catalog-bibliography.mjs';
import { catalogSeries } from './catalog-series.mjs';
import { CatalogResolver } from './catalog-resolver.mjs';
import { payloadHash } from './metadata-record.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { findDuplicateWorkGroups, findWorkByKey } from './work-grouping.mjs';

// An edition created before migration 112: glued BN title and authors, payload kept.
function legacyEdition(repository, { id = 'e1', workId = 'w1', status = 'verified', payload = KINSLAYER } = {}) {
  repository.createWork({
    id: workId,
    title: payload.title,
    authors: [payload.author],
    verificationStatus: status,
  });
  repository.createEdition({
    id,
    workId,
    title: payload.title,
    publisher: payload.publisher,
    publicationYear: 2021,
    verificationStatus: status,
  });
  repository.putExternalRecord({
    id: `ext-${id}`,
    provider: 'bn',
    externalId: String(payload.id),
    recordType: 'edition',
    editionId: id,
    status: 'found',
    payload,
    payloadHash: payloadHash(payload),
    fetchedAt: '2026-01-01T00:00:00.000Z',
  });
}

test('existing editions are upgraded from the stored MARC record without the network', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    legacyEdition(repository);
    const result = upgradeCatalogBibliography(repository);
    assert.deepEqual(result, { skipped: false, editions: 1, updated: 1, works: 1 });
    const edition = repository.database.prepare('SELECT * FROM editions WHERE id=?').get('e1');
    assert.equal(edition.title, 'Zabójca krasnoludów');
    assert.equal(edition.publisher, 'Copernicus Corporation');
    assert.equal(edition.binding, 'oprawa miękka');
    assert.equal(edition.original_title, 'Kinslayer');
    assert.equal(edition.page_count, 399);
    const work = repository.database.prepare('SELECT * FROM works WHERE id=?').get('w1');
    assert.equal(work.title, 'Zabójca krasnoludów');
    assert.deepEqual(JSON.parse(work.authors_json), ['David Guymer']);
    assert.deepEqual(
      editionContributors(repository, 'e1').map((person) => [person.name, person.role]),
      [
        ['David Guymer', 'author'],
        ['Jacek Czuba', 'translator'],
      ],
    );
    assert.ok(editionSeries(repository, 'e1').some((entry) => entry.name === 'Herezja Horusa' && entry.volume === 30));
    assert.equal(upgradeCatalogBibliography(repository).skipped, true, 'runs once');
  } finally {
    repository.close();
  }
});

test('operator edits survive the upgrade; only fields they cannot edit are added', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    legacyEdition(repository, { status: 'manual' });
    repository.database.prepare("UPDATE editions SET title='Mój tytuł' WHERE id='e1'").run();
    upgradeCatalogBibliography(repository);
    const edition = repository.database.prepare('SELECT * FROM editions WHERE id=?').get('e1');
    assert.equal(edition.title, 'Mój tytuł');
    assert.equal(edition.original_title, 'Kinslayer');
    const work = repository.database.prepare('SELECT title FROM works WHERE id=?').get('w1');
    assert.equal(work.title, KINSLAYER.title);
  } finally {
    repository.close();
  }
});

test('people list counts editions per role and lists a person’s books', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    legacyEdition(repository);
    enrichEdition(repository, 'e1');
    const persons = catalogPersons(repository);
    const translator = persons.find((person) => person.name === 'Jacek Czuba');
    assert.equal(translator.asTranslator, 1);
    assert.equal(catalogPersons(repository, { query: 'guymer' }).length, 1);
    const books = personWorks(repository, translator.id);
    assert.equal(books.editions[0].title, 'Zabójca krasnoludów');
    assert.deepEqual(books.editions[0].roles, ['translator']);
  } finally {
    repository.close();
  }
});

test('series view takes the cycle and volume from the record', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    legacyEdition(repository);
    upgradeCatalogBibliography(repository);
    const universe = catalogSeries(repository).find((item) => item.name === 'Warhammer');
    assert.ok(universe, 'universe from the series statement');
    const work = universe.cycles.flatMap((cycle) => cycle.works).find((item) => item.id === 'w1');
    assert.equal(work.cycle, 'Przygody Gotreka i Felixa');
    assert.equal(work.volume, 13);
  } finally {
    repository.close();
  }
});

test('the original title joins translations published under different Polish titles', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    legacyEdition(repository);
    upgradeCatalogBibliography(repository);
    assert.equal(findWorkByKey(repository, 'Pogromca krewniaków', ['David Guymer'], 'Kinslayer')?.id, 'w1');
    assert.equal(findWorkByKey(repository, 'Pogromca krewniaków', ['Inny Autor'], 'Kinslayer'), null);
    repository.createWork({ id: 'w2', title: 'Pogromca krewniaków', authors: ['David Guymer'], verificationStatus: 'verified' });
    repository.createEdition({ id: 'e2', workId: 'w2', title: 'Pogromca krewniaków', verificationStatus: 'verified' });
    repository.database.prepare("UPDATE editions SET original_title='Kinslayer' WHERE id='e2'").run();
    const groups = findDuplicateWorkGroups(repository);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].works.map((work) => work.id).sort(), ['w1', 'w2']);
  } finally {
    repository.close();
  }
});

function lookupWith(record) {
  return async () => ({
    bn: { source: 'bn', status: 'found', records: [record] },
    openLibrary: { source: 'open_library', status: 'not_found', records: [] },
    comparison: { status: 'incomplete', conflicts: [] },
  });
}

test('a listing of several books with one ISBN goes to review instead of being assigned', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const offer = repository.upsertOffer({
      id: 'o1',
      source: 'fixture',
      normalizedUrl: 'https://example.test/o1',
      originalTitle: 'Gotrek i Felix zestaw 3 książek',
      observedIsbn: '9788382320084',
    });
    const resolver = new CatalogResolver({ repository, lookupMetadata: lookupWith({}) });
    const result = await resolver.resolve({ offerId: offer.id });
    assert.equal(result.decision, 'review_required');
    assert.deepEqual(result.reason, ['possible_bundle']);
    assert.equal(repository.counts().editions, 0);
  } finally {
    repository.close();
  }
});

test('a new catalogue edition gets people and series from its BN record', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const offer = repository.upsertOffer({
      id: 'o1',
      source: 'fixture',
      normalizedUrl: 'https://example.test/o1',
      originalTitle: 'Zabójca krasnoludów Guymer Warhammer',
      observedIsbn: '9788382320084',
    });
    const record = {
      source: 'bn',
      externalRecordId: String(KINSLAYER.id),
      workExternalId: null,
      isbn10: null,
      isbn13: '9788382320084',
      title: 'Zabójca krasnoludów',
      authors: ['David Guymer'],
      publisher: 'Copernicus Corporation',
      publicationYear: 2021,
      language: 'polski',
      binding: 'oprawa miękka',
      materialType: 'książka',
      sourceUrl: 'https://bn.test',
      fetchedAt: '2026-01-01T00:00:00.000Z',
      payloadHash: payloadHash(KINSLAYER),
      originalTitle: 'Kinslayer',
      payload: KINSLAYER,
    };
    const result = await new CatalogResolver({ repository, lookupMetadata: lookupWith(record) }).resolve({
      offerId: offer.id,
    });
    assert.equal(result.decision, 'created_work_and_edition');
    assert.deepEqual(
      editionContributors(repository, result.editionId).map((person) => person.role),
      ['author', 'translator'],
    );
    assert.equal(
      repository.database.prepare('SELECT original_title FROM editions WHERE id=?').get(result.editionId).original_title,
      'Kinslayer',
    );
  } finally {
    repository.close();
  }
});

test('earlier automatic assignments of set listings go back to review once', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    legacyEdition(repository);
    for (const [id, title] of [
      ['bundle', 'Świat Dysku 6 tomów'],
      ['single', 'Zabójca krasnoludów'],
    ]) {
      repository.upsertOffer({ id, source: 'fixture', normalizedUrl: `https://example.test/${id}`, originalTitle: title });
      repository.assignOfferToEdition(id, 'e1', { id: `m-${id}`, method: 'structured_isbn', status: 'active' });
    }
    assert.deepEqual(reviewAutomaticBundleMatches(repository), { skipped: false, requeued: 1 });
    const status = (id) => repository.database.prepare('SELECT status FROM offer_matches WHERE id=?').get(id).status;
    assert.equal(status('m-bundle'), 'superseded');
    assert.equal(status('m-single'), 'active');
    assert.equal(reviewAutomaticBundleMatches(repository).skipped, true);
  } finally {
    repository.close();
  }
});
