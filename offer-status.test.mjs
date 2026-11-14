import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProductionCatalog } from './catalog-production.mjs';
import { getCatalogOffer } from './catalog-api.mjs';
import { checkOfferLifecycle, pendingLifecycleChecks } from './offer-lifecycle.mjs';
import { detectRelists, saleWindow, undoRelist } from './offer-status.mjs';
import { persistSqliteScan } from './sqlite-single-store.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { recentReviewDecisions } from './api-routes.mjs';

const soldPage = (id) =>
  `self.__next_f.push([1,"91:[\\"$\\",\\"$L14b\\",null,{\\"plugins\\":[{\\"data\\":{\\"item_id\\":\\"${id}\\",\\"seller_id\\":\\"1\\",\\"theme\\":\\"SUCCESS\\",\\"title\\":\\"Sprzedane\\"},\\"exposures\\":[],\\"name\\":\\"buyer_item_status\\",\\"section\\":\\"sidebar\\"}]}]"])`;
const livePage = (id) =>
  `{"data":{"can_buy":true,"instant_buy":true,"is_hidden":false,"is_reserved":false,"item_id":"${id}","reservation":null,"seller_id":"1"},"exposures":[],"name":"ask_seller","section":"sidebar"}`;

function catalog() {
  const directory = mkdtempSync(join(tmpdir(), 'bookflip-status-'));
  const store = createProductionCatalog({
    databasePath: join(directory, 'catalog.sqlite'),
    fetcher: async () => assert.fail('no network'),
  });
  return {
    store,
    close: () => {
      store.repository.close();
      rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}
const vinted = (id, { title = 'Mort Terry Pratchett', price = 3000, seller = 'S1' } = {}) => ({
  source: 'Vinted',
  url: `https://www.vinted.pl/items/${id}-mort`,
  title,
  price,
  language: 'Polski',
  sellerId: seller,
  matchedQueries: ['pratchett'],
});
const complete = [
  { source: 'Vinted', query: 'pratchett', status: 'ok', pagination: { state: 'end' } },
];

test('a sale has an interval: after the last sighting or "still on sale" check, before the "sold" check', async () => {
  const { store, close } = catalog();
  try {
    const db = store.repository.database;
    // 150 zł: checked again a day after a check (a 30 zł one would wait four days).
    persistSqliteScan(store, {
      offers: [vinted(111, { price: 15000 })],
      searchedAt: '2026-11-01T10:00:00.000Z',
      scanContext: { results: complete },
    });
    // The next complete scan does not return it.
    persistSqliteScan(store, {
      offers: [],
      searchedAt: '2026-11-02T10:00:00.000Z',
      scanContext: { results: complete },
    });
    const id = db.prepare('SELECT id FROM offers').get().id;
    let clock = new Date('2026-11-03T12:00:00.000Z');
    const check = (page) =>
      checkOfferLifecycle(store.repository, {
        now: () => clock,
        fetchHtml: async () => page('111'),
      });
    await check(livePage);
    clock = new Date('2026-11-05T12:00:00.000Z');
    await check(soldPage);
    assert.deepEqual(
      db
        .prepare(
          'SELECT status, via, observed_at FROM offer_status_history WHERE offer_id=? ORDER BY observed_at',
        )
        .all(id)
        .map((row) => [row.status, row.via, row.observed_at]),
      [
        ['seen', 'scan', '2026-11-01T10:00:00.000Z'],
        ['not_seen', 'scan', '2026-11-02T10:00:00.000Z'],
        ['available', 'check', '2026-11-03T12:00:00.000Z'],
        ['sold', 'check', '2026-11-05T12:00:00.000Z'],
      ],
    );
    assert.deepEqual(saleWindow(db, id), {
      from: '2026-11-03T12:00:00.000Z',
      to: '2026-11-05T12:00:00.000Z',
    });
    assert.deepEqual(getCatalogOffer(store.repository, id).saleWindow, saleWindow(db, id));
  } finally {
    close();
  }
});

test('expensive listings are checked sooner after leaving the scans, and first', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const now = () => new Date('2026-11-10T12:00:00.000Z');
    const add = (id, price, lastSeen) =>
      repository.upsertOffer({
        id,
        source: 'Vinted',
        normalizedUrl: `https://www.vinted.pl/items/${id}0-x`,
        originalTitle: id,
        currentPrice: price,
        firstSeenAt: lastSeen,
        lastSeenAt: lastSeen,
      });
    add('drogi13h', 15000, '2026-11-09T23:00:00.000Z');
    add('sredni13h', 6000, '2026-11-09T23:00:00.000Z');
    add('sredni25h', 6000, '2026-11-09T11:00:00.000Z');
    add('tani25h', 2000, '2026-11-09T11:00:00.000Z');
    add('tani49h', 2000, '2026-11-08T11:00:00.000Z');
    assert.deepEqual(
      pendingLifecycleChecks(repository, { now }).map((row) => row.id),
      ['drogi13h', 'sredni25h', 'tani49h'],
    );
    // Checked a day ago: the expensive one is due again, the cheap one waits four days.
    repository.database
      .prepare("UPDATE offers SET availability_checked_at='2026-11-09T11:00:00.000Z'")
      .run();
    assert.deepEqual(
      pendingLifecycleChecks(repository, { now }).map((row) => row.id),
      ['drogi13h'],
    );
  } finally {
    repository.close();
  }
});

test('a listing put up again by the same seller is linked to the earlier one, visibly and reversibly', () => {
  const { store, close } = catalog();
  try {
    const db = store.repository.database;
    persistSqliteScan(store, {
      offers: [vinted(111), vinted(500, { title: 'Mort Terry Pratchett', seller: 'S2' })],
      searchedAt: '2026-11-01T10:00:00.000Z',
      scanContext: { results: complete },
    });
    // The seller took 111 down and listed the same book as 222; another seller's copy (500) stays.
    persistSqliteScan(store, {
      offers: [vinted(222), vinted(500, { seller: 'S2' }), vinted(333, { title: 'Straż! Straż!' })],
      searchedAt: '2026-11-03T10:00:00.000Z',
      scanContext: { results: complete },
    });
    const id = (n) =>
      db.prepare('SELECT id FROM offers WHERE normalized_url LIKE ?').get(`%/items/${n}-%`).id;
    const links = db
      .prepare('SELECT offer_id, previous_offer_id, reason, status, created_by FROM offer_relists')
      .all()
      .map((row) => ({ ...row }));
    assert.deepEqual(links, [
      {
        offer_id: id(222),
        previous_offer_id: id(111),
        reason: 'same_seller_title',
        status: 'active',
        created_by: 'relist_detection',
      },
    ]);
    // Nothing is rejected: the new listing goes through identification as usual.
    assert.equal(
      db.prepare('SELECT status FROM identification_jobs WHERE offer_id=?').get(id(222)).status,
      'queued',
    );
    assert.equal(getCatalogOffer(store.repository, id(222)).relists.previous[0].offerId, id(111));
    assert.equal(getCatalogOffer(store.repository, id(111)).relists.next[0].offerId, id(222));
    assert.ok(
      recentReviewDecisions(store.repository).some(
        (row) => row.action === 'relist_linked' && row.offerId === id(222),
      ),
    );

    undoRelist(store.repository, id(222));
    detectRelists(store.repository);
    assert.equal(
      db.prepare('SELECT status FROM offer_relists WHERE offer_id=?').get(id(222)).status,
      'undone',
      'not linked again',
    );
    assert.ok(
      recentReviewDecisions(store.repository).some((row) => row.action === 'relist_undone'),
    );
  } finally {
    close();
  }
});
