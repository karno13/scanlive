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
  assert.equal(availabilityLabel({ availability: 'unconfirmed' }), 'w wynikach skanu (strony ogłoszenia nie sprawdzano)');
  assert.equal(isPurchasable({ availability: 'sold' }), false);
  assert.equal(isPurchasable({ availability: 'not_seen' }), true);
});

test('listing badge describes the listing, not the identification job', async () => {
  const { availabilityBadge } = await import('./formatters.js');
  const now = Date.parse('2026-11-08T12:00:00Z');
  assert.equal(availabilityBadge({ availability: 'sold' }, now).label, 'Sprzedana');
  assert.equal(availabilityBadge({ availability: 'not_seen' }, now).label, 'Mogła zniknąć');
  // Not checked on the listing page: when the scan saw it, not "Aktywna".
  assert.equal(availabilityBadge({ availability: 'unconfirmed', lastSeenAt: '2026-11-08T09:55:51Z' }, now).label, 'Widziana dziś');
  assert.equal(availabilityBadge({ availability: 'unconfirmed', lastSeenAt: '2026-11-06T09:55:51Z' }, now).label, 'Widziana 2 dni temu');
  assert.equal(availabilityBadge({ availability: 'available' }, now).label, 'Aktywna');
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

test('list rows show short dates; the full one is in the title', async () => {
  const { relativeDate, dateMarkup } = await import('./formatters.js');
  const now = new Date(2026, 10, 10, 21, 0);
  assert.equal(relativeDate(new Date(2026, 10, 10, 20, 53, 55), now), 'dziś 20:53');
  assert.equal(relativeDate(new Date(2026, 10, 9, 8, 1), now), 'wczoraj');
  assert.equal(relativeDate(new Date(2026, 10, 8, 12, 0), now), '8.11');
  assert.equal(relativeDate(new Date(2025, 10, 8, 12, 0), now), '8.11.2025');
  assert.equal(relativeDate(null, now), '-');
  const markup = dateMarkup(new Date(2026, 10, 10, 20, 53, 55), now);
  assert.match(markup, /^<time datetime="[^"]+" title="10\.11\.2026, 20:53:55">dziś 20:53<\/time>$/);
});

test('problem tasks are counted in Polish: 1 zadanie, 3 zadania, 14 zadań', async () => {
  const { problemTasks } = await import('./formatters.js');
  assert.equal(problemTasks(1), '1 zadanie z problemami');
  assert.equal(problemTasks(3), '3 zadania z problemami');
  assert.equal(problemTasks(14), '14 zadań z problemami');
  assert.equal(problemTasks(22), '22 zadania z problemami');
  assert.equal(problemTasks(5), '5 zadań z problemami');
});
