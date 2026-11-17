import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { scanMarketplace, searchUrl, tezeuszAuthorSlug } from '../marketplaces.mjs';

const fixture = JSON.parse(
  readFileSync(
    new URL('../fixtures/marketplaces/tezeusz-author-captured.json', import.meta.url),
    'utf8',
  ),
);
const task = (searchQuery, page = 1) => ({
  source: 'Tezeusz.pl',
  host: 'tezeusz.pl',
  mode: 'discovery',
  title: searchQuery,
  searchQuery,
  category: searchQuery,
  paginationVersion: 1,
  page,
});
const html =
  (body, status = 200) =>
  async () =>
    new Response(body, { status, headers: { 'content-type': 'text/html' } });

test('a phrase is read as the author page, never the search address forbidden by robots.txt', () => {
  assert.equal(searchUrl(task('Terry Pratchett')), 'https://tezeusz.pl/autor/terry-pratchett');
  assert.equal(
    searchUrl(task('Terry Pratchett', 3)),
    'https://tezeusz.pl/autor/terry-pratchett?strona=3',
  );
  assert.equal(tezeuszAuthorSlug('Graham McNeill'), 'graham-mcneill');
  assert.equal(tezeuszAuthorSlug('Andrzej Ziemiański'), 'andrzej-ziemianski');
  assert.equal(tezeuszAuthorSlug('Stanisław Lem'), 'stanislaw-lem');
  // Pages that exist under another spelling of the name.
  assert.equal(tezeuszAuthorSlug('Salvatore'), 'r-a-salvatore');
  assert.equal(tezeuszAuthorSlug('Richard Knaak'), 'richard-a-knaak');
  assert.doesNotMatch(searchUrl(task('Dan Abnett')), /szukaj/);
});

test('every book on the author page is kept, and <link rel="next"> leads to the next page', async () => {
  const r = await scanMarketplace(task('Dan Abnett'), {
    pause: async () => {},
    fetcher: html(fixture.html),
  });
  assert.equal(r.offers.length, 3);
  assert.equal(r.pagination.state, 'more');
  assert.equal(r.pagination.nextPage, 2);
  const last = await scanMarketplace(task('Dan Abnett', 2), {
    pause: async () => {},
    fetcher: html(fixture.html.replace(/<link rel="next"[^>]*>/, '')),
  });
  assert.equal(last.pagination.state, 'end');
});

test('a phrase without an author page brings nothing and concludes nothing about earlier offers', async () => {
  const r = await scanMarketplace(task('Świat Dysku'), {
    pause: async () => {},
    fetcher: html('<html>404</html>', 404),
  });
  assert.deepEqual(r.offers, []);
  assert.equal(r.pagination.state, 'unknown');
  // Other sources still report a missing page as an error.
  await assert.rejects(
    scanMarketplace(
      { ...task('x'), source: 'Allegro Lokalnie', host: 'allegrolokalnie.pl' },
      { pause: async () => {}, fetcher: html('<html>404</html>', 404) },
    ),
    /SOURCE_HTTP_404/,
  );
});
