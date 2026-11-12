// Editions without publisher or year (verified from a source that did not carry them): the
// national ISBN registry (e-ISBN) and, with the operator's key, Google Books are asked directly,
// because the normal lookup stops at the first source that knows the ISBN. Only empty fields of
// editions the operator did not edit by hand are filled; every fill is reversible (migration 131).
import { randomUUID } from 'node:crypto';
import { normalizePublisher } from './publisher-names.mjs';

const DAY = 86_400_000;
const CHECK_AFTER_MS = { nothing: 30 * DAY, filled: 30 * DAY, error: DAY };
const JUNK_PUBLISHER = /^(?:n\/a|brak|b\.?\s?m\.?|s\.?\s?n\.?|nieznany|unknown|none)$/i;

/** @param {unknown} value */
export function cleanGapPublisher(value) {
  const name = normalizePublisher(value);
  if (!name || name.length < 2 || name.length > 120 || JUNK_PUBLISHER.test(name)) return null;
  return name;
}

/** @param {unknown} value @param {Date} at */
export function cleanGapYear(value, at = new Date()) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1400 && year <= at.getUTCFullYear() + 1 ? year : null;
}

/** Real (not "Wydanie nieustalone") editions that lack a publisher or a year, due for a check. */
export function pendingGapEditions(repository, { limit = 10, now = () => new Date() } = {}) {
  const at = now().getTime();
  return repository.database
    .prepare(
      `SELECT e.id, e.publisher, e.publication_year AS year,
         (SELECT normalized_value FROM edition_identifiers i WHERE i.edition_id=e.id AND i.scheme='isbn13' LIMIT 1) AS isbn13,
         (SELECT normalized_value FROM edition_identifiers i WHERE i.edition_id=e.id AND i.scheme='isbn10' LIMIT 1) AS isbn10,
         c.outcome, c.checked_at AS checkedAt
       FROM editions e LEFT JOIN edition_gap_checks c ON c.edition_id=e.id
       WHERE e.is_unknown=0 AND e.verification_status<>'manual'
         AND (coalesce(e.publisher,'')='' OR e.publication_year IS NULL)
         AND EXISTS (SELECT 1 FROM edition_identifiers i WHERE i.edition_id=e.id AND i.scheme IN ('isbn13','isbn10'))
       ORDER BY c.checked_at IS NOT NULL, c.checked_at`,
    )
    .all()
    .filter(
      (row) =>
        !row.checkedAt ||
        Date.parse(row.checkedAt) + (CHECK_AFTER_MS[row.outcome] ?? CHECK_AFTER_MS.nothing) <= at,
    )
    .slice(0, limit);
}

/**
 * Publisher and year published on the product page of an offer whose own ISBN is one of the
 * edition's (offer_enrichment facts): evidence from the shop, no request needed.
 */
