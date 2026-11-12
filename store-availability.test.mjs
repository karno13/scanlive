import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkOfferLifecycle,
  confirmFromListingCodes,
  LIFECYCLE_SOURCES,
  parseStoreAvailability,
  pendingConfirmations,
} from './offer-lifecycle.mjs';
import { NO_LEGAL_ACCESS, hasNoLegalAccess, scannableSources } from './source-blocks.mjs';
import { searchOffers, validateSearchInput } from './local-app.mjs';
import { sourcesToScan } from './scan-schedule.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

test('store pages: Empik meta, Allegro Lokalnie microdata, JSON-LD of Tezeusz', () => {
  assert.equal(
    parseStoreAvailability('<meta data-rh="true" property="product:availability" content="true"/>'),
    'available',
  );
  assert.equal(
    parseStoreAvailability('<meta property="product:availability" content="false"/>'),
    'unavailable',
  );
  assert.equal(
    parseStoreAvailability('<link itemprop="availability" href="http://schema.org/InStock">'),
    'available',
  );
  assert.equal(
    parseStoreAvailability('<link itemprop="availability" href="http://schema.org/SoldOut">'),
    'sold',
  );
  assert.equal(
    parseStoreAvailability('{"price":"17.83","availability":"https://schema.org/InStock","x":1}'),
    'available',
  );
  assert.equal(
    parseStoreAvailability('{"availability":"https://schema.org/OutOfStock"}'),
    'unavailable',
  );
  assert.equal(parseStoreAvailability('<html>nic</html>'), null);
  assert.equal(parseStoreAvailability('{"availability":"https://schema.org/Whatever"}'), null);
});

test('Allegro and OLX have no legal access: not scanned, not in the lifecycle', () => {
  assert.deepEqual(Object.keys(NO_LEGAL_ACCESS).sort(), ['Allegro', 'OLX']);
  assert.equal(hasNoLegalAccess('Allegro'), true);
  assert.equal(hasNoLegalAccess('Allegro Lokalnie'), false);
  assert.deepEqual(scannableSources(['Vinted', 'Allegro', 'OLX', 'Empik']), ['Vinted', 'Empik']);
  assert.equal(LIFECYCLE_SOURCES.has('Allegro'), false);
  assert.equal(LIFECYCLE_SOURCES.has('OLX'), false);
  assert.equal(LIFECYCLE_SOURCES.has('Dedalus.pl'), false);
  assert.deepEqual(
    validateSearchInput({ queries: ['a'], sources: ['Vinted', 'Allegro'] }).sources,
    ['Vinted'],
  );
  assert.throws(
    () => validateSearchInput({ queries: ['a'], sources: ['Allegro', 'OLX'] }),
    /INVALID_SOURCES/,
  );
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    assert.deepEqual(sourcesToScan(repository, ['Vinted', 'Allegro', 'OLX']).sources, ['Vinted']);
  } finally {
    repository.close();
  }
  assert.equal(typeof searchOffers, 'function');
});

test('availability from the shop listing code and from product pages of the non-Vinted sources', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const now = () => new Date('2026-11-12T12:00:00.000Z');
    const seen = '2026-11-12T08:00:00.000Z';
    const add = (id, source, price, extra = {}) =>
      repository.upsertOffer({
        id,
        source,
        normalizedUrl: `https://example.test/${id}`,
        originalTitle: id,
        currentPrice: price,
        lastSeenAt: seen,
        firstSeenAt: seen,
        ...extra,
      });
    add('empik-in', 'Empik', 3000, { sourceAvailability: 'IN_24_H' });
    add('empik-pre', 'Empik', 3000, { sourceAvailability: 'PRE_SALE' });
    add('empik-odd', 'Empik', 3000, { sourceAvailability: 'WITHDRAWN' });
    add('tezeusz', 'Tezeusz.pl', 5000);
    add('lokalnie', 'Allegro Lokalnie', 2000);
    const state = (id) =>
      repository.database
        .prepare('SELECT availability, availability_checked_at AS at FROM offers WHERE id=?')
        .get(id);
    assert.equal(confirmFromListingCodes(repository, { now }).confirmed, 2);
    assert.equal(state('empik-in').availability, 'available');
    assert.equal(state('empik-in').at, seen);
    assert.equal(state('empik-odd').availability, 'unconfirmed');
    // Most expensive first; offers already confirmed are not asked again.
    assert.deepEqual(
      pendingConfirmations(repository).map((row) => row.id),
      ['tezeusz', 'empik-odd', 'lokalnie'],
    );
    const asked = [];
    const report = await checkOfferLifecycle(repository, {
      now,
      limit: 5,
      fetchHtml: async (url, source) => {
        asked.push(source);
        return url.includes('tezeusz')
          ? '{"availability":"https://schema.org/SoldOut"}'
          : url.includes('lokalnie')
            ? '<link itemprop="availability" href="http://schema.org/InStock">'
            : '<html>nic</html>';
      },
    });
    assert.deepEqual(asked, ['Tezeusz.pl', 'Empik', 'Allegro Lokalnie']);
    assert.equal(report.checked, 3);
    assert.equal(state('tezeusz').availability, 'sold');
    assert.equal(state('lokalnie').availability, 'available');
    assert.equal(
      state('empik-odd').availability,
      'unconfirmed',
      'an unreadable page confirms nothing',
    );
    assert.equal(report.unresolved.unrecognizedPage, 1);
  } finally {
    repository.close();
  }
});
