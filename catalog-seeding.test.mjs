import assert from 'node:assert/strict';
import test from 'node:test';

import { KINSLAYER, marcField as f } from './fixtures/metadata/bn-kinslayer.mjs';
import { editionContributors } from './catalog-bibliography.mjs';
import { createSeedService, seedUrl } from './catalog-seeding.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

const OTHER = {
  ...KINSLAYER,
  id: 1000000000002,
  isbnIssn: '9788382320138',
  marc: {
    fields: [
      f('020', [{ a: '9788382320138' }]),
      f('100', [{ a: 'Guymer, David' }, { e: 'Autor' }], '1'),
      f('245', [{ a: 'Zabójca zabójców /' }], '1', '0'),
      f('260', [{ b: 'Copernicus Corporation,' }, { c: '2022.' }]),
    ],
  },
};
const AUDIOBOOK = { ...OTHER, id: 3, isbnIssn: '9788382321173', kind: 'audiobook' };
const ENGLISH = { ...OTHER, id: 4, isbnIssn: '9781784960001', language: 'angielski' };
const NO_ISBN = { ...OTHER, id: 5, isbnIssn: '' };

function service(repository, pages, calls = []) {
  return createSeedService(repository, {
    requestBn: async (url) => {
      calls.push(url);
      const page = pages.shift();
      return typeof page === 'function' ? page(url) : page;
    },
    setTimer: () => null,
    clearTimer: () => {},
  });
}

test('a seed adds every Polish book with an ISBN as a reference edition, page by page', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const calls = [];
    const next = 'https://data.bn.org.pl/api/institutions/bibs.json?author=Guymer&sinceId=2';
    const seeds = service(
      repository,
      [
        { status: 'found', payload: { bibs: [KINSLAYER, AUDIOBOOK, ENGLISH], nextPage: next } },
        { status: 'found', payload: { bibs: [OTHER, NO_ISBN, KINSLAYER], nextPage: '' } },
      ],
      calls,
    );
    const seed = seeds.add({ kind: 'author', query: 'Guymer, David', publisher: 'Copernicus' });
    assert.match(calls[0] ?? seedUrl({ kind: 'author', query: 'Guymer, David', publisher_filter: 'Copernicus' }), /author=Guymer/);
    assert.equal((await seeds.step()).state, 'more');
    assert.equal(calls[1] ?? calls[0], calls[0]);
    assert.equal((await seeds.step()).state, 'done');
    assert.equal(calls[1], next, 'follows BN pagination');
    assert.equal(repository.counts().editions, 2);
    const [listed] = seeds.list().seeds;
    assert.equal(listed.id, seed.id);
    assert.equal(listed.status, 'done');
    assert.equal(listed.editionsCreated, 2);
    assert.equal(listed.alreadyKnown, 1);
    assert.equal(listed.skipped, 3);
    const edition = repository.findEditionByISBN('9788382320084');
    assert.equal(edition.title, 'Zabójca krasnoludów');
    assert.deepEqual(editionContributors(repository, edition.id).map((person) => person.name), ['David Guymer', 'Jacek Czuba']);
    assert.equal(
      repository.database.prepare("SELECT count(*) AS n FROM offer_matches").get().n,
      0,
      'seeding never assigns offers',
    );
  } finally {
    repository.close();
  }
});

test('a BN outage pauses seeding without failing the seed', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const seeds = service(repository, [{ status: 'temporary_error', error: { code: 'CERT_HAS_EXPIRED' } }]);
    seeds.add({ kind: 'publisher', query: 'Copernicus Corporation' });
    const result = await seeds.step();
    assert.deepEqual(result, { state: 'outage', reason: 'CERT_HAS_EXPIRED' });
    const data = seeds.list();
    assert.equal(data.seeds[0].status, 'active');
    assert.equal(data.lastOutage.reason, 'CERT_HAS_EXPIRED');
    assert.ok(data.pausedUntil);
    assert.equal((await seeds.step()).state, 'paused', 'no request while paused');
  } finally {
    repository.close();
  }
});

test('seed input is validated, deduplicated and can be paused or removed', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const seeds = service(repository, []);
    assert.throws(() => seeds.add({ kind: 'isbn', query: 'x' }), /INVALID_SEED_KIND/);
    assert.throws(() => seeds.add({ kind: 'author', query: 'a' }), /INVALID_SEED_QUERY/);
    const first = seeds.add({ kind: 'author', query: 'Abnett' });
    const again = seeds.add({ kind: 'author', query: 'Abnett' });
    assert.equal(again.id, first.id);
    assert.equal(seeds.setStatus(first.id, 'paused').status, 'paused');
    assert.deepEqual(seeds.remove(first.id), { removed: true });
    assert.throws(() => seeds.remove(first.id), /SEED_NOT_FOUND/);
  } finally {
    repository.close();
  }
});

test('only BN pagination links are followed', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const seeds = service(repository, [{ status: 'found', payload: { bibs: [KINSLAYER], nextPage: 'https://evil.test/next' } }]);
    seeds.add({ kind: 'title', query: 'Gotrek' });
    assert.equal((await seeds.step()).state, 'done');
  } finally {
    repository.close();
  }
});
