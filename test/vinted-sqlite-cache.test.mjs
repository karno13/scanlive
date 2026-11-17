import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { createSqliteVintedDetailCache } from '../vinted-detail-sqlite-cache.mjs';

test('Vinted language evidence survives repository reopen and expires', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  let time = 1000;
  const options = { now: () => time, ttlMs: 1000, maxEntries: 2 };
  const one = createSqliteVintedDetailCache(repo, options);
  one.set('https://www.vinted.pl/items/1', { language: 'Polski', isbn: '9780000000002' });
  one.set('https://www.vinted.pl/items/2', { language: 'angielski' });
  one.set('https://www.vinted.pl/items/unknown', { language: null });
  const second = createSqliteVintedDetailCache(repo, options);
  assert.deepEqual(second.get('https://www.vinted.pl/items/1'), {
    language: 'Polski',
    isbn: '9780000000002',
  });
  assert.equal(second.size(), 2);
  time = 2000;
  assert.equal(second.get('https://www.vinted.pl/items/1'), undefined);
  repo.close();
});

test('a recognised Vinted page without a language is kept for a week, not 90 days', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  let time = 0;
  const day = 24 * 60 * 60 * 1000;
  const cache = createSqliteVintedDetailCache(repo, { now: () => time });
  cache.set('https://www.vinted.pl/items/3', {
    language: null,
    languageStatus: 'missing_in_response',
  });
  cache.set('https://www.vinted.pl/items/4', {
    language: null,
    languageStatus: 'schema_unrecognized',
  });
  assert.deepEqual(cache.get('https://www.vinted.pl/items/3'), { language: null });
  assert.equal(cache.get('https://www.vinted.pl/items/4'), undefined);
  time = 8 * day;
  assert.equal(cache.get('https://www.vinted.pl/items/3'), undefined);
  repo.close();
});

test('Vinted SQLite cache never retains unknown or overly long language data', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  const cache = createSqliteVintedDetailCache(repo);
  cache.set('a', { language: '' });
  cache.set('b', { language: 'x'.repeat(101) });
  assert.equal(cache.size(), 0);
  repo.close();
});

test('a cached read keeps the delivery price, so a free-delivery foreign edition stays accepted', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  const cache = createSqliteVintedDetailCache(repo);
  cache.set('https://www.vinted.pl/items/5', { language: 'angielski', shippingCost: 0 });
  cache.set('https://www.vinted.pl/items/6', { language: 'angielski', shippingCost: 'free' });
  assert.deepEqual(cache.get('https://www.vinted.pl/items/5'), {
    language: 'angielski',
    shippingCost: 0,
  });
  assert.deepEqual(cache.get('https://www.vinted.pl/items/6'), { language: 'angielski' });
  repo.close();
});
