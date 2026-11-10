// Background lookup on lubimyczytac.pl for offers waiting in review with an ISBN that BN, Open
// Library and e-ISBN do not know. A found record (same ISBN) fills the "Utwórz wydanie z
// ogłoszenia" draft with the real title, author, publisher, year and cycle; the operator still
// creates the edition with one click. Each ISBN is asked once a month (errors: once a day).

import { findLcRecord } from './metadata-sources/lubimyczytac.mjs';
import { normalizeISBN } from './isbn-normalization.mjs';
import { isThrottleError } from './offer-enrichment.mjs';

const NOT_FOUND_AGAIN_MS = 30 * 24 * 60 * 60_000;
const ERROR_AGAIN_MS = 24 * 60 * 60_000;
const UNKNOWN_REASONS = "('isbn_not_found_in_metadata_sources','metadata_invalid_or_incomplete')";

/** The stored lubimyczytac.pl record of an ISBN, or null. */
export function storedIsbnRecord(repository, isbn) {
  const key = normalizeISBN(isbn);
  if (!key) return null;
  try {
    const row = repository.database
      .prepare("SELECT record_json FROM external_isbn_lookups WHERE source='lubimyczytac' AND isbn=? AND status='found'")
      .get(key);
    return row ? JSON.parse(row.record_json) : null;
  } catch {
    return null;
  }
}

function pending(repository, limit, now) {
  const notFoundBefore = new Date(now - NOT_FOUND_AGAIN_MS).toISOString();
  const errorBefore = new Date(now - ERROR_AGAIN_MS).toISOString();
  const rows = repository.database
    .prepare(
      `SELECT j.id AS job_id, o.observed_isbn FROM identification_jobs j JOIN offers o ON o.id=j.offer_id
       LEFT JOIN external_isbn_lookups x ON x.source='lubimyczytac' AND x.isbn=upper(replace(replace(o.observed_isbn,'-',''),' ',''))
       WHERE j.status='review_required' AND json_valid(j.result_json)
         AND json_extract(j.result_json,'$.reason[0]') IN ${UNKNOWN_REASONS}
         AND coalesce(o.observed_isbn,'')<>''
         AND (x.isbn IS NULL OR (x.status='not_found' AND x.fetched_at<?) OR (x.status='error' AND x.fetched_at<?))
       ORDER BY j.updated_at DESC`,
    )
    .all(notFoundBefore, errorBefore);
  const byIsbn = new Map();
  for (const row of rows) {
    const isbn = normalizeISBN(row.observed_isbn);
    if (isbn && !byIsbn.has(isbn)) byIsbn.set(isbn, row.job_id);
  }
  return [...byIsbn].slice(0, limit);
}

function save(repository, isbn, status, record, at) {
  repository.database
    .prepare(
      `INSERT INTO external_isbn_lookups(source,isbn,status,record_json,fetched_at) VALUES('lubimyczytac',?,?,?,?)
       ON CONFLICT(source,isbn) DO UPDATE SET status=excluded.status, record_json=excluded.record_json, fetched_at=excluded.fetched_at`,
    )
    .run(isbn, status, record ? JSON.stringify(record) : null, at);
}

/**
 * Looks up a few unknown ISBNs. `draftOf(jobId)` gives the title and authors from the listings
 * (offerEditionDraft); `find` is findLcRecord (replaceable in tests).
 */
export async function lookupUnknownIsbns(repository, { draftOf, find = findLcRecord, limit = 2, now = () => new Date() } = {}) {
  const report = { checked: 0, found: 0, errors: 0, paused: false };
  for (const [isbn, jobId] of pending(repository, limit, now().getTime())) {
    report.checked++;
    try {
      const draft = draftOf(jobId);
      const record = await find({ isbn, title: draft.title, authors: draft.authors });
      save(repository, isbn, record ? 'found' : 'not_found', record, now().toISOString());
      if (record) report.found++;
    } catch (error) {
      report.errors++;
      save(repository, isbn, 'error', null, now().toISOString());
      if (isThrottleError(error)) {
        report.paused = true;
        break;
      }
    }
  }
  return report;
}
