// Stage 1 of the 11.2026 review: the "Dziś" summary and the state of every source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { sourceStatus, sourceReason } from '../source-status.mjs';
import { todaySummary } from '../today.mjs';
import { listCatalogOffers } from '../catalog-api.mjs';
import { todayTiles, sourceLine, whenLabel } from '../app/views/today.js';

function seed() {
  const repository = new SqliteCatalogRepository(':memory:');
  const db = repository.database;
  const run = (at, errors) =>
    db
      .prepare('INSERT INTO scan_runs(scanned_at, summary_json, created_at) VALUES(?, ?, ?)')
      .run(at, JSON.stringify({ at, found: 12, newOffers: 2, priceChanges: 1, errors }), at);
  const health = (source, row) =>
    db
      .prepare(
        'INSERT INTO source_health(source,last_checked_at,last_success_at,last_error_at,last_error,status) VALUES(?,?,?,?,?,?)',
      )
      .run(
        source,
        row.checked,
        row.success ?? null,
        row.errorAt ?? null,
        row.error ?? null,
        row.status,
      );
  const captcha = (source) => ({ source, query: 'x', code: 'SOURCE_CAPTCHA', blocked: true });
  run('2026-11-01T10:00:00.000Z', [
    captcha('Allegro'),
    { source: 'OLX', query: 'x', code: 'SOURCE_HTTP_403' },
  ]);
  run('2026-11-11T08:00:00.000Z', [captcha('Allegro')]);
  run('2026-11-11T09:00:00.000Z', [captcha('Allegro'), captcha('Allegro Lokalnie')]);
  run('2026-11-11T19:00:00.000Z', [captcha('Allegro'), captcha('Allegro Lokalnie')]);
  health('Allegro', {
    checked: '2026-11-11T19:00:00.000Z',
    errorAt: '2026-11-11T19:00:00.000Z',
    error: 'SOURCE_CAPTCHA',
    status: 'failed',
  });
  health('OLX', {
    checked: '2026-11-01T10:00:00.000Z',
    errorAt: '2026-11-01T10:00:00.000Z',
    error: 'SOURCE_HTTP_403',
    status: 'failed',
  });
  health('Allegro Lokalnie', {
    checked: '2026-11-11T19:00:00.000Z',
    success: '2026-11-11T08:00:00.000Z',
    errorAt: '2026-11-11T19:00:00.000Z',
    error: 'SOURCE_CAPTCHA',
    status: 'failed',
  });
  health('Vinted', {
    checked: '2026-11-11T19:00:00.000Z',
    success: '2026-11-11T19:00:00.000Z',
    status: 'ok',
  });
  return repository;
}

test('each source: works, down since the first failed scan after its last success; Allegro and OLX have no legal access', () => {
  const repository = seed();
  try {
    const rows = sourceStatus(repository, [
      'Vinted',
      'Allegro',
      'OLX',
      'Allegro Lokalnie',
      'Empik',
    ]);
    const by = Object.fromEntries(rows.map((row) => [row.source, row]));
    assert.deepEqual(
      rows.map((row) => row.state),
      ['down', 'unknown', 'ok', 'no_access', 'no_access'],
      'non-working first, sources without legal access last',
    );
    assert.equal(by['Allegro Lokalnie'].state, 'down');
    assert.equal(by['Allegro Lokalnie'].downSince, '2026-11-11T09:00:00.000Z');
    assert.equal(by['Allegro Lokalnie'].reason, 'serwis żąda CAPTCHA (blokada automatów)');
    // Not an error: a stated fact (docs/SOURCES-ACCESS-2026-11.md), never red and never retried.
    assert.equal(by.Allegro.state, 'no_access');
    assert.equal(by.Allegro.downSince, null);
    assert.match(by.OLX.reason, /brak legalnego dostępu/);
    assert.equal(by.Vinted.state, 'ok');
    assert.equal(by.Vinted.downSince, null);
    assert.equal(by.Empik.state, 'unknown');
    assert.equal(sourceReason('SOURCE_HTTP_502'), 'błąd serwisu (HTTP 502)');
  } finally {
    repository.close();
  }
});

