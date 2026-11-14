// @ts-check
// A rejected listing must not come back to review with the next scan. The same offer keeps its
// closed job; but sellers re-list (new Vinted item id), shops list one product under several
// addresses and the same item shows up in another source. A new offer whose title or ISBN equals
// that of an offer the operator rejected is rejected too, with a decision that names the original
// (and can be reopened in "Ostatnie decyzje i poprawianie pomyłek" like any other).

import { normalizeISBN } from './isbn-normalization.mjs';
import { universeWords } from './universes.mjs';

const REJECTED = "('excluded','not_book')";
export const AUTO_REJECT_AUTHOR = 'auto_same_as_rejected';

// Universe and sales words: on every listing, they never tell one product from another.
const SALES_WORDS = 'the fantasy ksiazka ksiazki nowa nowy tom'.split(' ');
const common = () => new Set([...universeWords(), ...SALES_WORDS]);

/** "World of Warcraft - Der letzte Wächter " → "world of warcraft der letzte wachter"; any script. */
export function rejectionTitleKey(title) {
  const key = String(title ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  // Short titles ("Warcraft", "Fourth Wing") and universe names alone name a kind of offer, not one product.
  const COMMON = common();
  const own = key.split(' ').filter((word) => word.length >= 4 && !COMMON.has(word));
  return key.length >= 12 && key.split(' ').length >= 3 && own.length ? key : null;
}

function isbnKey(value) {
  try {
    return normalizeISBN(String(value ?? '')) || null;
  } catch {
    return null;
  }
}

/** Offers whose latest decision is a rejection that still stands (the job was not reopened). */
function rejectedOffers(db) {
  return db
    .prepare(
      `SELECT o.id, o.source, o.original_title, o.observed_isbn FROM offers o
       JOIN identification_jobs j ON j.offer_id=o.id AND j.job_type='identify_edition'
       WHERE j.status='completed' AND json_valid(j.result_json)
         AND json_extract(j.result_json,'$.manualDecision') IN ${REJECTED}
         AND coalesce(json_extract(j.result_json,'$.automatic'),0)=0`,
    )
    .all();
}

/** Lookup of rejected offers by title key and by ISBN; build once per scan batch. */
export function createRejectionIndex(repository) {
  const byTitle = new Map();
  const byIsbn = new Map();
  for (const row of rejectedOffers(repository.database)) {
    // By title only within one source: the same title elsewhere may be another edition.
    const title = rejectionTitleKey(row.original_title);
    if (title && !byTitle.has(row.source + '|' + title)) byTitle.set(row.source + '|' + title, row);
    const isbn = isbnKey(row.observed_isbn);
    if (isbn && !byIsbn.has(isbn)) byIsbn.set(isbn, row);
  }
  return {
    size: byTitle.size + byIsbn.size,
    find(offer) {
      const title = rejectionTitleKey(offer.original_title ?? offer.originalTitle);
      const isbn = isbnKey(offer.observed_isbn ?? offer.observedIsbn);
      const hit =
        (title && byTitle.get(offer.source + '|' + title)) || (isbn && byIsbn.get(isbn)) || null;
      return hit && hit.id !== offer.id ? hit : null;
    },
  };
}

/** Closes the offer's open job as rejected, naming the rejected offer it repeats. */
export function rejectAsRepeat(repository, offerId, original, at) {
  const db = repository.database;
  const job = db
    .prepare("SELECT * FROM identification_jobs WHERE offer_id=? AND job_type='identify_edition'")
    .get(offerId);
  if (!job || job.status === 'completed' || job.status === 'running') return false;
  // A manual assignment or a set always wins over an automatic rejection.
  if (
    db
      .prepare(
        "SELECT 1 FROM offer_matches WHERE offer_id=? AND status='active' AND method IN ('manual','legacy_manual')",
      )
      .get(offerId)
  )
    return false;
  if (db.prepare('SELECT 1 FROM offer_sets WHERE offer_id=?').get(offerId)) return false;
  const reason =
    'Jak wcześniej odrzucona oferta: ' + String(original.original_title || '').slice(0, 160);
  db.prepare(
    `INSERT INTO review_decisions(id,job_id,offer_id,edition_id,action,reason,created_by,created_at)
     VALUES(?,?,?,NULL,'excluded',?,?,?)`,
  ).run(`auto_reject_${job.id}_${at}`, job.id, offerId, reason, AUTO_REJECT_AUTHOR, at);
  db.prepare(
    `UPDATE identification_jobs SET status='completed', run_after=NULL, lease_token=NULL, lease_expires_at=NULL,
       last_error=NULL, result_json=?, updated_at=? WHERE id=?`,
  ).run(
    JSON.stringify({
      manualDecision: 'excluded',
      automatic: true,
      sameAs: original.id,
      reason,
      decidedAt: at,
    }),
    at,
    job.id,
  );
  return true;
}

/**
 * Open jobs (queued or waiting for review) that repeat a rejected offer are rejected. Run after
 * each scan save and once at start; cheap: one pass over rejected offers and open jobs.
 */
export function rejectRepeatsOfRejectedOffers(
  repository,
  { now = () => new Date(), offerIds = null } = {},
) {
  const index = createRejectionIndex(repository);
  if (!index.size) return { rejected: 0 };
  const db = repository.database;
  const rows = db
    .prepare(
      `SELECT o.id, o.source, o.original_title, o.observed_isbn FROM offers o
       JOIN identification_jobs j ON j.offer_id=o.id AND j.job_type='identify_edition'
       WHERE j.status IN ('queued','retry_wait','review_required','failed')
       ${offerIds ? 'AND o.id IN (SELECT value FROM json_each(?))' : ''}`,
    )
    .all(...(offerIds ? [JSON.stringify(offerIds)] : []));
  const at = now().toISOString();
  let rejected = 0;
  repository.transaction(() => {
    for (const row of rows) {
      const original = index.find(row);
      if (original && rejectAsRepeat(repository, row.id, original, at)) rejected++;
    }
  });
  return { rejected };
}

/**
 * Automatic "same as a rejected offer" decisions that the current rule no longer confirms go back
 * to identification (once per change of the rule, at start-up). The first version of the rule
 * matched titles across sources and lost non-Latin letters ("World of Warcraft. Маг" was taken
 * for "World of Warcraft. Клятва на крови").
 */
export function undoUnconfirmedRepeatRejections(repository, { now = () => new Date() } = {}) {
  const db = repository.database;
  const rows = db
    .prepare(
      `SELECT j.id AS job_id, o.id, o.source, o.original_title, o.observed_isbn,
              json_extract(j.result_json,'$.sameAs') AS same_as
       FROM identification_jobs j JOIN offers o ON o.id=j.offer_id
       WHERE j.status='completed' AND json_valid(j.result_json)
         AND json_extract(j.result_json,'$.automatic')=1 AND json_extract(j.result_json,'$.sameAs') IS NOT NULL`,
    )
    .all();
  if (!rows.length) return { reopened: 0 };
  const index = createRejectionIndex(repository);
  const at = now().toISOString();
  let reopened = 0;
  repository.transaction(() => {
    for (const row of rows) {
      const original = index.find(row);
      if (original && original.id === row.same_as) continue;
      db.prepare(
        `INSERT INTO review_decisions(id,job_id,offer_id,edition_id,action,reason,created_by,created_at) VALUES(?,?,?,NULL,'requeued',?,?,?)`,
      ).run(
        `auto_reject_undo_${row.job_id}_${at}`,
        row.job_id,
        row.id,
        'Cofnięto automatyczne odrzucenie: poprawiona reguła powtórek go nie potwierdza.',
        AUTO_REJECT_AUTHOR,
        at,
      );
      db.prepare(
        `UPDATE identification_jobs SET status='queued', run_after=NULL, lease_token=NULL, lease_expires_at=NULL,
           last_error=NULL, result_json=NULL, attempt_count=0, updated_at=? WHERE id=?`,
      ).run(at, row.job_id);
      reopened++;
    }
  });
  return { reopened };
}
