import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMarketplaceGate } from '../marketplace-gate.mjs';
import {
  marketplacePageInfo,
  parseMarketplace,
  readSourceHtml,
  searchUrl,
} from '../marketplaces.mjs';
import { offerKind } from '../offer-kinds.mjs';

const fixture = JSON.parse(
  readFileSync(
    new URL('../fixtures/marketplaces/skupszop-listing-captured.json', import.meta.url),
    'utf8',
  ),
);
const task = (extra = {}) => ({
  source: 'Skupszop.pl',
  host: 'skupszop.pl',
  mode: 'discovery',
  title: 'Pratchett',
  searchQuery: 'Pratchett',
  category: 'Pratchett',
  page: 1,
  paginationVersion: 1,
  ...extra,
});

test('Skupszop: the phrase goes to the list API the shop allows in robots.txt', () => {
  const url = new URL(searchUrl(task({ searchQuery: 'Świat Dysku', page: 2 })));
  assert.equal(url.origin + url.pathname, 'https://skupszop.pl/api/search/listing');
  assert.equal(url.searchParams.get('filters[keyword]'), 'Świat Dysku');
  assert.equal(url.searchParams.get('routeName'), 'listing.search');
  assert.equal(url.searchParams.get('page'), '2');
});

test('Skupszop: every book carries its ISBN, condition and the prices of other conditions', () => {
  const [first] = parseMarketplace(fixture.html, task());
  assert.equal(first.title, 'Nacja - Terry Pratchett');
  assert.equal(first.isbn, '9788375103670');
  assert.equal(first.publisher, 'Rebis');
  assert.equal(first.conditionText, 'dobry');
  assert.equal(first.conditionClass, 'good');
  assert.equal(first.price, 2190);
  assert.match(first.listingDescription, /jak nowa: 29\.75 zł \(9 szt\.\)/);
  assert.equal(offerKind({ source: 'Skupszop.pl' }), 'antiquarian');
});

test('Skupszop: the next page comes from the page list of the answer', () => {
  const body = JSON.parse(fixture.html);
  assert.equal(marketplacePageInfo(fixture.html, task(), []).nextPage, 2);
  const last = Math.max(...body.data.pages);
  assert.equal(marketplacePageInfo(fixture.html, task({ page: last }), []).state, 'end');
  assert.throws(
    () => parseMarketplace('{"success":false}', task()),
    /UNRECOGNIZED_MARKETPLACE_DATA/,
  );
});

test('a JSON answer is read only from Skupszop; other sources must answer HTML', async () => {
  const options = (source) => ({
    source,
    gate: createMarketplaceGate({ intervalMs: 0 }),
    pause: async () => {},
    fetcher: async (_url, init) => {
      assert.equal(
        init.headers.Accept,
        source === 'Skupszop.pl' ? 'application/json' : 'text/html',
      );
      return new Response(fixture.html, { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(await readSourceHtml(searchUrl(task()), options('Skupszop.pl')), fixture.html);
  await assert.rejects(
    readSourceHtml('https://tezeusz.pl/szukaj?szukaj=x', options('Tezeusz.pl')),
    /SOURCE_NOT_HTML/,
  );
});

test('a Skupszop product page is read as HTML (its photo), only the list API as JSON', async () => {
  const page = '<html><meta property="og:image" content="https://skupszop.pl/x.jpg"></html>';
  const html = await readSourceHtml('https://skupszop.pl/mort-terry-pratchett', {
    source: 'Skupszop.pl',
    gate: createMarketplaceGate({ intervalMs: 0 }),
    pause: async () => {},
    fetcher: async (_url, init) => {
      assert.equal(init.headers.Accept, 'text/html');
      return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  });
  assert.equal(html, page);
});
