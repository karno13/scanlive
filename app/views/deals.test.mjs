import assert from 'node:assert/strict';
import test from 'node:test';

import { dealMarkup, dealsCountLabel, visibleDeals } from './deals.js';

const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (grosze) => `${grosze / 100} zł`;
const deal = (extra) => ({
  offerId: 'o1',
  title: 'Mort <Pratchett>',
  source: 'Vinted',
  url: 'https://example.test/o1',
  price: 2000,
  condition: 'good',
  firstSeenAt: '2026-11-10T10:00:00Z',
  workId: 'w',
  workTitle: 'Mort',
  worth: 4000,
  worthLow: 3500,
  worthHigh: 4500,
  saving: 2000,
  discount: 50,
  suspicious: false,
  confidence: 'medium',
  confidenceLabel: 'średnia',
  sold: 2,
  live: 3,
  reasons: ['2 potwierdzone sprzedaże.'],
  ...extra,
});

test('low-confidence deals are hidden unless asked for, and the order follows the choice', () => {
  const items = [
    deal({ offerId: 'a', saving: 1000, discount: 60 }),
    deal({ offerId: 'b', saving: 3000, discount: 30, confidence: 'low' }),
    deal({ offerId: 'c', saving: 2000, discount: 40 }),
  ];
  const ids = (options) => visibleDeals(items, options).map((item) => item.offerId);
  assert.deepEqual(ids(), ['c', 'a']);
  assert.deepEqual(ids({ includeLow: true }), ['b', 'c', 'a']);
  assert.deepEqual(ids({ sort: 'discount' }), ['a', 'c']);
  assert.equal(
    dealsCountLabel(items, visibleDeals(items)),
    '2 okazje · 1 ukryta (niska wiarygodność wyceny)',
  );
});

test('a deal row shows price, worth, saving and the links; a suspicious one warns', () => {
  const row = dealMarkup(deal(), { escapeHtml, money });
  assert.match(row, /warta ~40 zł/);
  assert.match(row, /−20 zł · −50%/);
  assert.match(row, /wiarygodność średnia/);
  assert.match(row, /2 sprzedaże, 3 oferty/);
  assert.match(dealMarkup(deal({ sold: 0, live: 1 }), { escapeHtml, money }), /1 oferta</);
  assert.match(row, /data-deal-open="o1"/);
  assert.match(row, /data-deal-work="w"/);
  assert.match(row, /href="https:\/\/example.test\/o1"/);
  assert.doesNotMatch(row, /<Pratchett>/);
  assert.doesNotMatch(row, /sprawdź, czy oferta/);
  assert.match(
    dealMarkup(deal({ suspicious: true }), { escapeHtml, money }),
    /sprawdź, czy oferta/,
  );
});

test('rated deals are hidden unless asked for or rated in this visit; the summary says how often the list was right', async () => {
  const { verdictSummaryLabel } = await import('./deals.js');
  const items = [deal({ offerId: 'a' }), deal({ offerId: 'b', verdict: 'good' }), deal({ offerId: 'c', verdict: 'wrong_match' })];
  const ids = (options) => visibleDeals(items, options).map((item) => item.offerId);
  assert.deepEqual(ids(), ['a']);
  assert.deepEqual(ids({ showRated: true }), ['a', 'b', 'c']);
  assert.deepEqual(ids({ keep: new Set(['c']) }), ['a', 'c']);
  assert.equal(dealsCountLabel(items, visibleDeals(items)), '1 okazja · 2 ocenione ukryte');
  assert.match(dealMarkup(items[0], { escapeHtml, money }), /data-deal-rate="a" data-verdict="wrong_match"/);
  const rated = dealMarkup(items[1], { escapeHtml, money });
  assert.match(rated, /Ocena: <b>Trafna<\/b>/);
  assert.match(rated, /data-deal-unrate="b"/);
  assert.doesNotMatch(rated, /data-deal-rate=/);
  assert.match(verdictSummaryLabel(null), /^Ocenione: 0\./);
  assert.equal(
    verdictSummaryLabel({
      total: 4,
      counts: { good: 3, wrong_match: 1, condition: 0, overvalued: 0 },
      byConfidence: { medium: { total: 3, good: 2 }, high: { total: 1, good: 1 } },
    }),
    'Ocenione: 4 — trafna 3 (75%) · złe przypisanie 1. Przy wiarygodności wysokiej trafne 1 z 1; przy wiarygodności średniej trafne 2 z 3.',
  );
});
