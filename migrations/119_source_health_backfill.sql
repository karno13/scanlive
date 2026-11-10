-- Until 2026-11-08 a scan in which only some phrases of a source answered (Allegro Lokalnie: the
-- first few, then HTTP 429) did not record a success, so such sources were shown as "never worked",
-- left unchecked and skipped by scheduled scans. The last scan with an answered phrase is taken from
-- the saved scan summaries, or from the newest listing of that source.
UPDATE source_health
SET last_success_at = COALESCE(
  (SELECT max(r.scanned_at)
     FROM scan_runs r,
          json_each(CASE WHEN json_valid(r.summary_json) THEN r.summary_json ELSE '{}' END, '$.context.results') j
    WHERE json_extract(j.value, '$.source') = source_health.source
      AND json_extract(j.value, '$.status') IN ('ok', 'partial')),
  (SELECT max(o.last_seen_at) FROM offers o WHERE o.source = source_health.source))
WHERE last_success_at IS NULL;

-- HTTP 429 only means "slower, please": such a source is rate limited, not dead.
UPDATE source_health SET status = 'limited' WHERE status = 'failed' AND last_error = 'SOURCE_HTTP_429';
