// @ts-check
// "Usuń z katalogu": the operator removes a work that does not belong to the collection (junk the
// scan picked up). Nothing is deleted — review decisions are immutable and editions are referenced
// by them — but the work and its editions disappear from every list (each "not merged" condition
// also says "not in removed_works"), every offer of
// it is rejected with one decision per offer ("Ostatnie decyzje" can reopen any of them), and new
// offers that resolve to its editions or carry one of its ISBNs are rejected after each
// identification pass. Restoring the work puts every offer back exactly as it was.
import { randomUUID } from 'node:crypto';
import { isbnKeys } from './isbn-normalization.mjs';

export const REMOVAL_AUTHOR_PREFIX = 'catalog_removal:';

/** @param {string} code @param {number} [statusCode] */
function fail(code, statusCode = 400) {
  throw Object.assign(Error(code), { statusCode });
}

/**
 * Offers whose active match points at an edition of `workId`, with their identification job.
 * @param {any} db @param {string} workId
 */
function offersOfWork(db, workId) {
  return db
    .prepare(
      `SELECT m.id AS match_id, m.offer_id, j.id AS job_id, j.status AS job_status, j.result_json
       FROM offer_matches m JOIN editions e ON e.id=m.edition_id
       LEFT JOIN identification_jobs j ON j.offer_id=m.offer_id AND j.job_type='identify_edition'
       WHERE e.work_id=? AND m.status='active'`,
    )
    .all(workId);
}

/**
 * Rejects one offer on behalf of a removed work; remembers what it undoes so restoring is exact.
 * @param {any} db @param {any} row @param {string} workId @param {string} reason @param {string} at
 */
function rejectForRemoval(db, row, workId, reason, at) {
  if (row.match_id)
    db.prepare("UPDATE offer_matches SET status='superseded',valid_to=? WHERE id=?").run(
      at,
      row.match_id,
    );
  if (!row.job_id) return;
  db.prepare(
    `UPDATE identification_jobs SET status='completed', run_after=NULL, lease_token=NULL,
       lease_expires_at=NULL, last_error=NULL, result_json=?, updated_at=? WHERE id=?`,
  ).run(
    JSON.stringify({
      manualDecision: 'excluded',
      automatic: true,
      removedWork: workId,
      reason,
      decidedAt: at,
      previous: {
        status: row.job_status,
        result: row.result_json ?? null,
        matchId: row.match_id ?? null,
      },
    }),
    at,
    row.job_id,
  );
  db.prepare(
    `INSERT INTO review_decisions(id,job_id,offer_id,edition_id,action,reason,created_by,created_at)
     VALUES(?,?,?,NULL,'excluded',?,?,?)`,
  ).run(randomUUID(), row.job_id, row.offer_id, reason, REMOVAL_AUTHOR_PREFIX + workId, at);
}

/**
 * What removing the work would take with it (for the confirmation), or the removal itself.
 * @param {any} repository @param {string} workId
 * @param {{ confirm?: boolean, now?: () => Date }} [options]
 */
export function removeCatalogWork(
  repository,
  workId,
  { confirm = false, now = () => new Date() } = {},
) {
  const db = repository.database;
  const work = db.prepare('SELECT id,title FROM works WHERE id=?').get(String(workId));
  if (!work) fail('WORK_NOT_FOUND', 404);
  if (db.prepare('SELECT 1 FROM catalog_work_merges WHERE source_id=?').get(work.id))
    fail('WORK_ALREADY_MERGED', 409);
  if (db.prepare('SELECT 1 FROM removed_works WHERE work_id=?').get(work.id))
    fail('WORK_ALREADY_REMOVED', 409);
  const editions = db.prepare('SELECT count(*) AS n FROM editions WHERE work_id=?').get(work.id).n;
  // A set offer holds other books too: it stays, only its entry for this work is unaffected.
  const offers = offersOfWork(db, work.id).filter(
    (/** @type {any} */ row) =>
      !db.prepare('SELECT 1 FROM offer_sets WHERE offer_id=?').get(row.offer_id) &&
      row.job_status !== 'running',
  );
  const summary = { workId: work.id, title: work.title, editions, offers: offers.length };
  if (!confirm) return summary;
  const at = now().toISOString();
  const reason = 'Usunięte z katalogu: ' + String(work.title).slice(0, 160);
  return repository.transaction(() => {
    db.prepare('INSERT INTO removed_works(work_id,title,removed_at) VALUES(?,?,?)').run(
      work.id,
      work.title,
      at,
    );
    for (const row of offers) rejectForRemoval(db, row, work.id, reason, at);
    return { ...summary, removed: true, removedAt: at };
  });
}

/** Removed works, newest first, with how many offers each removal rejected. @param {any} repository */
export function listRemovedWorks(repository) {
  return repository.database
    .prepare(
      `SELECT r.work_id AS workId, r.title, r.removed_at AS removedAt,
         (SELECT count(*) FROM review_decisions d WHERE d.created_by=? || r.work_id) AS rejectedOffers
       FROM removed_works r ORDER BY r.removed_at DESC`,
    )
    .all(REMOVAL_AUTHOR_PREFIX);
}

/**
 * Restores a removed work: it is listed again and every offer the removal rejected (and the
 * operator did not reopen since) gets its job and its edition assignment back.
 * @param {any} repository @param {string} workId @param {{ now?: () => Date }} [options]
 */
