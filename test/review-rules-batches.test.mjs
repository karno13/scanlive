// Stage 2 of the 11.2026 review: batch approval with whole-batch undo, rejection rules, dismissed
// sets and the counts of the "Kolejka" tabs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionCatalog } from '../catalog-production.mjs';
import {
  addBatchPlan,
  applyAddBatch,
  applyQuickBatch,
  quickBatchPlan,
  recentBatches,
  undoBatch,
} from '../review-batches.mjs';
import {
  applyRejectionRules,
  createRejectionRule,
  deleteRejectionRule,
  foldPhrase,
  listRejectionRules,
  ruleMatches,
} from '../rejection-rules.mjs';
import { decideIdentificationJob } from '../review-queue.mjs';
import { dismissOfferSet, listOfferSets, markOfferAsSet } from '../offer-sets.mjs';
import { queueSummary, reopenReviewDecision } from '../api-routes.mjs';

const offline = async () => {
  throw new Error('NETWORK_NOT_EXPECTED');
};
const at = new Date('2026-11-11T10:00:00Z');
const catalogue = () =>
  createProductionCatalog({ databasePath: ':memory:', fetcher: offline, now: () => at });

function waiting(repo, url) {
  const offer = repo.database.prepare('SELECT id FROM offers WHERE normalized_url=?').get(url);
  repo.database
    .prepare(
      "UPDATE identification_jobs SET status='review_required', result_json=? WHERE offer_id=?",
    )
    .run(JSON.stringify({ decision: 'review_required', reason: ['no_isbn_evidence'] }), offer.id);
  return {
    offerId: offer.id,
    jobId: repo.database
      .prepare('SELECT id FROM identification_jobs WHERE offer_id=?')
      .get(offer.id).id,
  };
}
const status = (repo, jobId) =>
  repo.database.prepare('SELECT status FROM identification_jobs WHERE id=?').get(jobId).status;

test('a "Szybkie" batch: one decision per offer, grouped, undone as a whole', async () => {
  const catalog = catalogue();
  const repo = catalog.repository;
  try {
    for (const [id, title] of [
      ['illidan', 'Illidan'],
      ['thrall', 'Zew Wodza'],
    ]) {
      repo.createWork({
        id: 'w-' + id,
        title,
        authors: ['Golden, Christie'],
        verificationStatus: 'verified',
      });
      repo.createEdition({
        id: 'e-' + id,
        workId: 'w-' + id,
        title,
        verificationStatus: 'verified',
      });
    }
    catalog.ingestOffers(
      [
        { source: 'Vinted', url: 'https://www.vinted.pl/items/1-a', title: 'Illidan', price: 2000 },
        {
          source: 'Vinted',
          url: 'https://www.vinted.pl/items/2-b',
          title: 'Zew Wodza',
          price: 2500,
        },
      ],
      at,
    );
    const a = waiting(repo, 'https://www.vinted.pl/items/1-a');
    const b = waiting(repo, 'https://www.vinted.pl/items/2-b');
    const plan = quickBatchPlan(repo);
    assert.deepEqual(plan.items.map((item) => item.jobId).sort(), [a.jobId, b.jobId].sort());
    assert.ok(plan.items.every((item) => item.offerId && 'offerImage' in item));
    const result = await applyQuickBatch(catalog, plan.items);
    assert.equal(result.approved, 2);
    assert.ok(result.batchId);
    const rows = repo.database
      .prepare(
        'SELECT d.offer_id, d.action FROM review_decisions d JOIN review_batch_decisions l ON l.decision_id=d.id WHERE l.batch_id=?',
      )
      .all(result.batchId);
    assert.equal(rows.length, 2, 'each offer has its own decision row');
    assert.ok(rows.every((row) => row.action === 'approved'));
    assert.deepEqual(
      recentBatches(repo).map((batch) => [batch.kind, batch.decisions, batch.open]),
      [['quick', 2, 2]],
    );
    const undo = undoBatch(repo, result.batchId);
    assert.deepEqual(undo, { reopened: 2, failed: [] });
    assert.equal(status(repo, a.jobId), 'review_required');
    assert.equal(status(repo, b.jobId), 'review_required');
    assert.deepEqual(recentBatches(repo)[0].open, 0);
    assert.deepEqual(undoBatch(repo, result.batchId), { reopened: 0, failed: [] });
    assert.throws(() => undoBatch(repo, 'nope'), /BATCH_NOT_FOUND/);
  } finally {
    catalog.close();
  }
});

