import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionCatalog } from '../catalog-production.mjs';
import { persistSqliteScan } from '../sqlite-single-store.mjs';
import { listCatalogWorks } from '../catalog-api.mjs';
import { recentReviewDecisions, reopenReviewDecision } from '../api-routes.mjs';
import {
  listRemovedWorks,
  rejectOffersOfRemovedWorks,
  removeCatalogWork,
  restoreCatalogWork,
} from '../catalog-removal.mjs';

const ISBN = '9788372988461';
const catalog = () =>
  createProductionCatalog({
    databasePath: ':memory:',
    fetcher: async () => {
      throw Error('NETWORK_NOT_ALLOWED');
    },
  });
const scan = (c, offers, at) =>
  persistSqliteScan(c, {
    offers,
    searchedAt: at,
    scanContext: { queries: ['x'], sources: ['Vinted'], results: [] },
  });
const offer = (n, extra = {}) => ({
  source: 'Vinted',
  url: `https://www.vinted.pl/items/${n}-poradnik`,
  title: `Poradnik ogrodnika ${n}`,
  price: 1500,
  ...extra,
});
const jobOf = (c, n) =>
  c.repository.database
    .prepare(
      'SELECT j.* FROM identification_jobs j JOIN offers o ON o.id=j.offer_id WHERE o.normalized_url=?',
    )
    .get(offer(n).url);
const activeMatch = (c, n) =>
  c.repository.database
    .prepare(
      "SELECT m.* FROM offer_matches m JOIN offers o ON o.id=m.offer_id WHERE o.normalized_url=? AND m.status='active'",
    )
    .get(offer(n).url);
/** The offer identified by its ISBN, as the resolver leaves it. */
function identify(c, n, editionId) {
  const job = jobOf(c, n);
  c.repository.assignOfferToEdition(job.offer_id, editionId, { method: 'structured_isbn' });
  c.repository.database
    .prepare(
      `UPDATE identification_jobs SET status='completed', result_json='{"decision":"matched"}' WHERE id=?`,
    )
    .run(job.id);
}
const workIds = (c) => listCatalogWorks(c.repository, { limit: 100 }).items.map((w) => w.id);

test('removing a work hides it, rejects its offers and the ones that come later; restoring undoes it all', () => {
  const c = catalog();
  try {
    const repo = c.repository;
    scan(c, [offer(1, { isbn: ISBN }), offer(2)], '2026-11-01T00:00:00Z');
    const work = repo.createWork({ title: 'Poradnik ogrodnika', authors: ['Jan Kowalski'] });
    const edition = repo.createEditionForISBN({ workId: work.id, isbn: ISBN, title: 'Poradnik' });
    identify(c, 1, edition.id);
    identify(c, 2, edition.id);
    assert.ok(workIds(c).includes(work.id));

    // Preview first: nothing changes.
    assert.deepEqual(removeCatalogWork(repo, work.id), {
      workId: work.id,
      title: 'Poradnik ogrodnika',
      editions: 1,
      offers: 2,
    });
    assert.ok(workIds(c).includes(work.id));

    const removed = removeCatalogWork(repo, work.id, { confirm: true });
    assert.equal(removed.removed, true);
    assert.ok(!workIds(c).includes(work.id));
    // The numbers above the list do not count it either.
    assert.deepEqual([repo.counts().works, repo.counts().editions], [0, 0]);
    for (const n of [1, 2]) {
      assert.equal(activeMatch(c, n), undefined);
      assert.equal(JSON.parse(jobOf(c, n).result_json).manualDecision, 'excluded');
    }
    assert.equal(
      recentReviewDecisions(repo).filter((d) => d.reason?.startsWith('Usunięte z katalogu')).length,
      2,
    );
    assert.throws(
      () => removeCatalogWork(repo, work.id, { confirm: true }),
      /WORK_ALREADY_REMOVED/,
    );

    // Later scans: one copy carries the ISBN, another one the resolver matched to the edition.
    scan(c, [offer(3, { isbn: '83-7298-846-3' }), offer(4)], '2026-11-02T00:00:00Z');
    identify(c, 4, edition.id);
    assert.equal(rejectOffersOfRemovedWorks(repo).rejected, 2);
    assert.equal(jobOf(c, 3).status, 'completed');
    assert.equal(activeMatch(c, 4), undefined);
    assert.equal(listRemovedWorks(repo)[0].rejectedOffers, 4);

    // The operator reopens one of them in "Ostatnie decyzje": the block does not repeat it.
    const decision = recentReviewDecisions(repo).find((d) => d.offerId === jobOf(c, 3).offer_id);
    reopenReviewDecision(repo, decision.id);
    assert.equal(rejectOffersOfRemovedWorks(repo).rejected, 0);
    assert.equal(jobOf(c, 3).status, 'review_required');

    const restored = restoreCatalogWork(repo, work.id);
    assert.equal(restored.offers, 3);
    assert.ok(workIds(c).includes(work.id));
    assert.deepEqual(listRemovedWorks(repo), []);
    // Assigned offers get their edition and their finished job back.
    for (const n of [1, 2, 4]) {
      assert.equal(activeMatch(c, n)?.edition_id, edition.id, `offer ${n}`);
      assert.equal(jobOf(c, n).status, 'completed');
    }
    assert.equal(rejectOffersOfRemovedWorks(repo).rejected, 0);
  } finally {
    c.close();
  }
});

test('a manual assignment made after the removal wins over the block', () => {
  const c = catalog();
  try {
    const repo = c.repository;
    scan(c, [offer(1)], '2026-11-01T00:00:00Z');
    const work = repo.createWork({ title: 'Poradnik ogrodnika' });
    const edition = repo.createEditionForISBN({ workId: work.id, isbn: ISBN, title: 'Poradnik' });
    removeCatalogWork(repo, work.id, { confirm: true });
    repo.assignOfferToEdition(jobOf(c, 1).offer_id, edition.id, { method: 'manual' });
    assert.equal(rejectOffersOfRemovedWorks(repo).rejected, 0);
    assert.equal(activeMatch(c, 1)?.method, 'manual');
    assert.throws(() => restoreCatalogWork(repo, 'missing'), /WORK_NOT_REMOVED/);
  } finally {
    c.close();
  }
});
