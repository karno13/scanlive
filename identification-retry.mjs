// Review reasons that only mean "this ISBN is not in the catalogue yet". Once an edition with the
// ISBN exists (resolver, manual addition, seeding, an approval of a sibling offer) the resolver can
// match such offers by itself.
const ISBN_NOT_IN_CATALOG_REASONS = [
  'isbn_not_found_in_metadata_sources',
  'multiple_metadata_records',
  'metadata_invalid_or_incomplete',
  'metadata_isbn_mismatch',
  'metadata_source_temporary_error',
];

/**
 * Sends review jobs back to the resolver when the offer's ISBN has meanwhile appeared in the
 * catalogue. Manual assignments and bundles stay put. Cheap enough to run before every batch.
 */
export function requeueReviewsWithKnownIsbn(repository, now = () => new Date()) {
  const result = repository.database
    .prepare(
      `UPDATE identification_jobs
       SET status='queued',run_after=NULL,lease_token=NULL,lease_expires_at=NULL,
           last_error=NULL,result_json=NULL,attempt_count=0,updated_at=?
       WHERE status='review_required' AND json_valid(result_json)
         AND json_extract(result_json,'$.reason[0]') IN (${ISBN_NOT_IN_CATALOG_REASONS.map(() => '?').join(',')})
         AND EXISTS (
           SELECT 1 FROM offers o JOIN edition_identifiers i
             ON i.scheme IN ('isbn10','isbn13')
            AND i.normalized_value = upper(replace(replace(o.observed_isbn,'-',''),' ',''))
           WHERE o.id = identification_jobs.offer_id AND coalesce(o.observed_isbn,'') <> '')
         AND NOT EXISTS (SELECT 1 FROM offer_matches m WHERE m.offer_id = identification_jobs.offer_id
              AND m.status = 'active' AND m.method IN ('manual','legacy_manual'))
         AND NOT EXISTS (SELECT 1 FROM offer_sets s WHERE s.offer_id = identification_jobs.offer_id)`,
    )
    .run(now().toISOString(), ...ISBN_NOT_IN_CATALOG_REASONS);
  return Number(result.changes);
}

// Repository-side retry logic; HTTP routing must not own SQL statements.
const allowedModes = new Set(['unresolved', 'failed', 'not_found', 'review_required']);

export function retryIdentificationJobs(repository, mode, now = () => new Date()) {
  if (!allowedModes.has(mode)) {
    throw Object.assign(Error('INVALID_RETRY_MODE'), { statusCode: 400 });
  }
  const manualMatchGuard = `NOT EXISTS (
    SELECT 1 FROM offer_matches m WHERE m.offer_id = identification_jobs.offer_id
    AND m.status = 'active' AND m.method IN ('manual','legacy_manual')
  )`;
  const bundleGuard = `NOT EXISTS (
    SELECT 1 FROM offer_sets s WHERE s.offer_id = identification_jobs.offer_id
  )`;
  const condition =
    mode === 'unresolved'
      ? "(status IN ('failed','review_required','retry_wait') OR (status='completed' AND json_valid(result_json) AND json_extract(result_json,'$.decision')='not_found'))"
      : mode === 'not_found'
        ? "status='completed' AND json_valid(result_json) AND json_extract(result_json,'$.decision')='not_found'"
        : 'status = ?';
  const statement = repository.database.prepare(`
    UPDATE identification_jobs
    SET status='queued',run_after=NULL,lease_token=NULL,lease_expires_at=NULL,
        last_error=NULL,result_json=NULL,attempt_count=0,updated_at=?
    WHERE ${condition} AND ${manualMatchGuard} AND ${bundleGuard}
  `);
  const timestamp = now().toISOString();
  const args = ['not_found', 'unresolved'].includes(mode) ? [timestamp] : [timestamp, mode];
  const changed = repository.transaction(() => statement.run(...args).changes);
  return { queued: Number(changed) };
}
