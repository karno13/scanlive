// @ts-check
// Conservative reference-price assignments: a known book, never a guessed edition.
import { randomUUID } from 'node:crypto';
import { sureReviewPlan } from './catalog-api.mjs';
import { ensureUnknownEdition } from './edition-variants.mjs';
import { looksLikeBundle, createCatalogBundleDetector } from './bundle-detection.mjs';

export const EMPIK_AUTO_AUTHOR = 'auto_empik_work_v1';

export function assignEmpikReferences(repository, { now = () => new Date() } = {}) {
  const db = repository.database;
  const detectBundle = createCatalogBundleDetector(repository);
  const plan = sureReviewPlan(repository).items.filter(
    (item) => item.source === 'Empik' && item.kind === 'edition' && item.workId,
  );
  let assigned = 0;
  repository.transaction(() => {
    for (const item of plan) {
      const job = db
        .prepare(
          `SELECT j.*,o.original_title,o.observed_isbn FROM identification_jobs j
        JOIN offers o ON o.id=j.offer_id WHERE j.id=? AND j.status='review_required'`,
        )
        .get(item.jobId);
      if (
        !job ||
        job.observed_isbn ||
        looksLikeBundle(job.original_title) ||
        detectBundle(job.original_title).length > 1
      )
        continue;
      // Never overrule a decision, including a reverted automatic decision, or an existing match/set.
      if (
        db.prepare('SELECT 1 FROM review_decisions WHERE offer_id=?').get(job.offer_id) ||
        db
          .prepare("SELECT 1 FROM offer_matches WHERE offer_id=? AND status='active'")
          .get(job.offer_id) ||
        db.prepare('SELECT 1 FROM offer_sets WHERE offer_id=?').get(job.offer_id)
      )
        continue;
      const editionId = ensureUnknownEdition(repository, item.workId, { now });
      const at = now().toISOString();
      const reason = 'Empik: pewny tytuł w katalogu; wydanie nieustalone, cena odniesienia.';
      repository.assignOfferToEdition(job.offer_id, editionId, {
        method: 'metadata',
        createdBy: EMPIK_AUTO_AUTHOR,
        reason,
        at,
      });
      db.prepare(
        `INSERT INTO review_decisions(id,job_id,offer_id,edition_id,action,reason,created_by,created_at)
        VALUES(?,?,?,?,'approved',?,?,?)`,
      ).run(randomUUID(), job.id, job.offer_id, editionId, reason, EMPIK_AUTO_AUTHOR, at);
      db.prepare(
        `UPDATE identification_jobs SET status='completed',result_json=?,updated_at=?,
        run_after=NULL,lease_token=NULL,lease_expires_at=NULL,last_error=NULL WHERE id=?`,
      ).run(
        JSON.stringify({
          automatic: true,
          manualDecision: 'approved',
          editionId,
          reason,
          decidedAt: at,
        }),
        at,
        job.id,
      );
      assigned++;
    }
  });
  return { assigned };
}
