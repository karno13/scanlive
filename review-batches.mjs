// @ts-check
// Batch approval in the review queue: "Szybkie" (sure catalogue / title matches, from
// sureReviewPlan) and "Do dodania" (ISBN unknown to BN and Open Library, edition form entirely
// filled from a page with this exact ISBN). Each offer is decided on its own, with its own
// review_decisions row and the same guards as one by one; review_batches only groups the rows, so
// "Ostatnie decyzje" can undo the whole batch.
import { randomUUID } from 'node:crypto';
import { applySureReviewPlan, listIdentificationJobs, sureReviewPlan } from './review-queue.mjs';
import { createEditionFromOffer, offerEditionDraft } from './offer-editions.mjs';
import { reopenReviewDecision } from './api-routes.mjs';
import { proxiedImage } from './offer-images.mjs';

const ADD_REASONS = [
  'isbn_not_found_in_metadata_sources',
  'metadata_invalid_or_incomplete',
  'metadata_isbn_mismatch',
];

/**
 * The jobs of one queue tab, exactly as the tab lists them (one row per decision: offers sharing
 * an ISBN are one row, the others follow it), so the grid and the tab count agree.
 */
export function bucketJobIds(repository, bucket) {
  const ids = [];
  for (let offset = 0; offset < 5000; offset += 250) {
    const page = listIdentificationJobs(repository, {
      status: 'review_required',
      bucket,
      limit: 250,
      offset,
    });
    ids.push(...page.items.map((item) => item.id));
    if (page.items.length < 250) break;
  }
  return ids;
}

function reasonOf(repository, jobId) {
  const row = repository.database
    .prepare(
      "SELECT CASE WHEN json_valid(result_json) THEN json_extract(result_json,'$.reason[0]') END AS reason FROM identification_jobs WHERE id=?",
    )
    .get(jobId);
  return row?.reason ?? null;
}