export function offerFactRecords(repository, editionId) {
  return repository.database
    .prepare(
      `SELECT e.source, e.facts_json AS facts FROM offer_enrichment e
       WHERE e.outcome='isbn_found' AND e.facts_json IS NOT NULL
         AND e.isbn IN (SELECT normalized_value FROM edition_identifiers WHERE edition_id=? AND scheme IN ('isbn13','isbn10'))`,
    )
    .all(editionId)
    .map((row) => {
      try {
        const facts = JSON.parse(row.facts);
        return {
          source: 'listing:' + row.source,
          publisher: facts.publisher,
          publicationYear: facts.year,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * @param {{ repository: any, lookupGapRecords: (isbn: string) => Promise<{ error?: boolean, records: Array<{ source: string, publisher?: string|null, publicationYear?: number|null }> }> }} catalog
 */
export async function fillEditionGaps(catalog, { limit = 10, now = () => new Date() } = {}) {
  const repository = catalog.repository;
  const db = repository.database;
  const rows = pendingGapEditions(repository, { limit, now });
  const report = { checked: 0, filled: 0, fields: 0, nothing: 0, errors: 0, batchId: null };
  if (!rows.length) return report;
  const batchId = randomUUID();
  for (const row of rows) {
    let found;
    try {
      found = await catalog.lookupGapRecords(row.isbn13 || row.isbn10);
    } catch {
      found = { error: true, records: [] };
    }
    found = { ...found, records: [...offerFactRecords(repository, row.id), ...found.records] };
    report.checked += 1;
    const at = now();
    const iso = at.toISOString();
    let fields = 0;
    repository.transaction(() => {
      // Re-read inside the transaction: a manual edit made meanwhile wins.
      const current = db
        .prepare(
          'SELECT publisher, publication_year AS year, verification_status AS status FROM editions WHERE id=?',
        )
        .get(row.id);
      if (!current || current.status === 'manual') return;
      const insert = db.prepare(
        `INSERT INTO edition_field_fills (id, batch_id, edition_id, field, old_value, new_value, source, created_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      );
      if (!current.publisher) {
        const hit = found.records
          .map((record) => ({ source: record.source, value: cleanGapPublisher(record.publisher) }))
          .find((entry) => entry.value);
        if (hit) {
          db.prepare(
            "UPDATE editions SET publisher=?, updated_at=? WHERE id=? AND coalesce(publisher,'')=''",
          ).run(hit.value, iso, row.id);
          insert.run(randomUUID(), batchId, row.id, 'publisher', null, hit.value, hit.source, iso);
          fields += 1;
        }
      }
      if (current.year == null) {
        const hit = found.records
          .map((record) => ({
            source: record.source,
            value: cleanGapYear(record.publicationYear, at),
          }))
          .find((entry) => entry.value);
        if (hit) {
          db.prepare(
            'UPDATE editions SET publication_year=?, updated_at=? WHERE id=? AND publication_year IS NULL',
          ).run(hit.value, iso, row.id);
          insert.run(
            randomUUID(),
            batchId,
            row.id,
            'publication_year',
            null,
            String(hit.value),
            hit.source,
            iso,
          );
          fields += 1;
        }
      }
      const outcome = fields ? 'filled' : found.error ? 'error' : 'nothing';
      db.prepare(
        `INSERT INTO edition_gap_checks (edition_id, checked_at, outcome) VALUES (?,?,?)
         ON CONFLICT(edition_id) DO UPDATE SET checked_at=excluded.checked_at, outcome=excluded.outcome, attempts=attempts+1`,
      ).run(row.id, iso, outcome);
    });
    if (fields) {
      report.filled += 1;
      report.fields += fields;
    } else if (found.error) report.errors += 1;
    else report.nothing += 1;
  }
  if (report.fields) report.batchId = batchId;
  return report;
}

/** Fill batches (newest first) with how many fields of each are still filled, for "Ostatnie decyzje". */
export function listGapFillBatches(repository, limit = 10) {
  return repository.database
    .prepare(
      `SELECT batch_id AS id, min(created_at) AS createdAt, count(*) AS fields,
         sum(undone_at IS NULL) AS open, count(DISTINCT edition_id) AS editions
       FROM edition_field_fills GROUP BY batch_id ORDER BY createdAt DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({
      ...row,
      fields: Number(row.fields),
      open: Number(row.open),
      editions: Number(row.editions),
    }));
}

/** Restores the empty fields of a batch; a field the operator changed since is left alone. */
export function undoGapFills(repository, batchId, { now = () => new Date() } = {}) {
  const db = repository.database;
  return repository.transaction(() => {
    const fills = db
      .prepare('SELECT * FROM edition_field_fills WHERE batch_id=? AND undone_at IS NULL')
      .all(String(batchId));
    if (!fills.length) throw Object.assign(new Error('DECISION_NOT_FOUND'), { statusCode: 404 });
    const iso = now().toISOString();
    const result = { reopened: 0, kept: 0 };
    for (const fill of fills) {
      const column = fill.field === 'publisher' ? 'publisher' : 'publication_year';
      const changed = db
        .prepare(
          `UPDATE editions SET ${column}=?, updated_at=? WHERE id=? AND CAST(${column} AS TEXT)=?`,
        )
        .run(fill.old_value, iso, fill.edition_id, fill.new_value).changes;
      if (changed) result.reopened += 1;
      else result.kept += 1;
      db.prepare('UPDATE edition_field_fills SET undone_at=? WHERE id=?').run(iso, fill.id);
    }
    return result;
  });
}
