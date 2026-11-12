import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkOfferLifecycle,
  parseVintedStatus,
  pendingLifecycleChecks,
} from './offer-lifecycle.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

// Shapes of the Vinted item-page sidebar plugins (escaped inside the Next.js payload).
const soldPage = (id) =>
  `self.__next_f.push([1,"91:[\\"$\\",\\"$L14b\\",null,{\\"plugins\\":[{\\"data\\":{\\"item_id\\":\\"${id}\\",\\"seller_id\\":\\"1\\",\\"theme\\":\\"SUCCESS\\",\\"title\\":\\"Sprzedane\\"},\\"exposures\\":[],\\"name\\":\\"buyer_item_status\\",\\"section\\":\\"sidebar\\"}]}]"])`;
const livePage = (id, reserved = false) =>
  `{"data":{"can_buy":true,"instant_buy":true,"is_hidden":false,"is_reserved":${reserved},"item_id":"${id}","reservation":null,"seller_id":"1"},"exposures":[],"name":"ask_seller","section":"sidebar"}` +
  // A "sold" similar item elsewhere on the page must not count.
  `{"data":{"item_id":"999","seller_id":"2","theme":"SUCCESS","title":"Sprzedane"},"exposures":[],"name":"buyer_item_status"}`;

test('Vinted item status: sold, reserved, available, or unknown', () => {
  assert.equal(parseVintedStatus(soldPage('123'), '123'), 'sold');
  assert.equal(parseVintedStatus(livePage('123'), '123'), 'available');
  assert.equal(parseVintedStatus(livePage('123', true), '123'), 'reserved');
  assert.equal(parseVintedStatus(livePage('123'), '999'), 'sold', 'only the matching item counts');
  assert.equal(parseVintedStatus('<html></html>', '123'), null);
});

test('offers missing from scans are checked once and their sale is dated', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const old = '2026-10-01T00:00:00.000Z';
    for (const [id, url] of [
      ['sold', 'https://www.vinted.pl/items/111-a'],
      ['gone', 'https://www.vinted.pl/items/222-b'],
      ['live', 'https://www.vinted.pl/items/333-c'],
      ['fresh', 'https://www.vinted.pl/items/444-d'],
    ])
      repository.upsertOffer({
        id,
        source: 'Vinted',
        normalizedUrl: url,
        originalTitle: id,
        currentPrice: 3000,
        lastSeenAt: id === 'fresh' ? new Date().toISOString() : old,
        firstSeenAt: old,
      });
    const now = () => new Date('2026-11-07T12:00:00.000Z');
    repository.database.prepare("UPDATE offers SET last_seen_at=? WHERE id<>'fresh'").run(old);
    repository.database
      .prepare("UPDATE offers SET last_seen_at=? WHERE id='fresh'")
      .run('2026-11-07T00:00:00.000Z');
    assert.deepEqual(
      pendingLifecycleChecks(repository, { now })
        .map((row) => row.id)
        .sort(),
      ['gone', 'live', 'sold'],
    );
    const report = await checkOfferLifecycle(repository, {
      now,
      fetchHtml: async (url) => {
        if (url.includes('222')) throw Object.assign(Error('SOURCE_HTTP_404'), { status: 404 });
        return url.includes('111') ? soldPage('111') : livePage('333');
      },
    });
    assert.equal(report.sold, 1);
    assert.equal(report.removed, 1);
    assert.equal(report.available, 1);
    const row = (id) =>
      repository.database
        .prepare(
          'SELECT availability, availability_changed_at, current_price FROM offers WHERE id=?',
        )
        .get(id);
    assert.equal(row('sold').availability, 'sold');
    assert.equal(row('sold').availability_changed_at, '2026-11-07T12:00:00.000Z');
    assert.equal(row('sold').current_price, 3000, 'last price kept');
    assert.equal(row('gone').availability, 'unavailable');
    assert.equal(row('live').availability, 'available');
    assert.equal(
      pendingLifecycleChecks(repository, { now }).length,
      0,
      'not rechecked within three days',
    );
  } finally {
    repository.close();
  }
});

test('a blocked source is left alone for the rest of the round', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    for (const id of ['1', '2'])
      repository.upsertOffer({
        id,
        source: 'Vinted',
        normalizedUrl: `https://www.vinted.pl/items/${id}-x`,
        originalTitle: id,
      });
    repository.database.prepare("UPDATE offers SET last_seen_at='2026-10-01T00:00:00.000Z'").run();
    let calls = 0;
    const report = await checkOfferLifecycle(repository, {
      now: () => new Date('2026-11-07T00:00:00.000Z'),
      fetchHtml: async () => {
        calls += 1;
        throw Object.assign(Error('SOURCE_CAPTCHA'), { blocked: true, status: 403 });
      },
    });
    assert.equal(calls, 1);
    assert.equal(report.stopped, 'SOURCE_CAPTCHA');
  } finally {
    repository.close();
  }
});

test('sources without a status parser do not consume the eight-check budget', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    for (const [id, source] of [
      ['v', 'Vinted'],
      ['e', 'Empik'],
      ['t', 'Tezeusz.pl'],
      ['a', 'Allegro Lokalnie'],
    ]) {
      repository.upsertOffer({
        id,
        source,
        normalizedUrl: `https://example.test/items/123-${id}`,
        originalTitle: id,
        currentPrice: source === 'Vinted' ? 1000 : 100000,
      });
    }
    repository.database.exec("UPDATE offers SET last_seen_at='2026-01-01',availability='not_seen'");
    const calls = [];
    const report = await checkOfferLifecycle(repository, {
      now: () => new Date('2026-11-11'),
      fetchHtml: async (url, source) => {
        calls.push(source);
        return livePage('123');
      },
    });
    assert.deepEqual(calls, ['Vinted']);
    assert.equal(report.available, 1);
    assert.equal(repository.database.prepare('SELECT count(*) n FROM offers').get().n, 4);
  } finally {
    repository.close();
  }
});

test('an unfamiliar status title and a malformed item id cannot declare removal or sale', () => {
  const page =
    '{"data":{"item_id":"123","title":"Sprawdź ponownie"},"exposures":[],"name":"buyer_item_status"}';
  assert.equal(parseVintedStatus(page, '123'), null);
  assert.equal(parseVintedStatus(soldPage('123'), '123D'), null);
});
