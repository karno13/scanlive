import assert from 'node:assert/strict';
import test from 'node:test';

import { alertMarkup, sniperStatusLabel } from './sniper.js';
import { marketRowMarkup, marketSummary } from './market.js';
import { liquidityLabel } from './deals.js';

const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (grosze) => `${(grosze / 100).toFixed(2).replace('.', ',')} zł`;
const now = new Date('2026-11-20T12:00:00Z');

test('the sniper status says whether it runs, what it watches and when it runs next', () => {
  assert.equal(sniperStatusLabel({ enabled: false, targets: 40 }), 'Wyłączony. Obserwowałby 40 książek z najlepszym obrotem.');
  assert.match(sniperStatusLabel({ enabled: true, schedulerOff: true, targets: 40 }), /automatyczne skany są wyłączone/);
  assert.match(sniperStatusLabel({ enabled: true, targets: 0 }), /nie ma jeszcze książek/);
  const running = sniperStatusLabel(
    { enabled: true, targets: 40, batch: 10, everyMinutes: 20, lastRunAt: '2026-11-20T11:50:00Z', lastResult: 'ok', lastPhrases: Array(10).fill('x'), nextRunAt: Date.parse('2026-11-20T12:10:00Z') },
    now,
  );
  assert.match(running, /^Obserwuje 40 książek, po 10 na przebieg, co 20 min · ostatnio \d\d:50 \(10 fraz\) · następnie \d\d:10$/);
});

test('an alert shows the saving, price, worth and sale chance; a gone offer says so', () => {
  const item = { offerId: 'o1', title: 'Mort <Pratchett>', source: 'Vinted', url: 'https://example.test/o1', price: 2500, worth: 8400, saving: 5900, chance: 0.32, alertedAt: '2026-11-20T11:00:00Z', seen: false, gone: false, currentPrice: 2500 };
  const html = alertMarkup(item, { escapeHtml, money, now });
  assert.match(html, /is-new/);
  assert.match(html, /<strong>−59 zł<\/strong> za 25,00 zł · warta ~84 zł · 32% w 30 dni/);
  assert.match(html, /data-alert-open="o1"/);
  assert.doesNotMatch(html, /<Pratchett>/);
  const gone = alertMarkup({ ...item, seen: true, gone: true }, { escapeHtml, money, now });
  assert.match(gone, /już niedostępna/);
  assert.doesNotMatch(gone, /Nowa/);
  assert.match(alertMarkup({ ...item, currentPrice: 3000 }, { escapeHtml, money, now }), /teraz 30,00 zł/);
});

test('liquidity reads as words, a share and the usual time to a sale', () => {
  assert.equal(liquidityLabel({ level: 'fast', chance: 0.312, medianDays: 57 }), 'schodzi szybko · 31% szans na sprzedaż w 30 dni · zwykle ~57 dni');
  assert.equal(liquidityLabel({ level: 'slow', chance: 0.05, medianDays: 365 }), 'schodzi wolno · 5% szans na sprzedaż w 30 dni · zwykle ponad rok');
  assert.equal(liquidityLabel(null), '');
});

test('a market row shows value, range, liquidity, record and turnover', () => {
  const item = {
    editionId: 'e', workId: 'w', title: 'Mort', authors: ['Pratchett, Terry (1948-2015)'], publisher: 'Prószyński', year: 1996,
    value: 27000, low: 23000, high: 31000, confidence: 'medium', confidenceLabel: 'średnia', turnover: 8300, cover: null,
    liquidity: { level: 'fast', chance: 0.31, medianDays: 57, sales: 1, listings: 2, live: 1 },
  };
  const html = marketRowMarkup(item, { escapeHtml });
  for (const text of ['~270 zł', '230–310 zł', 'średnia', 'obrót ~83 zł', 'Terry Pratchett · Prószyński · 1996', 'sprzedane 1 z 2 na Vinted · 1 egzemplarz w sprzedaży', 'data-market-work="w"'])
    assert.ok(html.includes(text), text);
  assert.match(marketRowMarkup({ ...item, liquidity: { ...item.liquidity, listings: 0, sales: 0, live: 0 } }, { escapeHtml }), /bez ofert na Vinted/);
  assert.equal(
    marketSummary({ total: 134, market: { listings: 2364, sales: 151, chance: 0.176 } }),
    '134 wydań z wyceną. Na Vinted 2364 ofert tych wydań, 151 sprzedanych — przeciętny egzemplarz ma 18% szans na sprzedaż w 30 dni.',
  );
});