test('rules match by seller, by a phrase (any case and diacritics) and by a price threshold', () => {
  const offer = {
    source: 'Vinted',
    seller_id: '42',
    original_title: 'ŁADNY Zestaw kart: Magic',
    current_price: 30_000,
    currency: 'PLN',
  };
  assert.equal(foldPhrase('  Zestaw KART! '), 'zestaw kart');
  assert.ok(ruleMatches({ kind: 'seller', source: 'Vinted', value: '42' }, offer));
  assert.ok(!ruleMatches({ kind: 'seller', source: 'OLX', value: '42' }, offer));
  assert.ok(ruleMatches({ kind: 'phrase', value: 'zestaw kart' }, offer));
  assert.ok(ruleMatches({ kind: 'phrase', value: 'ladny' }, offer));
  assert.ok(!ruleMatches({ kind: 'phrase', value: 'kar' }, offer), 'whole words only');
  assert.ok(ruleMatches({ kind: 'price_above', value: '29999' }, offer));
  assert.ok(!ruleMatches({ kind: 'price_below', value: '29999' }, offer));
  assert.ok(!ruleMatches({ kind: 'price_above', value: '1' }, { ...offer, currency: 'EUR' }));
});

test('a rule rejects matching queue offers as its own visible decision; manual work and sets win', () => {
  const catalog = catalogue();
  const repo = catalog.repository;
  try {
    repo.createWork({ id: 'w-1', title: 'Coś', authors: [], verificationStatus: 'verified' });
    repo.createEdition({ id: 'e-1', workId: 'w-1', title: 'Coś', verificationStatus: 'verified' });
    const urls = ['1-first', '2-same-seller', '3-manual', '4-set', '5-other'].map(
      (slug) => 'https://www.vinted.pl/items/' + slug,
    );
    catalog.ingestOffers(
      urls.map((url, index) => ({
        source: 'Vinted',
        url,
        title: 'Karty kolekcjonerskie ' + index,
        price: 1000,
      })),
      at,
    );
    const jobs = urls.map((url) => waiting(repo, url));
    for (const job of jobs.slice(0, 4))
      repo.database
        .prepare("UPDATE offers SET seller_id='77', seller_name='karciarz' WHERE id=?")
        .run(job.offerId);
    repo.assignOfferToEdition(jobs[2].offerId, 'e-1', {
      id: 'm-1',
      method: 'manual',
      status: 'active',
      reason: 'test',
      createdBy: 'local_user',
      at: at.toISOString(),
    });
    markOfferAsSet(repo, jobs[3].offerId);
    // Made while rejecting the first offer: the seller rule.
    decideIdentificationJob(repo, jobs[0].jobId, {
      action: 'excluded',
      reason: 'Odrzucono podczas weryfikacji.',
    });
    const rule = createRejectionRule(repo, { kind: 'seller', offerId: jobs[0].offerId });
    assert.equal(rule.created, true);
    assert.equal(
      createRejectionRule(repo, { kind: 'seller', offerId: jobs[1].offerId }).created,
      false,
      'one rule per seller',
    );
    const applied = applyRejectionRules(repo);
    assert.equal(
      applied.rejected,
      1,
      'the second offer of the seller; the manual one and the set are left',
    );
    assert.equal(status(repo, jobs[1].jobId), 'completed');
    assert.equal(status(repo, jobs[4].jobId), 'review_required');
    const decision = repo.database
      .prepare('SELECT * FROM review_decisions WHERE job_id=?')
      .get(jobs[1].jobId);
    assert.equal(decision.created_by, 'rejection_rule:' + rule.id);
    assert.equal(decision.action, 'excluded');
    assert.match(decision.reason, /sprzedawca karciarz \(Vinted\)/);
    assert.equal(listRejectionRules(repo)[0].hits, 1);
    // Undone in "Ostatnie decyzje": the rule never takes this offer again.
    reopenReviewDecision(repo, decision.id);
    assert.equal(applyRejectionRules(repo).rejected, 0);
    assert.equal(status(repo, jobs[1].jobId), 'review_required');
    // Phrase and price rules; validation.
    assert.throws(
      () => createRejectionRule(repo, { kind: 'phrase', value: 'ab' }),
      /PHRASE_TOO_SHORT/,
    );
    assert.throws(
      () => createRejectionRule(repo, { kind: 'price_above', value: 'dużo' }),
      /INVALID_PRICE/,
    );
    assert.throws(
      () => createRejectionRule(repo, { kind: 'seller', offerId: jobs[4].offerId }),
      /SELLER_UNKNOWN/,
    );
    const phrase = createRejectionRule(repo, { kind: 'phrase', value: 'Kolekcjonerskie 4' });
    assert.equal(applyRejectionRules(repo, { ruleIds: [phrase.id] }).rejected, 1);
    assert.equal(status(repo, jobs[4].jobId), 'completed');
    deleteRejectionRule(repo, phrase.id);
    assert.equal(listRejectionRules(repo).length, 1);
    assert.throws(() => deleteRejectionRule(repo, phrase.id), /RULE_NOT_FOUND/);
  } finally {
    catalog.close();
  }
});

