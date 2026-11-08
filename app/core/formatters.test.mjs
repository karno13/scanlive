import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, money, date, shortTime, zlotyToGrosze, groszeToZloty, moneyFromZloty } from './formatters.js';

test('escapeHtml encodes HTML markup and attributes', () => {
  assert.equal(escapeHtml('<img src="x" onerror=\'bad\'>&'), '&lt;img src=&quot;x&quot; onerror=&#39;bad&#39;&gt;&amp;');
  assert.equal(escapeHtml(null), '');
});

test('price and date formatters handle missing data', () => {
  assert.equal(money(null), '-');
  assert.match(money(1234), /12,34/);
  assert.equal(date(''), '-');
  assert.equal(shortTime(null), '-');
});

test('złoty inputs and grosze stored prices share an explicit money conversion', () => {
  assert.equal(groszeToZloty(2500), 25);
  assert.equal(zlotyToGrosze(29.99), 2999);
  assert.equal(zlotyToGrosze(0.01), 1);
  assert.equal(zlotyToGrosze(-1), null);
  assert.match(moneyFromZloty(25), /25,00/);
  assert.match(moneyFromZloty(29.99), /29,99/);
  assert.match(moneyFromZloty(-12.5), /-12,50|−12,50/);
});

test('offer lifecycle labels and purchasable filter', async () => {
  const { availabilityLabel, isPurchasable } = await import('./formatters.js');
  assert.equal(availabilityLabel({ availability: 'sold', availabilityChangedAt: '2026-11-07T10:00:00Z' }), 'sprzedana 2026-11-07');
  assert.equal(availabilityLabel({ availability: 'unconfirmed' }), 'dostępność niepotwierdzona');
  assert.equal(isPurchasable({ availability: 'sold' }), false);
  assert.equal(isPurchasable({ availability: 'not_seen' }), true);
});

test('listing badge describes the listing, not the identification job', async () => {
  const { availabilityBadge } = await import('./formatters.js');
  const now = Date.parse('2026-11-08T12:00:00Z');
  assert.equal(availabilityBadge({ availability: 'sold' }, now).label, 'Sprzedana');
  assert.equal(availabilityBadge({ availability: 'not_seen' }, now).label, 'Mogła zniknąć');
  assert.equal(availabilityBadge({ availability: 'unconfirmed', lastSeenAt: '2026-11-08T09:55:51Z' }, now).label, 'Aktywna');
  assert.equal(availabilityBadge({ availability: 'unconfirmed', lastSeenAt: '2026-10-01T09:55:51Z' }, now).label, 'Dawno niewidziana');
});

test('source health note separates a dead source from a partly failing one', async () => {
  const { sourceHealthNote } = await import('./formatters.js');
  assert.equal(sourceHealthNote({ status: 'ok', last_success_at: '2026-11-08T09:00:00Z' }, { short: true }), '');
  assert.equal(sourceHealthNote({ status: 'failed', last_error: 'SOURCE_403' }, { short: true }), 'nie działa');
  assert.match(sourceHealthNote({ status: 'failed', last_error: 'SOURCE_403' }), /nigdy nie zadziałał/);
  assert.equal(sourceHealthNote({ status: 'partial', last_success_at: '2026-11-08T09:00:00Z' }, { short: true }), 'część zapytań zawodzi');
  assert.equal(sourceHealthNote({ status: 'partial' }, { short: true }), 'nie działa');
  assert.equal(sourceHealthNote({ status: 'partial', offers_seen: 223 }, { short: true }), 'część zapytań zawodzi');
});
