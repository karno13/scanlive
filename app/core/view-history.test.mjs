import test from 'node:test';
import assert from 'node:assert/strict';
import { viewFromSearch, urlForView, shouldPush, VIEWS } from './view-history.js';

// Stage 1 of the 11.2026 review: "Dziś" replaced the scan form as the start view.
test('viewFromSearch accepts known views and falls back to Dziś', () => {
  assert.equal(viewFromSearch(''), 'today');
  assert.equal(viewFromSearch('?view=catalog'), 'catalog');
  assert.equal(viewFromSearch('?view=nope'), 'today');
  assert.equal(viewFromSearch('?view=sources'), 'scanner');
  assert.equal(viewFromSearch('?view=books'), 'catalog');
  assert.equal(viewFromSearch('?view=catalog&x=1'), 'catalog');
  // Every view still opens from its old address (bookmarks, history).
  for (const name of VIEWS) assert.equal(viewFromSearch('?view=' + name), name);
});

test('urlForView maps Dziś to the root and others to ?view=', () => {
  assert.equal(urlForView('today'), '/');
  assert.equal(urlForView('scanner'), '/?view=sources');
  assert.equal(urlForView('catalog'), '/?view=books');
  assert.equal(urlForView('offers'), '/?view=offers');
  assert.equal(urlForView('bogus'), '/');
});

test('shouldPush skips the initial render and repeated visits to the same URL', () => {
  assert.equal(shouldPush('/', 'scanner', true), false);
  assert.equal(shouldPush('/', 'catalog', true), false);
  assert.equal(shouldPush('/', 'catalog', false), true);
  assert.equal(shouldPush('/?view=catalog', 'catalog', false), false);
  assert.equal(shouldPush('/?view=catalog', 'scanner', false), true);
});

test('item ids round-trip through the URL only for list/detail views', async () => {
  const { idFromSearch } = await import('./view-history.js');
  assert.equal(urlForView('catalog', 'w 1/2'), '/?view=books&id=w%201%2F2');
  assert.equal(idFromSearch('?view=catalog&id=w%201%2F2'), 'w 1/2');
  assert.equal(urlForView('offers', 'x'), '/?view=offers');
  assert.equal(urlForView('today', 'x'), '/');
  assert.equal(urlForView('scanner', 'x'), '/?view=sources');
  assert.equal(idFromSearch('?view=review'), null);
  assert.equal(idFromSearch('?id=' + 'a'.repeat(300)), null);
});

test('shouldPush ignores the selected item in the current address', () => {
  assert.equal(shouldPush('/?view=catalog&id=5', 'catalog', false), false);
  assert.equal(shouldPush('/?view=catalog&id=5', 'review', false), true);
});

// Stage 3 of the 11.2026 review: old addresses are recognised and replaced by the new names.
test('old view addresses redirect to the new names, keeping the selected item', async () => {
  const { isLegacyAddress, idFromSearch } = await import('./view-history.js');
  for (const [old, now] of [
    ['?view=catalog&id=w1', '/?view=books&id=w1'],
    ['?view=scanner', '/?view=sources'],
  ]) {
    assert.equal(isLegacyAddress(old), true);
    assert.equal(urlForView(viewFromSearch(old), idFromSearch(old)), now);
  }
  assert.equal(isLegacyAddress('?view=books'), false);
  assert.equal(isLegacyAddress('?view=review'), false);
  // A legacy address is the same view: no extra history entry.
  assert.equal(shouldPush('/?view=catalog', 'catalog', false), false);
});
