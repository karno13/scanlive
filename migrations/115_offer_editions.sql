-- Editions the operator created from a listing because no bibliographic source knew the ISBN
-- (often new Polish Warhammer titles that BN has not catalogued yet). They stay 'unverified' and
-- BN is asked again about once a week; when it answers, the edition gets the full record.
CREATE TABLE offer_editions (
  edition_id TEXT PRIMARY KEY REFERENCES editions(id) ON DELETE CASCADE,
  offer_id TEXT REFERENCES offers(id) ON DELETE SET NULL,
  isbn TEXT NOT NULL,
  created_at TEXT NOT NULL,
  checked_at TEXT,
  check_count INTEGER NOT NULL DEFAULT 0 CHECK (check_count >= 0),
  last_outcome TEXT,
  upgraded_at TEXT
) STRICT;
CREATE INDEX idx_offer_editions_check ON offer_editions(upgraded_at, checked_at);

-- Offers held back only because BN described their ISBN more than once go through the resolver
-- once more: it now takes the record when all of them describe the same book.
UPDATE identification_jobs
SET status='queued', run_after=NULL, lease_token=NULL, lease_expires_at=NULL, last_error=NULL,
    result_json=NULL, attempt_count=0
WHERE status='review_required' AND json_valid(result_json)
  AND json_extract(result_json,'$.reason[0]')='multiple_metadata_records'
  AND NOT EXISTS (SELECT 1 FROM offer_matches m WHERE m.offer_id=identification_jobs.offer_id
       AND m.status='active' AND m.method IN ('manual','legacy_manual'))
  AND NOT EXISTS (SELECT 1 FROM offer_sets s WHERE s.offer_id=identification_jobs.offer_id);
