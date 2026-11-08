-- Games Workshop rulebooks and foreign editions get their own review reason (game-material.mjs).
-- Offers already waiting without an ISBN whose title looks like one go through the resolver once
-- more (no network: offers without ISBN are decided locally).
UPDATE identification_jobs
SET status='queued', run_after=NULL, lease_token=NULL, lease_expires_at=NULL, last_error=NULL,
    result_json=NULL, attempt_count=0
WHERE status='review_required' AND json_valid(result_json)
  AND json_extract(result_json,'$.reason[0]') IN ('no_isbn_evidence','isbn_not_found_in_metadata_sources')
  AND EXISTS (SELECT 1 FROM offers o WHERE o.id=identification_jobs.offer_id AND (
       lower(o.original_title) LIKE '%codex%' OR lower(o.original_title) LIKE '%battletome%'
    OR lower(o.original_title) LIKE '%rulebook%' OR lower(o.original_title) LIKE '%arcane journal%'
    OR lower(o.original_title) LIKE '%handbook%' OR lower(o.original_title) LIKE '%getting started%'
    OR lower(o.original_title) LIKE '%chapter approved%' OR lower(o.original_title) LIKE '%dawnbringers%'
    OR lower(o.original_title) LIKE '%english%' OR lower(o.original_title) LIKE '%angielsk%'
    OR lower(o.original_title) LIKE '%(eng)%' OR lower(o.original_title) LIKE '%white dwarf%'))
  AND NOT EXISTS (SELECT 1 FROM offer_matches m WHERE m.offer_id=identification_jobs.offer_id
       AND m.status='active' AND m.method IN ('manual','legacy_manual'))
  AND NOT EXISTS (SELECT 1 FROM offer_sets s WHERE s.offer_id=identification_jobs.offer_id);