test('"Nie interesuje mnie" hides a set from the queue and can be undone; queue counts', () => {
  const catalog = catalogue();
  const repo = catalog.repository;
  try {
    catalog.ingestOffers(
      ['a', 'b'].map((slug) => ({
        source: 'Vinted',
        url: 'https://www.vinted.pl/items/' + (slug === 'a' ? '91' : '92') + '-' + slug,
        title: 'Zestaw ' + slug,
        price: 5000,
      })),
      at,
    );
    const ids = repo.database
      .prepare('SELECT id FROM offers ORDER BY normalized_url')
      .all()
      .map((row) => row.id);
    for (const id of ids) markOfferAsSet(repo, id);
    assert.deepEqual([queueSummary(repo).sets, queueSummary(repo).setsEmpty], [2, 2]);
    dismissOfferSet(repo, ids[0]);
    assert.equal(queueSummary(repo).sets, 1);
    assert.ok(listOfferSets(repo).find((set) => set.offerId === ids[0]).dismissedAt);
    dismissOfferSet(repo, ids[0], false);
    assert.equal(queueSummary(repo).sets, 2);
    assert.throws(() => dismissOfferSet(repo, 'missing'), /SET_NOT_FOUND/);
    assert.deepEqual(Object.keys(queueSummary(repo)), [
      'review',
      'sets',
      'setsEmpty',
      'conflicts',
      'duplicates',
    ]);
  } finally {
    catalog.close();
  }
});

test('"Do dodania" batch: only complete forms (ISBN page with publisher and year), one decision each', () => {
  const catalog = catalogue();
  const repo = catalog.repository;
  try {
    catalog.ingestOffers(
      [
        {
          source: 'Vinted',
          url: 'https://www.vinted.pl/items/31-a',
          title: 'Spaczony miecz Dan Abnett',
          price: 4000,
          isbn: '9788362577446',
        },
        {
          source: 'Vinted',
          url: 'https://www.vinted.pl/items/32-b',
          title: 'Nieznana książka',
          price: 1500,
          isbn: '9788362577453',
        },
      ],
      at,
    );
    const reason = (url) => {
      const offer = repo.database.prepare('SELECT id FROM offers WHERE normalized_url=?').get(url);
      repo.database
        .prepare(
          "UPDATE identification_jobs SET status='review_required', result_json=? WHERE offer_id=?",
        )
        .run(
          JSON.stringify({ decision: 'not_found', reason: ['isbn_not_found_in_metadata_sources'] }),
          offer.id,
        );
      return repo.database
        .prepare('SELECT id FROM identification_jobs WHERE offer_id=?')
        .get(offer.id).id;
    };
    const complete = reason('https://www.vinted.pl/items/31-a');
    const missing = reason('https://www.vinted.pl/items/32-b');
    repo.database
      .prepare(
        "INSERT INTO external_isbn_lookups(source,isbn,status,record_json,fetched_at) VALUES('lubimyczytac',?,?,?,?)",
      )
      .run(
        '9788362577446',
        'found',
        JSON.stringify({
          title: 'Spaczony miecz',
          authors: ['Dan Abnett'],
          publisher: 'Copernicus',
          publicationYear: 2012,
          url: 'https://lubimyczytac.pl/ksiazka/1',
        }),
        at.toISOString(),
      );
    const plan = addBatchPlan(repo);
    assert.deepEqual(
      plan.items.map((item) => item.jobId),
      [complete],
    );
    assert.equal(plan.skipped, 1, 'no ISBN page: the form is not complete');
    assert.deepEqual(
      [plan.items[0].title, plan.items[0].publisher, plan.items[0].year],
      ['Spaczony miecz', 'Copernicus', 2012],
    );
    const result = applyAddBatch(repo, [complete, missing]);
    assert.equal(result.approved, 1);
    assert.deepEqual(
      result.results.map((row) => [row.jobId, row.ok]),
      [
        [complete, true],
        [missing, false],
      ],
    );
    assert.equal(status(repo, complete), 'completed');
    assert.equal(status(repo, missing), 'review_required');
    assert.equal(recentBatches(repo)[0].kind, 'add');
    assert.equal(undoBatch(repo, result.batchId).reopened, 1);
    assert.equal(status(repo, complete), 'review_required');
  } finally {
    catalog.close();
  }
});
