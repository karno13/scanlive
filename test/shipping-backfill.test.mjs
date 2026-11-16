import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  fillShippingCosts,
  pendingShippingChecks,
  repairPromotionalShippingCosts,
} from '../shipping-backfill.mjs';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';

const detailPage = readFileSync(
  new URL('../fixtures/details/vinted-item-captured.html', import.meta.url),
  'utf8',
);
const URL_FREE = 'https://www.vinted.pl/items/9000000002-faust-erik-terry-pratchett';

test('saved Vinted offers get their delivery price from the listing page, once', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const at = '2026-11-10T00:00:00.000Z';
    for (const [id, url, price] of [
      ['free', URL_FREE, 4000],
      ['plain', 'https://www.vinted.pl/items/9000000003-x', 3000],
      ['gone', 'https://www.vinted.pl/items/9000000004-y', 2000],
      ['sold', 'https://www.vinted.pl/items/9000000005-z', 1000],
      ['known', 'https://www.vinted.pl/items/9000000006-w', 500],
    ])
      repository.upsertOffer({
        id,
        source: 'Vinted',
        normalizedUrl: url,
        originalTitle: id,
        currentPrice: price,
        lastSeenAt: at,
        firstSeenAt: at,
      });
    const db = repository.database;
    db.prepare("UPDATE offers SET availability='sold' WHERE id='sold'").run();
    db.prepare("UPDATE offers SET shipping_cost=999 WHERE id='known'").run();
    assert.deepEqual(
      pendingShippingChecks(repository).map((row) => row.id),
      ['free', 'plain', 'gone'],
      'only listings for sale without a price, the most expensive first',
    );

    const reads = [];
    const report = await fillShippingCosts(repository, {
      now: () => new Date('2026-11-15T12:00:00.000Z'),
      fetchHtml: async (url) => {
        reads.push(url);
        if (url.includes('9000000004')) throw Object.assign(Error('HTTP_404'), { status: 404 });
        return url === URL_FREE ? detailPage : '<html></html>';
      },
    });
    assert.deepEqual(report, {
      checked: 2,
      found: 1,
      free: 0,
      missing: 1,
      removed: 1,
      paused: false,
    });
    const cost = (id) => db.prepare('SELECT shipping_cost FROM offers WHERE id=?').get(id);
    // The signed-out promotion (7.05 zł -> 0 zł) is not free delivery: the regular price is saved.
    assert.equal(cost('free').shipping_cost, 705);
    assert.equal(cost('plain').shipping_cost, null);
    assert.equal(cost('known').shipping_cost, 999);
    // Every page was tried once; nothing is read again.
    assert.equal(pendingShippingChecks(repository).length, 0);
    assert.equal(reads.length, 3);
  } finally {
    repository.close?.();
  }
});

test('a refused page stops the round and nothing is marked as checked', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const at = '2026-11-10T00:00:00.000Z';
    repository.upsertOffer({
      id: 'a',
      source: 'Vinted',
      normalizedUrl: URL_FREE,
      originalTitle: 'a',
      currentPrice: 4000,
      lastSeenAt: at,
      firstSeenAt: at,
    });
    const report = await fillShippingCosts(repository, {
      fetchHtml: async () => {
        throw Object.assign(Error('SOURCE_BLOCKED'), { blocked: true });
      },
    });
    assert.equal(report.paused, true);
    assert.equal(pendingShippingChecks(repository).length, 1);
  } finally {
    repository.close?.();
  }
});

test('promotional 0 zł delivery prices are corrected once and foreign offers are identified again', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const at = '2026-11-10T00:00:00.000Z';
    const db = repository.database;
    db.prepare('INSERT INTO works(id,title,created_at,updated_at) VALUES(?,?,?,?)').run(
      'w',
      'Good Omens',
      at,
      at,
    );
    db.prepare(
      'INSERT INTO editions(id,work_id,title,created_at,updated_at) VALUES(?,?,?,?,?)',
    ).run('e', 'w', 'Good Omens', at, at);
    const offer = (id, { language = 'Polski', cost = 0, method = 'structured_isbn' } = {}) => {
      repository.upsertOffer({
        id,
        source: 'Vinted',
        normalizedUrl: 'https://www.vinted.pl/items/' + id,
        originalTitle: id,
        currentPrice: 2000,
        lastSeenAt: at,
        firstSeenAt: at,
      });
      db.prepare(
        'UPDATE offers SET language=?, shipping_cost=?, shipping_checked_at=? WHERE id=?',
      ).run(language, cost, at, id);
      db.prepare(
        "INSERT INTO offer_matches(id,offer_id,edition_id,method,status,created_by,valid_from,created_at) VALUES(?,?,?,?,'active','system',?,?)",
      ).run('m-' + id, id, 'e', method, at, at);
      db.prepare(
        "INSERT INTO identification_jobs(id,offer_id,status,result_json,created_at,updated_at) VALUES(?,?,'completed','{}',?,?)",
      ).run('j-' + id, id, at, at);
    };
    const snapshot = (id, shipping) =>
      db
        .prepare(
          "INSERT INTO offer_raw_snapshots(offer_id,kind,digest,payload,observed_at) VALUES(?,'detail','d',?,?)",
        )
        .run(id, JSON.stringify({ shipping }), at);
    offer('1');
    snapshot('1', { cost: 0, original: 885 });
    offer('2');
    offer('3', { language: 'Angielski' });
    snapshot('3', { cost: 0, original: 705 });
    offer('4', { language: 'Angielski', method: 'manual' });
    offer('5', { cost: 999 });

    const report = repairPromotionalShippingCosts(repository, {
      now: () => new Date('2026-11-16T12:00:00.000Z'),
    });
    assert.deepEqual(report, { corrected: 2, requeued: 2, foreign: 1 });
    const row = (id) =>
      db
        .prepare(
          `SELECT o.shipping_cost AS cost, o.shipping_checked_at AS checked,
             (SELECT status FROM offer_matches WHERE offer_id=o.id) AS match,
             (SELECT status FROM identification_jobs WHERE offer_id=o.id) AS job
           FROM offers o WHERE o.id=?`,
        )
        .get(id);
    // The regular price kept in the page snapshot replaces the 0.
    assert.deepEqual(
      { ...row('1') },
      { cost: 885, checked: at, match: 'active', job: 'completed' },
    );
    // No snapshot: unknown again, the page is read once more.
    assert.deepEqual(
      { ...row('2') },
      { cost: null, checked: null, match: 'active', job: 'completed' },
    );
    assert.deepEqual(
      pendingShippingChecks(repository).map((entry) => entry.id),
      ['2', '4'],
    );
    // A foreign edition let in by the false free delivery is identified again.
    assert.deepEqual(
      { ...row('3') },
      { cost: 705, checked: at, match: 'superseded', job: 'queued' },
    );
    // A manual assignment stays.
    assert.equal(row('4').match, 'active');
    assert.equal(row('4').job, 'completed');
    assert.equal(row('5').cost, 999);
  } finally {
    repository.close?.();
  }
});
