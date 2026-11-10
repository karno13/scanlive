import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogResolver } from './catalog-resolver.mjs';
import { lookupISBN, persistMetadataResults } from './metadata-lookup.mjs';
import { createGoogleBooksAdapter } from './metadata-sources/google-books.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

const ISBN = '9788382320138';
const volume = {
  items: [
    {
      id: 'gb-1',
      volumeInfo: {
        title: 'Zabójca zabójców',
        authors: ['David Guymer'],
        publisher: 'Copernicus Corporation',
        publishedDate: '2022-03',
        language: 'pl',
        printType: 'BOOK',
        industryIdentifiers: [{ type: 'ISBN_13', identifier: ISBN }],
      },
    },
  ],
};

const adapter = (calls = []) =>
  createGoogleBooksAdapter({
    apiKey: 'secret-key',
    requester: async (url) => {
      calls.push(url);
      return { status: 'found', payload: volume, url };
    },
  });

test('Google Books maps a volume and never keeps the API key in the result', async () => {
  const calls = [];
  const result = await adapter(calls).lookup(ISBN);
  assert.match(calls[0], /key=secret-key/);
  assert.equal(result.status, 'found');
  assert.equal(result.records[0].title, 'Zabójca zabójców');
  assert.equal(result.records[0].language, 'polski');
  assert.equal(result.records[0].publicationYear, 2022);
  assert.doesNotMatch(JSON.stringify(result), /secret-key/);
  const disabled = createGoogleBooksAdapter({
    requester: async () => assert.fail('no request without a key'),
  });
  assert.equal(disabled.enabled, false);
});

test('Google Books stands in when BN is down and Open Library has nothing', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const bnAdapter = {
      source: 'bn',
      lookup: async () => ({
        source: 'bn',
        status: 'temporary_error',
        records: [],
        error: { code: 'CERT_HAS_EXPIRED' },
      }),
    };
    const openLibraryAdapter = {
      source: 'open_library',
      lookup: async () => ({ source: 'open_library', status: 'not_found', records: [] }),
    };
    const lookupMetadata = (isbn) =>
      lookupISBN(isbn, { bnAdapter, openLibraryAdapter, googleBooksAdapter: adapter() });
    const metadata = await lookupMetadata(ISBN);
    assert.equal(metadata.googleBooks.status, 'found');
    const offer = repository.upsertOffer({
      id: 'o1',
      source: 'fixture',
      normalizedUrl: 'https://example.test/o1',
      originalTitle: 'Zabójca zabójców Guymer',
      observedIsbn: ISBN,
    });
    const result = await new CatalogResolver({ repository, lookupMetadata }).resolve({
      offerId: offer.id,
    });
    assert.equal(result.decision, 'created_work_and_edition');
    const stored = repository.database
      .prepare(
        "SELECT provider, external_id FROM external_records WHERE external_id LIKE 'google_books:%'",
      )
      .get();
    assert.deepEqual({ ...stored }, { provider: 'other', external_id: 'google_books:gb-1' });
    assert.equal(
      persistMetadataResults(repository, [metadata.googleBooks]).externalRecordsCreated,
      0,
      'idempotent',
    );
  } finally {
    repository.close();
  }
});

test('Google Books is not asked when BN knows the ISBN', async () => {
  const calls = [];
  const bnAdapter = {
    source: 'bn',
    lookup: async () => ({ source: 'bn', status: 'found', records: [] }),
  };
  const openLibraryAdapter = {
    source: 'open_library',
    lookup: async () => assert.fail('OL not needed'),
  };
  const metadata = await lookupISBN(ISBN, {
    bnAdapter,
    openLibraryAdapter,
    googleBooksAdapter: adapter(calls),
  });
  assert.equal(metadata.googleBooks.status, 'skipped');
  assert.equal(calls.length, 0);
});
