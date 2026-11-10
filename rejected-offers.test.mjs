import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionCatalog } from './catalog-production.mjs';
import { persistSqliteScan } from './sqlite-single-store.mjs';
import { decideIdentificationJob, listCatalogOffers, listIdentificationJobs } from './catalog-api.mjs';
import { rejectionTitleKey } from './rejected-offers.mjs';

const catalog = () => createProductionCatalog({ databasePath: ':memory:', fetcher: async () => { throw Error('NETWORK_NOT_ALLOWED'); } });
const context = { queries: ['Warcraft'], sources: ['Vinted', 'Empik'], results: [{ source: 'Vinted', query: 'Warcraft', status: 'ok' }] };
const scan = (c, offers, at) => persistSqliteScan(c, { offers, searchedAt: at, scanContext: context });
const toReview = (c) =>
  c.repository.database.prepare("UPDATE identification_jobs SET status='review_required', result_json='{\"decision\":\"review_required\",\"reason\":[\"no_isbn\"]}' WHERE status='queued'").run();
const jobOf = (c, url) =>
  c.repository.database.prepare('SELECT j.* FROM identification_jobs j JOIN offers o ON o.id=j.offer_id WHERE o.normalized_url=?').get(url);

test('a rejected offer stays rejected after the next scan, also when the price or ISBN changes', () => {
  const c = catalog();
  try {
    const item = { source: 'Vinted', url: 'https://www.vinted.pl/items/1-kubek', title: 'World of Warcraft kubek ceramiczny Horda', price: 2500 };
    scan(c, [item], '2026-11-01T00:00:00Z');
    toReview(c);
    decideIdentificationJob(c.repository, jobOf(c, item.url).id, { action: 'excluded' });
    scan(c, [{ ...item, price: 2000, isbn: '9788372988461' }], '2026-11-02T00:00:00Z');
    assert.equal(jobOf(c, item.url).status, 'completed');
    assert.equal(listIdentificationJobs(c.repository, { status: 'review_required' }).total, 0);
  } finally {
    c.close();
  }
});

test('a re-listed or duplicate copy of a rejected offer is rejected at once, naming the original', () => {
  const c = catalog();
  try {
    const first = { source: 'Vinted', url: 'https://www.vinted.pl/items/1-kubek', title: 'World of Warcraft kubek ceramiczny Horda', price: 2500 };
    const german = { source: 'Empik', url: 'https://www.empik.com/der-letzte-waechter,p1,ksiazka-p', title: 'World of Warcraft - Der letzte Wächter', price: 5000, isbn: '9788372988461' };
    scan(c, [first, german], '2026-11-01T00:00:00Z');
    toReview(c);
    for (const url of [first.url, german.url]) decideIdentificationJob(c.repository, jobOf(c, url).id, { action: 'excluded' });
    const relisted = { ...first, url: 'https://www.vinted.pl/items/2-kubek', title: 'World of Warcraft  KUBEK ceramiczny – Horda' };
    const sameIsbn = { source: 'Empik', url: 'https://www.empik.com/wow-waechter,p2,ksiazka-p', title: 'Der letzte Wächter (WoW)', price: 4900, isbn: '978-83-7298-846-1' };
    const other = { source: 'Vinted', url: 'https://www.vinted.pl/items/3-arthas', title: 'Arthas przebudzenie króla lisza', price: 3000 };
    scan(c, [relisted, sameIsbn, other], '2026-11-02T00:00:00Z');
    for (const url of [relisted.url, sameIsbn.url]) {
      const job = jobOf(c, url);
      assert.equal(job.status, 'completed', url);
      assert.equal(JSON.parse(job.result_json).manualDecision, 'excluded');
    }
    assert.equal(jobOf(c, other.url).status, 'queued');
    const decision = c.repository.database.prepare("SELECT * FROM review_decisions WHERE created_by='auto_same_as_rejected' ORDER BY reason").all();
    assert.equal(decision.length, 2);
    assert.match(decision[0].reason, /Jak wcześniej odrzucona oferta: World of Warcraft/);
    // Offers: rejected ones are out of the default list, shown on request.
    assert.equal(listCatalogOffers(c.repository, {}).total, 1);
    assert.equal(listCatalogOffers(c.repository, { status: 'rejected' }).total, 4);
    assert.equal(listCatalogOffers(c.repository, { status: 'all' }).total, 5);
    assert.equal(listCatalogOffers(c.repository, { status: 'all' }).items.filter((row) => row.rejected).length, 4);
  } finally {
    c.close();
  }
});

test('short titles name a kind of offer, not one product: no automatic rejection by them', () => {
  assert.equal(rejectionTitleKey('Warcraft'), null);
  assert.equal(rejectionTitleKey('Fourth Wing'), null);
  assert.equal(rejectionTitleKey('World of Warcraft - Der letzte Wächter'), 'world of warcraft der letzte wachter');
  // Cyrillic stays in the key; a universe name alone is not a product.
  assert.equal(rejectionTitleKey('World of Warcraft. Клятва на крови'), 'world of warcraft клятва на крови');
  assert.equal(rejectionTitleKey('World of Warcraft Warhammer'), null);
});

test('automatic rejections the corrected rule no longer confirms go back to identification', async () => {
  const { undoUnconfirmedRepeatRejections } = await import('./rejected-offers.mjs');
  const c = catalog();
  try {
    const db = c.repository.database;
    const russian = { source: 'Empik', url: 'https://www.empik.com/klatwa,p1,ksiazka-p', title: 'World of Warcraft. Клятва на крови', price: 5000 };
    const mag = { source: 'Empik', url: 'https://www.empik.com/mag,p2,ksiazka-p', title: 'World of Warcraft. Маг', price: 5000 };
    const copy = { source: 'Empik', url: 'https://www.empik.com/klatwa-2,p3,ksiazka-p', title: 'World of Warcraft. Клятва на крови', price: 4500 };
    scan(c, [russian, mag, copy], '2026-11-01T00:00:00Z');
    toReview(c);
    decideIdentificationJob(c.repository, jobOf(c, russian.url).id, { action: 'excluded' });
    // As the first version of the rule did: both closed as repeats of the Russian edition.
    for (const offer of [mag, copy])
      db.prepare("UPDATE identification_jobs SET status='completed', result_json=? WHERE id=?").run(
        JSON.stringify({ manualDecision: 'excluded', automatic: true, sameAs: jobOf(c, russian.url).offer_id }),
        jobOf(c, offer.url).id,
      );
    assert.deepEqual(undoUnconfirmedRepeatRejections(c.repository), { reopened: 1 });
    assert.equal(jobOf(c, mag.url).status, 'queued');
    assert.equal(jobOf(c, copy.url).status, 'completed');
    assert.deepEqual(undoUnconfirmedRepeatRejections(c.repository), { reopened: 0 });
  } finally {
    c.close();
  }
});
