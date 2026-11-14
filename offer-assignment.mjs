// @ts-check
// Operator changes an offer's edition, or removes the assignment, from the catalogue or the offer
// panel. Every change is a manual decision kept in the match history and review decisions; a
// removed edition is recorded as rejected so the resolver never puts the offer back on it.
import { randomUUID } from 'node:crypto';

function fail(code, statusCode = 400) {
  throw Object.assign(Error(code), { statusCode });
}

function identificationJob(db, offerId, at) {
  const job = db
    .prepare(
      "SELECT * FROM identification_jobs WHERE offer_id=? AND job_type='identify_edition' ORDER BY created_at LIMIT 1",
    )
    .get(offerId);
  if (job) return job;
  const id = randomUUID();
  db.prepare(
    "INSERT INTO identification_jobs(id,offer_id,job_type,status,attempt_count,created_at,updated_at) VALUES(?,?,'identify_edition','completed',0,?,?)",
  ).run(id, offerId, at, at);
  return db.prepare('SELECT * FROM identification_jobs WHERE id=?').get(id);
}

function decision(db, { jobId, offerId, editionId, action, reason, at }) {
  db.prepare(
    "INSERT INTO review_decisions(id,job_id,offer_id,edition_id,action,reason,created_by,created_at) VALUES(?,?,?,?,?,?,'local_user',?)",
  ).run(randomUUID(), jobId, offerId, editionId, action, reason, at);
}

function loadOffer(db, offerId) {
  const offer = db.prepare('SELECT id FROM offers WHERE id=?').get(String(offerId ?? ''));
  if (!offer) fail('OFFER_NOT_FOUND', 404);
  if (db.prepare('SELECT 1 FROM offer_sets WHERE offer_id=?').get(offer.id))
    fail('OFFER_IS_SET', 409);
  return offer;
}

/** Moves the offer to `editionId` as a manual assignment (replacing any current one). */
export function reassignOffer(
  repository,
  offerId,
  editionId,
  { now = () => new Date(), reason = null } = {},
) {
  const db = repository.database;
  return repository.transaction(() => {
    const offer = loadOffer(db, offerId);
    const edition = db
      .prepare('SELECT id, work_id FROM editions WHERE id=?')
      .get(String(editionId ?? ''));
    if (!edition) fail('EDITION_NOT_FOUND', 404);
    const at = now().toISOString();
    const previous = db
      .prepare("SELECT edition_id FROM offer_matches WHERE offer_id=? AND status='active'")
      .get(offer.id);
    if (previous?.edition_id === edition.id) {
      const current = db
        .prepare("SELECT method FROM offer_matches WHERE offer_id=? AND status='active'")
        .get(offer.id);
      if (['manual', 'legacy_manual'].includes(current.method))
        return { offerId: offer.id, editionId: edition.id, changed: false };
    }
    const text =
      reason ||
      (previous ? 'Zmieniono przypisanie ręcznie w katalogu.' : 'Przypisano ręcznie w katalogu.');
    repository.assignOfferToEdition(offer.id, edition.id, {
      id: `manual_reassign_${randomUUID()}`,
      method: 'manual',
      status: 'active',
      reason: text,
      createdBy: 'local_user',
      at,
    });
    const job = identificationJob(db, offer.id, at);
    db.prepare(
      "UPDATE identification_jobs SET status='completed', run_after=NULL, lease_token=NULL, lease_expires_at=NULL, last_error=NULL, result_json=?, updated_at=? WHERE id=?",
    ).run(
      JSON.stringify({
        decision: 'matched_existing',
        reason: ['manual_reassignment'],
        workId: edition.work_id,
        editionId: edition.id,
        previousEditionId: previous?.edition_id ?? null,
      }),
      at,
      job.id,
    );
    decision(db, {
      jobId: job.id,
      offerId: offer.id,
      editionId: edition.id,
      action: 'approved',
      reason: text,
      at,
    });
    return {
      offerId: offer.id,
      editionId: edition.id,
      previousEditionId: previous?.edition_id ?? null,
      changed: true,
    };
  });
}

/**
 * Removes the offer's assignment. The offer goes back to "Do weryfikacji"; the removed edition is
 * recorded as rejected for this offer, so automatic identification will not assign it again.
 */
export function unassignOffer(repository, offerId, { now = () => new Date(), reason = null } = {}) {
  const db = repository.database;
  return repository.transaction(() => {
    const offer = loadOffer(db, offerId);
    const active = db
      .prepare("SELECT * FROM offer_matches WHERE offer_id=? AND status='active'")
      .get(offer.id);
    if (!active) fail('MATCH_NOT_FOUND', 404);
    const at = now().toISOString();
    const text = reason || 'Odłączono ręcznie w katalogu.';
    db.prepare(
      "UPDATE offer_matches SET status='superseded', valid_to=? WHERE offer_id=? AND status='active'",
    ).run(at, offer.id);
    repository.assignOfferToEdition(offer.id, active.edition_id, {
      id: `manual_unassign_${randomUUID()}`,
      method: 'manual',
      status: 'rejected',
      reason: text,
      createdBy: 'local_user',
      at,
    });
    const job = identificationJob(db, offer.id, at);
    db.prepare(
      "UPDATE identification_jobs SET status='review_required', run_after=NULL, lease_token=NULL, lease_expires_at=NULL, last_error=NULL, result_json=?, updated_at=? WHERE id=?",
    ).run(
      JSON.stringify({
        decision: 'review_required',
        reason: ['manual_unassigned'],
        editionId: null,
        rejectedEditionId: active.edition_id,
      }),
      at,
      job.id,
    );
    decision(db, {
      jobId: job.id,
      offerId: offer.id,
      editionId: active.edition_id,
      action: 'proposal_rejected',
      reason: text,
      at,
    });
    return { offerId: offer.id, removedEditionId: active.edition_id };
  });
}

/** Editions the operator removed from this offer by hand. */
export function operatorRejectedEditions(repository, offerId) {
  return new Set(
    repository.database
      .prepare(
        "SELECT edition_id FROM offer_matches WHERE offer_id=? AND status='rejected' AND created_by='local_user'",
      )
      .all(String(offerId ?? ''))
      .map((row) => row.edition_id),
  );
}