/** Offer photo and price of each job, for the cards. */
function offerFacts(repository, jobIds) {
  if (!jobIds.length) return new Map();
  const rows = repository.database
    .prepare(
      `SELECT j.id AS jobId, o.id AS offerId, o.original_title AS offerTitle, o.source, o.current_price AS price, o.image_url AS imageUrl
       FROM identification_jobs j JOIN offers o ON o.id=j.offer_id
       WHERE j.id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(jobIds));
  return new Map(rows.map((row) => [row.jobId, row]));
}

/** "Do dodania" offers whose edition form is complete from the ISBN page: title, author, publisher, year. */
export function addBatchPlan(repository, { jobIds = null } = {}) {
  const ids = (bucketJobIds(repository, 'add') || []).filter(
    (id) => !jobIds || jobIds.includes(id),
  );
  const items = [];
  let skipped = 0;
  const facts = offerFacts(repository, ids);
  for (const jobId of ids) {
    let draft;
    try {
      draft = offerEditionDraft(repository, jobId);
    } catch {
      skipped++;
      continue;
    }
    const complete =
      ADD_REASONS.includes(reasonOf(repository, jobId)) &&
      draft.record &&
      draft.title &&
      draft.authors?.length &&
      draft.record.publisher &&
      draft.record.publicationYear &&
      draft.isbn;
    if (!complete) {
      skipped++;
      continue;
    }
    const offer = facts.get(jobId) || {};
    items.push({
      jobId,
      kind: 'add',
      offerId: offer.offerId,
      offerTitle: offer.offerTitle,
      source: offer.source,
      price: offer.price ?? null,
      offerImage: offer.imageUrl ? proxiedImage(offer.imageUrl) : null,
      title: draft.title,
      authors: draft.authors,
      publisher: draft.record.publisher,
      year: draft.record.publicationYear,
      isbn: draft.isbn,
      recordUrl: draft.record.url || null,
      siblings: draft.siblings || 0,
    });
  }
  return { items, skipped };
}

/** "Szybkie": the sure plan of the catalogue, with the offer photo for each card. */
export function quickBatchPlan(repository, { jobIds = null } = {}) {
  const tab = bucketJobIds(repository, 'quick').filter((id) => !jobIds || jobIds.includes(id));
  const plan = sureReviewPlan(repository, { jobIds: tab });
  const facts = offerFacts(
    repository,
    plan.items.map((item) => item.jobId),
  );
  return {
    skipped: plan.skipped,
    items: plan.items.map((item) => {
      const offer = facts.get(item.jobId) || {};
      return {
        ...item,
        offerId: offer.offerId,
        price: offer.price ?? null,
        offerImage: offer.imageUrl ? proxiedImage(offer.imageUrl) : null,
      };
    }),
  };
}

function recordBatch(repository, kind, decisionIds, at) {
  if (!decisionIds.length) return null;
  const id = randomUUID();
  repository.transaction(() => {
    repository.database
      .prepare('INSERT INTO review_batches(id,kind,created_at) VALUES(?,?,?)')
      .run(id, kind, at);
    const link = repository.database.prepare(
      'INSERT OR IGNORE INTO review_batch_decisions(batch_id,decision_id) VALUES(?,?)',
    );
    for (const decisionId of decisionIds) link.run(id, decisionId);
  });
  return id;
}

/** The decision rows the operator's batch wrote for these jobs (not automatic ones). */
function decisionsSince(repository, jobIds, at) {
  if (!jobIds.length) return [];
  return repository.database
    .prepare(
      `SELECT id FROM review_decisions WHERE created_by='local_user' AND created_at>=?
       AND job_id IN (SELECT value FROM json_each(?))`,
    )
    .all(at, JSON.stringify(jobIds))
    .map((row) => row.id);
}

/**
 * Applies a "Szybkie" batch (items kept from quickBatchPlan) and groups the decisions.
 * @returns {Promise<{ batchId: string | null, approved: number, results: object[] }>}
 */
export async function applyQuickBatch(catalog, items = [], { now = () => new Date() } = {}) {
  const at = now().toISOString();
  const result = await applySureReviewPlan(catalog, items);
  const ok = result.results.filter((row) => row.ok).map((row) => row.jobId);
  const batchId = recordBatch(
    catalog.repository,
    'quick',
    decisionsSince(catalog.repository, ok, at),
    at,
  );
  return { batchId, approved: result.approved, results: result.results };
}

/**
 * Applies a "Do dodania" batch: for each job, the edition from its complete draft (or the existing
 * edition with that ISBN), assigned as a manual decision.
 */
export function applyAddBatch(repository, jobIds = [], { now = () => new Date() } = {}) {
  const at = now().toISOString();
  const plan = new Map(
    addBatchPlan(repository, { jobIds }).items.map((item) => [item.jobId, item]),
  );
  const results = [];
  const decisionIds = [];
  for (const jobId of jobIds.slice(0, 500).map(String)) {
    const item = plan.get(jobId);
    if (!item) {
      results.push({ jobId, ok: false, error: 'NOT_IN_PLAN' });
      continue;
    }
    try {
      const created = createEditionFromOffer(
        repository,
        jobId,
        {
          title: item.title,
          authors: item.authors,
          isbn: item.isbn,
          publisher: item.publisher,
          publicationYear: item.year,
        },
        { now },
      );
      if (created.decision?.id) decisionIds.push(created.decision.id);
      results.push({ jobId, ok: true, created: created.created });
    } catch (error) {
      results.push({
        jobId,
        ok: false,
        error: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'DECISION_FAILED',
      });
    }
  }
  const batchId = recordBatch(repository, 'add', decisionIds, at);
  return { batchId, approved: decisionIds.length, results };
}

/** Recent batches for "Ostatnie decyzje": size, kind, and how many decisions can still be undone. */
export function recentBatches(repository, { limit = 10 } = {}) {
  return repository.database
    .prepare(
      `SELECT b.id, b.kind, b.created_at AS createdAt, count(l.decision_id) AS decisions,
         sum(CASE WHEN r.id IS NULL THEN 1 ELSE 0 END) AS open
       FROM review_batches b JOIN review_batch_decisions l ON l.batch_id=b.id
       LEFT JOIN review_revisions r ON r.decision_id=l.decision_id
       GROUP BY b.id ORDER BY b.created_at DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({ ...row, decisions: Number(row.decisions), open: Number(row.open) }));
}

/**
 * Undoes a batch: every decision of it goes back to review (reopenReviewDecision, the same as
 * "Popraw decyzję" one by one). Decisions with a newer change are left and reported.
 */
export function undoBatch(repository, batchId) {
  const ids = repository.database
    .prepare(
      `SELECT l.decision_id AS id FROM review_batch_decisions l
       WHERE l.batch_id=? AND NOT EXISTS (SELECT 1 FROM review_revisions r WHERE r.decision_id=l.decision_id)`,
    )
    .all(String(batchId))
    .map((row) => row.id);
  if (
    !ids.length &&
    !repository.database.prepare('SELECT id FROM review_batches WHERE id=?').get(String(batchId))
  )
    throw Object.assign(Error('BATCH_NOT_FOUND'), { statusCode: 404 });
  let reopened = 0;
  const failed = [];
  for (const id of ids) {
    try {
      reopenReviewDecision(repository, id);
      reopened++;
    } catch (error) {
      failed.push({
        id,
        error: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'UNDO_FAILED',
      });
    }
  }
  return { reopened, failed };
}