export function restoreCatalogWork(repository, workId, { now = () => new Date() } = {}) {
  const db = repository.database;
  const removed = db.prepare('SELECT * FROM removed_works WHERE work_id=?').get(String(workId));
  if (!removed) fail('WORK_NOT_REMOVED', 404);
  const at = now().toISOString();
  return repository.transaction(() => {
    const decisions = db
      .prepare(
        `SELECT d.id, d.offer_id, d.job_id, j.result_json FROM review_decisions d
         JOIN identification_jobs j ON j.id=d.job_id
         WHERE d.created_by=? AND NOT EXISTS (SELECT 1 FROM review_revisions r WHERE r.decision_id=d.id)
           AND d.id=(SELECT d2.id FROM review_decisions d2 WHERE d2.offer_id=d.offer_id
                     ORDER BY d2.created_at DESC, d2.rowid DESC LIMIT 1)`,
      )
      .all(REMOVAL_AUTHOR_PREFIX + removed.work_id);
    let restored = 0;
    for (const decision of decisions) {
      let result;
      try {
        result = JSON.parse(decision.result_json);
      } catch {
        continue;
      }
      if (result?.removedWork !== removed.work_id) continue;
      const previous = result.previous || {};
      const free = !db
        .prepare("SELECT 1 FROM offer_matches WHERE offer_id=? AND status='active'")
        .get(decision.offer_id);
      if (previous.matchId && free)
        db.prepare(
          "UPDATE offer_matches SET status='active',valid_to=NULL WHERE id=? AND status='superseded'",
        ).run(previous.matchId);
      db.prepare('INSERT INTO review_revisions VALUES(?,?,?)').run(randomUUID(), decision.id, at);
      db.prepare(
        `UPDATE identification_jobs SET status=?, result_json=?, lease_token=NULL, lease_expires_at=NULL,
           run_after=NULL, updated_at=? WHERE id=?`,
      ).run(previous.status || 'review_required', previous.result ?? null, at, decision.job_id);
      restored++;
    }
    db.prepare('DELETE FROM removed_works WHERE work_id=?').run(removed.work_id);
    return { workId: removed.work_id, title: removed.title, restored: true, offers: restored };
  });
}

/**
 * Offers that arrived after a removal and lead to a removed work: an automatic match to one of
 * its editions, or one of its ISBNs on an offer still being identified. Skipped: manual
 * assignments, sets, running jobs, and offers whose removal rejection the operator reopened.
 * Run after each identification pass. @param {any} repository @param {{ now?: () => Date }} [options]
 */
export function rejectOffersOfRemovedWorks(repository, { now = () => new Date() } = {}) {
  const db = repository.database;
  const works = db.prepare('SELECT work_id, title FROM removed_works').all();
  if (!works.length) return { rejected: 0 };
  /** @type {Map<string, any>} */
  const byIsbn = new Map();
  for (const row of db
    .prepare(
      `SELECT i.normalized_value AS isbn, r.work_id, r.title FROM edition_identifiers i
       JOIN editions e ON e.id=i.edition_id JOIN removed_works r ON r.work_id=e.work_id
       WHERE i.scheme IN ('isbn10','isbn13')`,
    )
    .all())
    for (const key of isbnKeys(row.isbn)) byIsbn.set(key, row);
  const reopened = `EXISTS (SELECT 1 FROM review_decisions d JOIN review_revisions rv ON rv.decision_id=d.id
      WHERE d.offer_id=o.id AND d.created_by LIKE '${REMOVAL_AUTHOR_PREFIX}%')`;
  const guarded = `NOT EXISTS (SELECT 1 FROM offer_sets s WHERE s.offer_id=o.id) AND NOT ${reopened}`;
  const matched = db
    .prepare(
      `SELECT m.id AS match_id, o.id AS offer_id, j.id AS job_id, j.status AS job_status, j.result_json,
         r.work_id, r.title
       FROM offer_matches m JOIN offers o ON o.id=m.offer_id
       JOIN editions e ON e.id=m.edition_id JOIN removed_works r ON r.work_id=e.work_id
       LEFT JOIN identification_jobs j ON j.offer_id=o.id AND j.job_type='identify_edition'
       WHERE m.status='active' AND m.method NOT IN ('manual','legacy_manual')
         AND coalesce(j.status,'') <> 'running' AND ${guarded}`,
    )
    .all();
  const pending = byIsbn.size
    ? db
        .prepare(
          `SELECT NULL AS match_id, o.id AS offer_id, o.observed_isbn, j.id AS job_id, j.status AS job_status, j.result_json
           FROM offers o JOIN identification_jobs j ON j.offer_id=o.id AND j.job_type='identify_edition'
           WHERE j.status IN ('queued','retry_wait','review_required','failed') AND o.observed_isbn IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM offer_matches m WHERE m.offer_id=o.id AND m.status='active')
             AND ${guarded}`,
        )
        .all()
        .flatMap((/** @type {any} */ row) => {
          const hit = isbnKeys(row.observed_isbn)
            .map((key) => byIsbn.get(key))
            .find(Boolean);
          return hit ? [{ ...row, work_id: hit.work_id, title: hit.title }] : [];
        })
    : [];
  const at = now().toISOString();
  let rejected = 0;
  repository.transaction(() => {
    for (const row of [...matched, ...pending]) {
      rejectForRemoval(
        db,
        row,
        row.work_id,
        'Książka usunięta z katalogu: ' + String(row.title).slice(0, 160),
        at,
      );
      rejected++;
    }
  });
  return { rejected };
}
