import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProductionCatalog } from './catalog-production.mjs';
import { searchOffers } from './local-app.mjs';
import { parseMarketplace } from './marketplaces.mjs';
import { conditionClass, listedAtFromAge, rawSnapshot } from './offer-observations.mjs';
import { createScanState, persistSqliteScan, persistSqliteScanBatch } from './sqlite-single-store.mjs';
import { parseVintedDetail } from './vinted-detail.mjs';
import { pendingSetDescriptions } from './set-descriptions.mjs';
import { markOfferAsSet } from './offer-sets.mjs';

const fixture = (path) => readFileSync(new URL('./fixtures/' + path, import.meta.url), 'utf8');
const searchPage = JSON.parse(fixture('marketplaces/vinted-search-captured.json')).html;
const detailPage = fixture('details/vinted-item-captured.html');
const empikPage = JSON.parse(fixture('marketplaces/empik-tiles-captured.json')).html;

function catalog() {
  const directory = mkdtempSync(join(tmpdir(), 'bookflip-observations-'));
  const store = createProductionCatalog({ databasePath: join(directory, 'catalog.sqlite'), fetcher: async () => assert.fail('no network') });
  return { store, close: () => { store.repository.close(); rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); } };
}

test('condition texts of the sources fall into five classes', () => {
  assert.equal(conditionClass('Nowy z metką'), 'new');
  assert.equal(conditionClass('Nowy bez metki'), 'new');
  assert.equal(conditionClass('Bardzo dobry'), 'very_good');
  assert.equal(conditionClass('jak nowa'), 'very_good');
  assert.equal(conditionClass('Dobry'), 'good');
  assert.equal(conditionClass('Ze śladami użytkowania'), 'good');
  assert.equal(conditionClass('Zadowalający'), 'satisfactory');
  assert.equal(conditionClass('dostateczny'), 'satisfactory');
  assert.equal(conditionClass('Używany'), 'unknown');
  assert.equal(conditionClass(null), 'unknown');
});

test('a Vinted age becomes an approximate listing date', () => {
  const now = new Date('2026-11-10T12:00:00.000Z');
  assert.equal(listedAtFromAge('3 godz.', now), '2026-11-10T09:00:00.000Z');
  assert.equal(listedAtFromAge('2 dni', now), '2026-11-08T12:00:00.000Z');
  assert.equal(listedAtFromAge('1 tydz.', now), '2026-11-03T12:00:00.000Z');
  assert.equal(listedAtFromAge('przed chwilą', now), '2026-11-10T12:00:00.000Z');
  assert.equal(listedAtFromAge('wczoraj o 12', now), null);
});

test('likes do not make a new raw snapshot; a price does', () => {
  const card = { id: 1, title: 'Mort', price: { amount: '20' }, favouriteCount: 1, thumbnails: ['x'] };
  assert.equal(rawSnapshot(card).digest, rawSnapshot({ ...card, favouriteCount: 7 }).digest);
  assert.notEqual(rawSnapshot(card).digest, rawSnapshot({ ...card, price: { amount: '25' } }).digest);
  assert.ok(!rawSnapshot(card).payload.includes('thumbnails'));
});

test('Empik tiles carry the real availability and the seller', () => {
  const task = { source: 'Empik', host: 'www.empik.com', mode: 'discovery', title: 'pratchett', searchQuery: 'pratchett', category: 'pratchett' };
  const rows = parseMarketplace(empikPage, task, '2026-11-10T10:00:00.000Z');
  assert.deepEqual(rows.map((row) => [row.sellerId, row.sourceAvailability]), [['0', 'PRE_SALE'], ['18517', 'IN_24_H'], ['3720', 'IN_24_H']]);
  assert.equal(rows[1].sellerName, 'Antykwariat i Księgarnia Tezeusz');
  // A tile Empik marks as not available is not an offer any more.
  const gone = empikPage.replace('data-availabilityType="IN_24_H"', 'data-availabilityType="UNAVAILABLE"');
  assert.equal(parseMarketplace(gone, task, '2026-11-10T10:00:00.000Z').length, 2);
});

