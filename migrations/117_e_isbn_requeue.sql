-- The national ISBN registry (e-ISBN) is now asked when BN and Open Library do not know an ISBN.
-- Offers waiting with "ISBN unknown to every source" go through the resolver once more.
UPDATE identification_jobs
SET status='queued', run_after=NULL, lease_token=NULL, lease_expires_at=NULL, last_error=NULL,
    result_json=NULL, attempt_count=0
WHERE status='review_required' AND json_valid(result_json)
  AND json_extract(result_json,'$.reason[0]') IN ('isbn_not_found_in_metadata_sources','metadata_invalid_or_incomplete')
  AND NOT EXISTS (SELECT 1 FROM offer_matches m WHERE m.offer_id=identification_jobs.offer_id
       AND m.status='active' AND m.method IN ('manual','legacy_manual'))
  AND NOT EXISTS (SELECT 1 FROM offer_sets s WHERE s.offer_id=identification_jobs.offer_id);