test('Dziś counts what changed since the visit, with the filters of the list it opens', () => {
  const repository = seed();
  try {
    const db = repository.database;
    const offer = (id, firstSeen) =>
      repository.upsertOffer({
        source: 'Vinted',
        normalizedUrl: 'https://www.vinted.pl/items/' + id,
        originalTitle: 'Książka ' + id,
        currentPrice: 1000,
        observedAt: firstSeen,
      });
    const old = offer(1, '2026-11-10T10:00:00.000Z');
    const fresh = offer(2, '2026-11-11T19:00:00.000Z');
    db.prepare('UPDATE offers SET first_seen_at=? WHERE id=?').run(
      '2026-11-10T10:00:00.000Z',
      old.id,
    );
    db.prepare('UPDATE offers SET first_seen_at=? WHERE id=?').run(
      '2026-11-11T19:00:00.000Z',
      fresh.id,
    );
    db.prepare(
      'INSERT INTO scan_offer_results(scanned_at, offer_id, is_new, price_changed) VALUES(?,?,?,?)',
    ).run('2026-11-11T19:00:00.000Z', old.id, 0, 1);
    db.prepare(
      'INSERT INTO scan_offer_results(scanned_at, offer_id, is_new, price_changed) VALUES(?,?,?,?)',
    ).run('2026-11-11T19:00:00.000Z', fresh.id, 1, 0);

    const visit = todaySummary(repository, {
      since: '2026-11-11T12:00:00Z',
      sources: ['Vinted', 'Allegro'],
    });
    assert.equal(visit.scope, 'visit');
    assert.equal(visit.newOffers.count, 1);
    assert.deepEqual(visit.newOffers.filters, {
      since: '2026-11-11T12:00:00.000Z',
      sort: 'newest',
    });
    assert.equal(visit.priceChanges.count, 1);
    // The count and the list it opens agree.
    assert.equal(listCatalogOffers(repository, visit.newOffers.filters).total, 1);
    assert.equal(listCatalogOffers(repository, visit.priceChanges.filters).items[0].id, old.id);
    assert.equal(visit.lastScan.at, '2026-11-11T19:00:00.000Z');
    assert.deepEqual(visit.lastScan.failedSources, ['Allegro Lokalnie']);
    // Runs saved before the duration was recorded have none.
    assert.equal(visit.lastScan.durationMs, null);
    assert.equal(visit.nextScan.enabled, false);

    // No previous visit in this browser: "new" means new in the last scan.
    const first = todaySummary(repository, { since: null, sources: ['Vinted'] });
    assert.equal(first.scope, 'scan');
    assert.deepEqual(first.newOffers.filters, {
      scan: '2026-11-11T19:00:00.000Z',
      scanChange: 'new',
      sort: 'newest',
    });
    assert.equal(first.newOffers.count, 1);
    assert.equal(todaySummary(repository, { since: 'nonsense', sources: [] }).scope, 'scan');
  } finally {
    repository.close();
  }
});

test('tiles: each opens a filtered list; non-working sources are named and marked', () => {
  const now = new Date('2026-11-11T21:00:00');
  const data = {
    scope: 'visit',
    since: '2026-11-11T12:00:00.000Z',
    newOffers: { count: 62, filters: { since: '2026-11-11T12:00:00.000Z', sort: 'newest' } },
    priceChanges: {
      count: 4,
      filters: { priceChangedSince: '2026-11-11T12:00:00.000Z', sort: 'newest' },
    },
    queue: { decisions: 240, offers: 284 },
    sources: [
      {
        source: 'Allegro',
        state: 'never',
        downSince: '2026-11-01T19:48:18.570Z',
        reason: 'serwis żąda CAPTCHA (blokada automatów)',
      },
      {
        source: 'Dedalus.pl',
        state: 'down',
        downSince: '2026-11-11T08:30:00.000Z',
        reason: 'serwis żąda CAPTCHA (blokada automatów)',
      },
      { source: 'Vinted', state: 'ok', lastSuccessAt: '2026-11-11T19:10:00.000Z' },
    ],
    lastScan: {
      at: '2026-11-11T19:10:00.000Z',
      found: 1293,
      newOffers: 17,
      failedSources: [],
      filters: { scan: '2026-11-11T19:10:00.000Z' },
    },
    nextScan: { enabled: true, at: '2026-11-12T07:16:00.000Z', quickAt: null },
  };
  const tiles = todayTiles(data, now);
  assert.deepEqual(
    tiles.map((tile) => tile.id),
    ['new', 'price', 'queue', 'sources', 'last-scan', 'next-scan'],
  );
  assert.deepEqual(tiles[0].go, { offers: data.newOffers.filters });
  assert.deepEqual(tiles[1].go, { offers: data.priceChanges.filters });
  assert.deepEqual(tiles[2].go, { view: 'review' });
  assert.equal(tiles[3].value, '1/3');
  assert.equal(tiles[3].warn, true);
  assert.match(tiles[3].note, /Allegro, Dedalus\.pl/);
  assert.deepEqual(tiles[4].go, { offers: { scan: '2026-11-11T19:10:00.000Z' } });
  assert.equal(tiles[5].value, whenLabel('2026-11-12T07:16:00.000Z', now));
  assert.match(
    sourceLine(data.sources[1], now),
    /^nie działa od dziś \d\d:\d\d — serwis żąda CAPTCHA/,
  );
  assert.match(
    sourceLine(data.sources[0], now),
    /^nigdy nie zadziałał \(próby od 1\.11, \d\d:\d\d\) — /,
  );
  assert.match(sourceLine(data.sources[2], now), /^działa · ostatnio dziś /);
  assert.match(whenLabel('2026-11-10T20:10:00', now), /^wczoraj 20:10$/);
});

test('the source list shows failing and no-access sources, and folds the working ones into one line', async () => {
  const { sourceRows } = await import('../app/views/today.js');
  const escape = (value) => String(value);
  const html = sourceRows(
    [
      { source: 'A', state: 'ok' },
      { source: 'B', state: 'down', reason: 'CAPTCHA' },
      { source: 'C', state: 'ok' },
      { source: 'D', state: 'no_access' },
    ],
    new Date('2026-11-15T12:00:00Z'),
    escape,
  );
  assert.match(html, /<summary>2 działa<\/summary>/);
  assert.ok(html.indexOf('data-source="B"') < html.indexOf('<summary>'));
  assert.ok(html.indexOf('data-source="D"') < html.indexOf('<summary>'));
  assert.ok(html.indexOf('data-source="A"') > html.indexOf('<summary>'));
});

test('the command palette says "oferta / oferty / ofert" correctly', async () => {
  const { offersWord } = await import('../app/views/palette.js');
  assert.deepEqual([1, 2, 5, 12, 22, 25].map(offersWord), [
    'oferta',
    'oferty',
    'ofert',
    'ofert',
    'oferty',
    'ofert',
  ]);
});