test('a scanned Vinted listing is saved with condition, fee, seller, description, photos and raw objects', async () => {
  const { store, close } = catalog();
  try {
    const db = store.repository.database;
    const scanAt = '2026-11-10T12:00:00.000Z';
    const state = createScanState();
    const reads = [];
    const result = await searchOffers(
      { queries: ['pratchett'], sources: ['Vinted'] },
      {
        scanner: async (task) => {
          const rejected = {};
          const offers = parseMarketplace(searchPage, task, scanAt, 5001, rejected);
          return { offers, rejected, pagination: { state: 'end', nextPage: null } };
        },
        // The listing page is read once per new listing, for the language; nothing else is read.
        languageReader: async (url) => {
          reads.push(url);
          if (url.includes('9000000002')) return parseVintedDetail(detailPage, url);
          if (url.includes('9000000001')) return { language: 'Angielski' };
          return { language: null };
        },
        retryWait: async () => {},
        now: () => new Date(scanAt),
        onOffers: async ({ offers }) => persistSqliteScanBatch(store, { offers, scanAt, state }),
      },
    );
    assert.equal(reads.length, 3);
    assert.deepEqual(result.summary.rejected, { language: 1, language_unknown: 1 });
    persistSqliteScan(store, {
      offers: result.offers, searchedAt: scanAt, scanState: state, rejected: result.summary.rejected,
      scanContext: { queries: ['pratchett'], sources: ['Vinted'], results: result.results },
    });

    const row = db.prepare("SELECT * FROM offers WHERE normalized_url LIKE '%/items/9000000002-%'").get();
    assert.equal(row.condition_text, 'Bardzo dobry');
    assert.equal(row.condition_class, 'very_good');
    assert.equal(row.buyer_fee, 445);
    assert.equal(row.seller_id, '1000002');
    assert.equal(row.seller_business, 0);
    assert.equal(row.photo_count, 3);
    assert.equal(row.favourite_count, 1);
    assert.equal(row.listed_at_text, '3 godz.');
    assert.ok(Math.abs(Date.parse(row.listed_at) - Date.parse('2026-11-10T09:00:00.000Z')) < 60_000);
    assert.equal(row.shipping_cost, null, 'Vinted pages do not carry the shipping price');
    assert.equal(row.view_count, null, 'nor the number of views');
    // Only the listing in Polish was saved.
    assert.equal(db.prepare('SELECT count(*) AS n FROM offers').get().n, 1);

    const description = db.prepare('SELECT text, status FROM offer_descriptions WHERE offer_id=?').get(row.id);
    assert.equal(description.status, 'found');
    assert.match(description.text, /Wydanie kieszonkowe/);
    // Marked as a set later: its description is already there, the page is not read again.
    markOfferAsSet(store.repository, row.id);
    assert.equal(pendingSetDescriptions(store.repository).length, 0);

    const kinds = db.prepare('SELECT kind FROM offer_raw_snapshots WHERE offer_id=? ORDER BY kind').all(row.id).map((r) => r.kind);
    assert.deepEqual(kinds, ['detail', 'listing']);
    const listing = JSON.parse(db.prepare("SELECT payload FROM offer_raw_snapshots WHERE offer_id=? AND kind='listing'").get(row.id).payload);
    assert.equal(listing.itemBox.secondLine, 'Bardzo dobry');

    const summary = JSON.parse(db.prepare('SELECT summary_json FROM scan_runs WHERE scanned_at=?').get(scanAt).summary_json);
    assert.deepEqual(summary.rejected, { language: 1, language_unknown: 1 });

    // Seen again with more likes: the stored count follows, but no new raw snapshot is written.
    const again = parseMarketplace(searchPage.replace('\\"favouriteCount\\":1', '\\"favouriteCount\\":5'), {
      source: 'Vinted', host: 'www.vinted.pl', mode: 'discovery', title: 'pratchett', searchQuery: 'pratchett', category: 'pratchett',
    }, '2026-11-11T12:00:00.000Z').filter((offer) => offer.url.includes('9000000002'));
    store.ingestOffers(again.map((offer) => ({ ...offer, source: 'Vinted', language: 'Polski' })), '2026-11-11T12:00:00.000Z');
    const later = db.prepare('SELECT favourite_count, condition_text, listed_at_text FROM offers WHERE id=?').get(row.id);
    assert.equal(later.favourite_count, 5);
    assert.equal(later.condition_text, 'Bardzo dobry');
    assert.equal(later.listed_at_text, '3 godz.', 'the first, closest age is kept');
    assert.equal(db.prepare('SELECT count(*) AS n FROM offer_raw_snapshots WHERE offer_id=?').get(row.id).n, 2);
  } finally {
    close();
  }
});

test('conditions read earlier from listing pages are copied once at start-up', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bookflip-observations-'));
  const path = join(directory, 'catalog.sqlite');
  try {
    let store = createProductionCatalog({ databasePath: path, fetcher: async () => assert.fail('no network') });
    const offer = store.repository.upsertOffer({ source: 'Allegro Lokalnie', normalizedUrl: 'https://allegrolokalnie.pl/oferta/mort', originalTitle: 'Mort', currentPrice: 2000, at: '2026-11-01T10:00:00Z' });
    store.repository.database
      .prepare("INSERT INTO offer_enrichment(offer_id,source,outcome,attempts,attempted_at,facts_json) VALUES(?,?,?,1,?,?)")
      .run(offer.id, 'Allegro Lokalnie', 'no_isbn', '2026-11-01T10:00:00Z', JSON.stringify({ condition: 'Bardzo dobry' }));
    store.repository.database.prepare("DELETE FROM app_preferences WHERE key='offer_condition_backfill_v1'").run();
    store.repository.close();
    store = createProductionCatalog({ databasePath: path, fetcher: async () => assert.fail('no network') });
    const row = store.repository.database.prepare('SELECT condition_text, condition_class FROM offers WHERE id=?').get(offer.id);
    assert.deepEqual({ ...row }, { condition_text: 'Bardzo dobry', condition_class: 'very_good' });
    store.repository.close();
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
