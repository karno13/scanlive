import test from 'node:test';
import assert from 'node:assert/strict';
import { bestBuyback, bookTilesMarkup, bookOffersMarkup } from './book-page.js';

const money = (grosze) => (grosze / 100).toFixed(2) + ' zł';
const escapeHtml = (value) => String(value).replace(/[<>&"]/g, '');

test('book tiles show lowest, median, Vinted sold and buyback', () => {
  const overview = {
    overall: { offers: 12, live: 9, min: 2000, median: 4000, sold: 3 },
    vintedSold: { count: 2, median: 3000, min: 2500, max: 3500 },
  };
  const html = bookTilesMarkup(overview, { status: 'priced', price: 16.55, checkedAt: '2026-11-14T10:00:00Z' }, { money, escapeHtml, isbns: 1 });
  for (const text of ['Najniższa cena', '20.00 zł', 'Mediana ofert', '40.00 zł', '9 ofert', 'Sprzedane na Vinted', '30.00 zł', '2 sprzedaże', 'Cena skupu', '16,55'])
    assert.ok(html.includes(text), text);
  // One offer on sale: its price is the lowest and the median at once, so no median tile.
  const one = bookTilesMarkup({ overall: { offers: 1, live: 1, min: 5742, median: 5742 } }, null, { money, escapeHtml, isbns: 1 });
  assert.ok(one.includes('Najniższa cena') && !one.includes('Mediana ofert'));
});

test('book tiles without data say so instead of showing zeros', () => {
  const html = bookTilesMarkup(null, null, { money, escapeHtml, isbns: 0 });
  assert.match(html, /brak dostępnych ofert/);
  assert.match(html, /brak ISBN-13/);
  assert.doesNotMatch(html, /0\.00 zł/);
});

test('best buyback prefers the highest priced quote', () => {
  const quotes = {
    a: { status: 'not_bought', checkedAt: '2026-11-15' },
    b: { status: 'priced', price: 4.2, checkedAt: '2026-11-01' },
    c: { status: 'priced', price: 9.1, checkedAt: '2026-11-02' },
  };
  assert.equal(bestBuyback(quotes).price, 9.1);
  assert.equal(bestBuyback({ a: quotes.a }).status, 'not_bought');
  assert.equal(bestBuyback({}), null);
});

test('book offers: on sale first, links to the listing, the rest behind "Pokaż więcej"', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    id: 'o' + i,
    title: 'Oferta ' + i,
    source: 'Vinted',
    url: 'https://www.vinted.pl/items/' + i,
    currentPrice: 1000 + i,
    availability: i === 0 ? 'sold' : 'active',
  }));
  const html = bookOffersMarkup({ items, total: 30 }, { title: 'X' }, { money, escapeHtml });
  assert.ok(html.indexOf('data-work-offer="o1"') < html.indexOf('data-work-offer="o2"'));
  assert.ok(!html.includes('data-work-offer="o0"'), 'sold offer moves past the first page');
  assert.match(html, /href="https:\/\/www\.vinted\.pl\/items\/1" target="_blank"/);
  assert.match(html, /Pokaż więcej \(20 najtańszych z 30\)/);
  const all = bookOffersMarkup({ items, total: 20 }, { title: 'X' }, { money, escapeHtml, showAll: true });
  assert.ok(all.includes('data-work-offer="o0"'));
  assert.ok(!all.includes('data-bp-all-offers'));
});
