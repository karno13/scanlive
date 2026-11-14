// @ts-check
// Sets fill themselves from the listing description. A set listing usually lists its books in the
// description; the operator used to open the listing and paste it into "Dodaj z opisu ogłoszenia".
// Now the description is read from the listing page in the background (paced like every other
// request to the source), and an empty set gets the catalogue books it names, once. The composition
// stays "to be confirmed" until the operator checks it against the photo.

import { readVintedISBN } from './vinted-detail.mjs';
import { setCandidates } from './offer-sets.mjs';
import { isThrottleError } from './offer-enrichment.mjs';

const RETRY_AFTER_ERROR_MS = 24 * 60 * 60_000;

/** Vinted sets without a stored description (or whose last read failed a day ago). */
export function pendingSetDescriptions(repository, { limit = 4, now = Date.now() } = {}) {
  const retryBefore = new Date(now - RETRY_AFTER_ERROR_MS).toISOString();
  return repository.database
    .prepare(
      `SELECT o.id, o.normalized_url AS url FROM offer_sets s JOIN offers o ON o.id=s.offer_id
       LEFT JOIN offer_descriptions d ON d.offer_id=o.id
       WHERE o.source='Vinted' AND (d.offer_id IS NULL OR (d.status='error' AND d.fetched_at<?))
       ORDER BY s.created_at DESC LIMIT ?`,
    )
    .all(retryBefore, Math.max(1, Math.min(50, limit)));
}

export function saveOfferDescription(
  repository,
  offerId,
  { text = null, status, error = null },
  at,
) {
  repository.database
    .prepare(
      `INSERT INTO offer_descriptions(offer_id,text,status,last_error,fetched_at) VALUES(?,?,?,?,?)
       ON CONFLICT(offer_id) DO UPDATE SET text=coalesce(excluded.text,offer_descriptions.text), status=excluded.status,
         last_error=excluded.last_error, fetched_at=excluded.fetched_at`,
    )
    .run(offerId, text, status, error, at);
}

/**
 * Fills an empty set from its stored description, once. Returns the number of books added.
 * Sets the operator already filled, or that were composed before, are left alone.
 */
export function composeSetFromDescription(repository, offerId, { now = () => new Date() } = {}) {
  const db = repository.database;
  const set = db
    .prepare('SELECT composed_from_description_at AS composed FROM offer_sets WHERE offer_id=?')
    .get(offerId);
  if (!set || set.composed) return 0;
  if (db.prepare('SELECT 1 FROM offer_set_editions WHERE offer_id=? LIMIT 1').get(offerId))
    return 0;
  const description = db
    .prepare("SELECT text FROM offer_descriptions WHERE offer_id=? AND status='found'")
    .get(offerId)?.text;
  if (!description) return 0;
  const { items } = setCandidates(repository, offerId, { text: description });
  const at = now().toISOString();
  repository.transaction(() => {
    const add = db.prepare(
      'INSERT OR IGNORE INTO offer_set_editions(offer_id,edition_id,added_at) VALUES(?,?,?)',
    );
    for (const item of items) add.run(offerId, item.editionId, at);
    db.prepare(
      'UPDATE offer_sets SET composed_from_description_at=?, composition_confirmed=0, updated_at=? WHERE offer_id=?',
    ).run(at, at, offerId);
  });
  return items.length;
}

/** Reads a few set descriptions and fills those sets. Stops at the first throttle or block. */
export async function fillSetsFromDescriptions(
  repository,
  { limit = 4, read = readVintedISBN, now = () => new Date() } = {},
) {
  const report = {
    checked: 0,
    found: 0,
    added: composeStoredSetDescriptions(repository, { now }).added,
    errors: 0,
    paused: false,
  };
  for (const row of pendingSetDescriptions(repository, { limit, now: now().getTime() })) {
    report.checked++;
    try {
      const detail = await read(row.url);
      const text = detail?.description || null;
      saveOfferDescription(
        repository,
        row.id,
        { text, status: text ? 'found' : 'missing' },
        now().toISOString(),
      );
      if (text) {
        report.found++;
        report.added += composeSetFromDescription(repository, row.id, { now });
      }
    } catch (error) {
      report.errors++;
      const code = /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'DESCRIPTION_READ_FAILED';
      saveOfferDescription(
        repository,
        row.id,
        { status: 'error', error: code },
        now().toISOString(),
      );
      if (isThrottleError(error) || error?.blocked) {
        report.paused = true;
        break;
      }
    }
  }
  return report;
}

/** Sets with a description already stored (e.g. marked as a set after it was read). */
export function composeStoredSetDescriptions(repository, { now = () => new Date() } = {}) {
  const rows = repository.database
    .prepare(
      `SELECT s.offer_id FROM offer_sets s JOIN offer_descriptions d ON d.offer_id=s.offer_id AND d.status='found'
       WHERE s.composed_from_description_at IS NULL`,
    )
    .all();
  let added = 0;
  for (const row of rows) added += composeSetFromDescription(repository, row.offer_id, { now });
  return { sets: rows.length, added };
}
