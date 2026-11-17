-- BookFlip: current SQLite schema (generated, do not edit).
-- All migrations up to 136_offers_first_seen_index.sql applied to an empty database.
-- Regenerate after adding a migration: node scripts/dump-schema.mjs

-- app_preferences
CREATE TABLE app_preferences (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  updated_at TEXT NOT NULL
) STRICT;

-- buyback_quotes
CREATE TABLE buyback_quotes (
  source TEXT NOT NULL CHECK (source IN ('skupksiazek')),
  isbn13 TEXT NOT NULL CHECK (length(isbn13) = 13),
  status TEXT NOT NULL CHECK (status IN ('priced','manual','not_bought','error')),
  price_pln REAL CHECK (price_pln IS NULL OR price_pln >= 0),
  title TEXT,
  message TEXT,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (source, isbn13)
) STRICT;

-- buyback_settings
CREATE TABLE buyback_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  auto INTEGER NOT NULL CHECK (auto IN (0,1)),
  updated_at TEXT NOT NULL
) STRICT;

-- catalog_seeds
CREATE TABLE catalog_seeds (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('author','publisher','title')),
  query TEXT NOT NULL CHECK (length(trim(query)) BETWEEN 2 AND 120),
  publisher_filter TEXT NOT NULL DEFAULT '' CHECK (length(publisher_filter) <= 120),
  polish_only INTEGER NOT NULL DEFAULT 1 CHECK (polish_only IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','paused','error')),
  next_url TEXT,
  pages INTEGER NOT NULL DEFAULT 0,
  records_seen INTEGER NOT NULL DEFAULT 0,
  editions_created INTEGER NOT NULL DEFAULT 0,
  already_known INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT,
  UNIQUE (kind, query, publisher_filter)
) STRICT;

-- catalog_work_merges
CREATE TABLE catalog_work_merges (
  source_id TEXT PRIMARY KEY REFERENCES works(id),
  target_id TEXT NOT NULL REFERENCES works(id),
  created_at TEXT NOT NULL,
  CHECK(source_id<>target_id)
) STRICT;

-- distinct_work_pairs
CREATE TABLE distinct_work_pairs (
  decision_id TEXT NOT NULL,
  work_a TEXT NOT NULL REFERENCES works(id) ON UPDATE CASCADE ON DELETE CASCADE,
  work_b TEXT NOT NULL REFERENCES works(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_by TEXT NOT NULL DEFAULT 'local_user',
  created_at TEXT NOT NULL,
  undone_at TEXT,
  PRIMARY KEY (decision_id, work_a, work_b),
  CHECK (work_a < work_b)
) STRICT;
CREATE INDEX idx_distinct_work_pairs_live ON distinct_work_pairs(work_a, work_b) WHERE undone_at IS NULL;

-- edition_contributors
CREATE TABLE edition_contributors (
  edition_id TEXT NOT NULL REFERENCES editions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES persons(id) ON UPDATE CASCADE ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('author','translator','illustrator','editor','other')),
  position INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  PRIMARY KEY (edition_id, person_id, role)
) STRICT;
CREATE INDEX idx_edition_contributors_person ON edition_contributors(person_id, role);

-- edition_field_fills
CREATE TABLE edition_field_fills (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  field TEXT NOT NULL CHECK (field IN ('publisher', 'publication_year')),
  old_value TEXT,
  new_value TEXT NOT NULL,
  source TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'auto_edition_gaps_v1',
  created_at TEXT NOT NULL,
  undone_at TEXT
) STRICT;
CREATE INDEX idx_edition_field_fills_batch ON edition_field_fills(batch_id);
CREATE INDEX idx_edition_field_fills_edition ON edition_field_fills(edition_id);

-- edition_gap_checks
CREATE TABLE edition_gap_checks (
  edition_id TEXT PRIMARY KEY REFERENCES editions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('filled', 'nothing', 'error')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1)
) STRICT;

-- edition_identifiers
CREATE TABLE edition_identifiers (
  id INTEGER PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  scheme TEXT NOT NULL CHECK (scheme IN ('isbn10','isbn13','open_library','bn','other')),
  normalized_value TEXT NOT NULL CHECK (length(normalized_value) BETWEEN 1 AND 300),
  source TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','historical_unverified','manual','verified')),
  created_at TEXT NOT NULL,
  UNIQUE (scheme, normalized_value),
  UNIQUE (edition_id, scheme, normalized_value)
) STRICT;
CREATE INDEX idx_edition_identifiers_edition ON edition_identifiers(edition_id);

-- edition_series
CREATE TABLE edition_series (
  edition_id TEXT NOT NULL REFERENCES editions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 300),
  normalized_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('universe','publisher_line','cycle')),
  volume INTEGER CHECK (volume IS NULL OR volume BETWEEN 0 AND 10000),
  position INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  PRIMARY KEY (edition_id, normalized_name)
) STRICT;
CREATE INDEX idx_edition_series_name ON edition_series(normalized_name, volume);

-- edition_variant_overrides
CREATE TABLE edition_variant_overrides (
  edition_id TEXT PRIMARY KEY REFERENCES editions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  variant_key TEXT NOT NULL CHECK (length(variant_key) BETWEEN 1 AND 200),
  updated_at TEXT NOT NULL
) STRICT;

-- editions
CREATE TABLE editions (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL REFERENCES works(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  legacy_id TEXT UNIQUE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  publisher TEXT,
  publication_year INTEGER CHECK (publication_year IS NULL OR publication_year BETWEEN 1400 AND 2100),
  language TEXT,
  binding TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','historical_unverified','manual','verified')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, subtitle TEXT, original_title TEXT, original_language TEXT, page_count INTEGER CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 20000), height_cm INTEGER CHECK (height_cm IS NULL OR height_cm BETWEEN 1 AND 200), place_of_publication TEXT, genres_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(genres_json)), is_unknown INTEGER NOT NULL DEFAULT 0 CHECK (is_unknown IN (0,1))) STRICT;
CREATE INDEX idx_editions_unknown ON editions(work_id) WHERE is_unknown=1;
CREATE INDEX idx_editions_work ON editions(work_id);
CREATE TRIGGER work_keys_edition_delete AFTER DELETE ON editions
BEGIN
  INSERT OR IGNORE INTO work_keys_dirty(work_id) VALUES (OLD.work_id);
END;
CREATE TRIGGER work_keys_edition_insert AFTER INSERT ON editions WHEN NEW.original_title IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO work_keys_dirty(work_id) VALUES (NEW.work_id);
END;
CREATE TRIGGER work_keys_edition_update AFTER UPDATE OF original_title, work_id ON editions
BEGIN
  INSERT OR IGNORE INTO work_keys_dirty(work_id) VALUES (NEW.work_id);
  INSERT OR IGNORE INTO work_keys_dirty(work_id) VALUES (OLD.work_id);
END;

-- external_isbn_lookups
CREATE TABLE external_isbn_lookups (
  source TEXT NOT NULL CHECK (source IN ('lubimyczytac')),
  isbn TEXT NOT NULL CHECK (length(isbn) BETWEEN 10 AND 13),
  status TEXT NOT NULL CHECK (status IN ('found','not_found','error')),
  record_json TEXT CHECK (record_json IS NULL OR json_valid(record_json)),
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (source, isbn)
) STRICT;

-- external_record_links
CREATE TABLE external_record_links (
  id INTEGER PRIMARY KEY,
  external_record_id TEXT NOT NULL REFERENCES external_records(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  work_id TEXT REFERENCES works(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  edition_id TEXT REFERENCES editions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  linked_at TEXT NOT NULL,
  UNIQUE (external_record_id, work_id),
  UNIQUE (external_record_id, edition_id),
  CHECK (work_id IS NOT NULL OR edition_id IS NOT NULL)
) STRICT;
CREATE INDEX idx_external_record_links_edition
  ON external_record_links(edition_id) WHERE edition_id IS NOT NULL;
CREATE INDEX idx_external_record_links_work
  ON external_record_links(work_id) WHERE work_id IS NOT NULL;

-- external_records
CREATE TABLE external_records (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('bn','open_library','legacy','other')),
  external_id TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK (record_type IN ('work','edition','unknown')),
  work_id TEXT REFERENCES works(id) ON UPDATE CASCADE ON DELETE SET NULL,
  edition_id TEXT REFERENCES editions(id) ON UPDATE CASCADE ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'found' CHECK (status IN ('found','not_found','temporary_error','conflict')),
  payload_json TEXT CHECK (payload_json IS NULL OR json_valid(payload_json)),
  payload_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (provider, external_id, payload_hash)
) STRICT;
CREATE INDEX idx_external_records_edition ON external_records(edition_id) WHERE edition_id IS NOT NULL;
CREATE INDEX idx_external_records_lookup ON external_records(provider, external_id, fetched_at DESC);
CREATE INDEX idx_external_records_work ON external_records(work_id) WHERE work_id IS NOT NULL;
CREATE TRIGGER external_records_immutable_delete
BEFORE DELETE ON external_records
BEGIN
  SELECT RAISE(ABORT, 'external_records are immutable');
END;
CREATE TRIGGER external_records_immutable_update
BEFORE UPDATE ON external_records
BEGIN
  SELECT RAISE(ABORT, 'external_records are immutable');
END;

-- identification_jobs
CREATE TABLE identification_jobs (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  job_type TEXT NOT NULL DEFAULT 'identify_edition',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','retry_wait','review_required','completed','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  run_after TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  UNIQUE (offer_id, job_type)
) STRICT;
CREATE INDEX idx_identification_jobs_claim
  ON identification_jobs(status, run_after, lease_expires_at, created_at);

-- metadata_evidence
CREATE TABLE metadata_evidence (
  id TEXT PRIMARY KEY,
  work_id TEXT REFERENCES works(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  edition_id TEXT REFERENCES editions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  offer_id TEXT REFERENCES offers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  external_record_id TEXT REFERENCES external_records(id) ON UPDATE CASCADE ON DELETE SET NULL,
  field_name TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  classification TEXT NOT NULL CHECK (classification IN ('structured','labelled_description','unlabelled_description','ocr','uncertain','legacy')),
  source_type TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','historical_unverified','manual','verified','conflict')),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (work_id IS NOT NULL OR edition_id IS NOT NULL OR offer_id IS NOT NULL)
) STRICT;
CREATE INDEX idx_metadata_evidence_edition ON metadata_evidence(edition_id) WHERE edition_id IS NOT NULL;
CREATE INDEX idx_metadata_evidence_offer ON metadata_evidence(offer_id) WHERE offer_id IS NOT NULL;
CREATE INDEX idx_metadata_evidence_work ON metadata_evidence(work_id) WHERE work_id IS NOT NULL;
CREATE TRIGGER metadata_evidence_immutable_delete
BEFORE DELETE ON metadata_evidence BEGIN
  SELECT RAISE(ABORT, 'METADATA_EVIDENCE_IMMUTABLE');
END;
CREATE TRIGGER metadata_evidence_immutable_update
BEFORE UPDATE ON metadata_evidence BEGIN
  SELECT RAISE(ABORT, 'METADATA_EVIDENCE_IMMUTABLE');
END;

-- metadata_lookup_cache
CREATE TABLE metadata_lookup_cache (
  source TEXT NOT NULL CHECK (source IN ('bn', 'open_library')),
  lookup_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('found', 'not_found')),
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  payload_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (source, lookup_key)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_metadata_lookup_cache_expires_at
  ON metadata_lookup_cache(expires_at);

-- metric_snapshots
CREATE TABLE metric_snapshots (
  day TEXT NOT NULL CHECK (length(day) = 10),
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 60),
  value REAL NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (day, key)
) STRICT, WITHOUT ROWID;

-- name_aliases
CREATE TABLE name_aliases (
  kind TEXT NOT NULL CHECK (kind IN ('publisher','series')),
  alias_key TEXT NOT NULL CHECK (length(alias_key) BETWEEN 1 AND 300),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 300),
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, alias_key)
) STRICT;

-- offer_descriptions
CREATE TABLE offer_descriptions (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  text TEXT,
  status TEXT NOT NULL CHECK (status IN ('found','missing','error')),
  last_error TEXT,
  fetched_at TEXT NOT NULL
) STRICT;

-- offer_editions
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

-- offer_enrichment
CREATE TABLE offer_enrichment (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('isbn_found','no_isbn','error')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts >= 1),
  attempted_at TEXT NOT NULL,
  isbn TEXT,
  facts_json TEXT CHECK(facts_json IS NULL OR json_valid(facts_json)),
  last_error TEXT
) STRICT;
CREATE INDEX idx_offer_enrichment_outcome ON offer_enrichment(outcome, attempted_at);

-- offer_matches
CREATE TABLE offer_matches (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  method TEXT NOT NULL CHECK (method IN ('manual','legacy_manual','legacy_isbn','structured_isbn','metadata','external_record')),
  status TEXT NOT NULL CHECK (status IN ('active','review_required','superseded','rejected')),
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  reason TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_offer_matches_edition_status ON offer_matches(edition_id, status);
CREATE INDEX idx_offer_matches_offer_time ON offer_matches(offer_id, valid_from DESC);
CREATE UNIQUE INDEX uq_offer_matches_active ON offer_matches(offer_id) WHERE status = 'active';

-- offer_price_history
CREATE TABLE offer_price_history (
  id INTEGER PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  price INTEGER NOT NULL CHECK (price > 0),
  observed_at TEXT NOT NULL,
  UNIQUE (offer_id, price, observed_at)
) STRICT;
CREATE INDEX idx_offer_price_history_offer_time ON offer_price_history(offer_id, observed_at);

-- offer_queries
CREATE TABLE offer_queries (
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  query TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (offer_id, query)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_offer_queries_query ON offer_queries(query, offer_id);

-- offer_raw_snapshots
CREATE TABLE offer_raw_snapshots (
  id INTEGER PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('listing','detail')),
  digest TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (length(payload) <= 16000),
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
  observed_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_offer_raw_snapshots_offer ON offer_raw_snapshots(offer_id, kind, observed_at);

-- offer_relists
CREATE TABLE offer_relists (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  previous_offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('same_seller_title','same_seller_isbn','manual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','undone')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (offer_id <> previous_offer_id)
) STRICT;
CREATE INDEX idx_offer_relists_previous ON offer_relists(previous_offer_id);

-- offer_scenarios
CREATE TABLE offer_scenarios (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
  purchase REAL CHECK(purchase IS NULL OR purchase BETWEEN 0 AND 100000000),
  shipping REAL CHECK(shipping IS NULL OR shipping BETWEEN 0 AND 100000000),
  other REAL CHECK(other IS NULL OR other BETWEEN 0 AND 100000000),
  resale REAL CHECK(resale IS NULL OR resale BETWEEN 0 AND 100000000),
  actual_purchase REAL CHECK(actual_purchase IS NULL OR actual_purchase BETWEEN 0 AND 100000000),
  updated_at TEXT NOT NULL
) STRICT;

-- offer_set_editions
CREATE TABLE offer_set_editions (
  offer_id TEXT NOT NULL REFERENCES offer_sets(offer_id) ON UPDATE CASCADE ON DELETE CASCADE,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  added_at TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 10000), resale_price REAL CHECK(resale_price IS NULL OR resale_price BETWEEN 0 AND 100000000),
  PRIMARY KEY (offer_id, edition_id)
) STRICT;
CREATE INDEX idx_offer_set_editions_edition ON offer_set_editions(edition_id);

-- offer_set_unknown_items
CREATE TABLE offer_set_unknown_items (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offer_sets(offer_id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 300),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK(quantity BETWEEN 1 AND 10000)
) STRICT;
CREATE INDEX idx_set_unknown_offer ON offer_set_unknown_items(offer_id);

-- offer_sets
CREATE TABLE offer_sets (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, composition_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(composition_confirmed IN (0,1)), composed_from_description_at TEXT, dismissed_at TEXT) STRICT;

-- offer_status_history
CREATE TABLE offer_status_history (
  id INTEGER PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('seen','not_seen','available','reserved','sold','unavailable','unknown')),
  via TEXT NOT NULL CHECK (via IN ('scan','check','backfill')),
  observed_at TEXT NOT NULL,
  UNIQUE (offer_id, status, observed_at)
) STRICT;
CREATE INDEX idx_offer_status_history_offer ON offer_status_history(offer_id, observed_at);

-- offer_workspace
CREATE TABLE offer_workspace (
 offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
 watched INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0,1)),
 purchase_status TEXT NOT NULL DEFAULT 'watching' CHECK (purchase_status IN ('watching','check','negotiating','bought','rejected')),
 target_price REAL CHECK (target_price IS NULL OR (target_price >= 0 AND target_price <= 100000000)),
 note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
 updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_offer_workspace_watched ON offer_workspace(watched,purchase_status);

-- offers
CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  legacy_id TEXT UNIQUE,
  source TEXT NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 100),
  external_offer_id TEXT,
  normalized_url TEXT NOT NULL,
  original_title TEXT NOT NULL DEFAULT '' CHECK (length(original_title) <= 500),
  current_price INTEGER CHECK (current_price IS NULL OR current_price > 0),
  currency TEXT NOT NULL DEFAULT 'PLN' CHECK (length(currency) = 3),
  availability TEXT NOT NULL DEFAULT 'unconfirmed',
  language TEXT,
  observed_isbn TEXT,
  matched_queries_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(matched_queries_json)),
  first_seen_at TEXT,
  last_seen_at TEXT,
  seen_count INTEGER NOT NULL DEFAULT 0 CHECK (seen_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, image_url TEXT CHECK (image_url IS NULL OR (length(image_url) <= 1000 AND image_url LIKE 'https://%')), availability_checked_at TEXT, availability_changed_at TEXT, condition_text TEXT CHECK (condition_text IS NULL OR length(condition_text) <= 200), condition_class TEXT CHECK (condition_class IS NULL OR condition_class IN ('new','very_good','good','satisfactory','unknown')), buyer_fee INTEGER CHECK (buyer_fee IS NULL OR buyer_fee >= 0), shipping_cost INTEGER CHECK (shipping_cost IS NULL OR shipping_cost >= 0), seller_id TEXT CHECK (seller_id IS NULL OR length(seller_id) <= 100), seller_name TEXT CHECK (seller_name IS NULL OR length(seller_name) <= 200), seller_business INTEGER CHECK (seller_business IS NULL OR seller_business IN (0,1)), photo_count INTEGER CHECK (photo_count IS NULL OR photo_count >= 0), listed_at TEXT, listed_at_text TEXT CHECK (listed_at_text IS NULL OR length(listed_at_text) <= 60), favourite_count INTEGER CHECK (favourite_count IS NULL OR favourite_count >= 0), view_count INTEGER CHECK (view_count IS NULL OR view_count >= 0), source_availability TEXT CHECK (source_availability IS NULL OR length(source_availability) <= 100), shipping_checked_at TEXT) STRICT;
CREATE INDEX idx_offers_first_seen ON offers(first_seen_at);
CREATE INDEX idx_offers_lifecycle ON offers(availability, availability_checked_at, last_seen_at);
CREATE INDEX idx_offers_seller ON offers(source, seller_id) WHERE seller_id IS NOT NULL;
CREATE UNIQUE INDEX uq_offers_source_external
  ON offers(source, external_offer_id) WHERE external_offer_id IS NOT NULL;
CREATE UNIQUE INDEX uq_offers_source_url
  ON offers(source, normalized_url) WHERE external_offer_id IS NULL;
CREATE TRIGGER offer_queries_after_insert AFTER INSERT ON offers
BEGIN
  INSERT OR IGNORE INTO offer_queries(offer_id, query, position)
    SELECT NEW.id, q.value, q.key
    FROM json_each(CASE WHEN json_valid(NEW.matched_queries_json) THEN NEW.matched_queries_json ELSE '[]' END) q
    WHERE q.type = 'text';
END;
CREATE TRIGGER offer_queries_after_update AFTER UPDATE OF matched_queries_json ON offers
WHEN NEW.matched_queries_json IS NOT OLD.matched_queries_json
BEGIN
  DELETE FROM offer_queries WHERE offer_id = NEW.id;
  INSERT OR IGNORE INTO offer_queries(offer_id, query, position)
    SELECT NEW.id, q.value, q.key
    FROM json_each(CASE WHEN json_valid(NEW.matched_queries_json) THEN NEW.matched_queries_json ELSE '[]' END) q
    WHERE q.type = 'text';
END;

-- persons
CREATE TABLE persons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 300),
  sort_name TEXT,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;

-- rejection_rules
CREATE TABLE rejection_rules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('seller', 'phrase', 'price_above', 'price_below')),
  -- Seller rules: the marketplace the seller id belongs to. Other rules: NULL (every source).
  source TEXT CHECK (source IS NULL OR length(source) <= 100),
  -- Seller id, folded phrase, or a price in grosze.
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 200),
  -- What the operator saw when making the rule (seller name, the phrase as typed).
  label TEXT CHECK (label IS NULL OR length(label) <= 200),
  created_from_offer_id TEXT REFERENCES offers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;
CREATE UNIQUE INDEX idx_rejection_rules_live ON rejection_rules(kind, coalesce(source, ''), value)
  WHERE deleted_at IS NULL;

-- removed_works
CREATE TABLE removed_works (
  work_id TEXT PRIMARY KEY REFERENCES works(id) ON UPDATE CASCADE ON DELETE CASCADE,
  title TEXT NOT NULL,
  removed_at TEXT NOT NULL
) STRICT;

-- review_batch_decisions
CREATE TABLE review_batch_decisions (
  batch_id TEXT NOT NULL REFERENCES review_batches(id) ON DELETE CASCADE,
  decision_id TEXT NOT NULL UNIQUE REFERENCES review_decisions(id),
  PRIMARY KEY (batch_id, decision_id)
) STRICT;

-- review_batches
CREATE TABLE review_batches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('quick', 'add')),
  created_at TEXT NOT NULL
) STRICT;

-- review_decisions
CREATE TABLE "review_decisions" (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES identification_jobs(id) ON UPDATE CASCADE ON DELETE SET NULL,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  edition_id TEXT REFERENCES editions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('approved','proposal_rejected','not_book','excluded','requeued')),
  reason TEXT,
  created_by TEXT NOT NULL DEFAULT 'local_user',
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_review_decisions_job_time ON review_decisions(job_id, created_at DESC) WHERE job_id IS NOT NULL;
CREATE INDEX idx_review_decisions_offer_time ON review_decisions(offer_id, created_at DESC);
CREATE TRIGGER review_decisions_immutable_delete
BEFORE DELETE ON review_decisions BEGIN
  SELECT RAISE(ABORT, 'REVIEW_DECISIONS_IMMUTABLE');
END;
CREATE TRIGGER review_decisions_immutable_update
BEFORE UPDATE ON review_decisions BEGIN
  SELECT RAISE(ABORT, 'REVIEW_DECISIONS_IMMUTABLE');
END;

-- review_revisions
CREATE TABLE review_revisions (
  id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL UNIQUE REFERENCES review_decisions(id),
  created_at TEXT NOT NULL
) STRICT;

-- scan_json_mirror_outbox
CREATE TABLE scan_json_mirror_outbox (
 id TEXT PRIMARY KEY,
 snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
 scanned_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','conflict')),
 created_at TEXT NOT NULL,
 completed_at TEXT
) STRICT;
CREATE INDEX idx_scan_json_mirror_outbox_pending ON scan_json_mirror_outbox(status,created_at) WHERE status='pending';

-- scan_offer_results
CREATE TABLE scan_offer_results (
  scanned_at TEXT NOT NULL REFERENCES scan_runs(scanned_at) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  is_new INTEGER NOT NULL CHECK(is_new IN (0,1)),
  price_changed INTEGER NOT NULL CHECK(price_changed IN (0,1)),
  PRIMARY KEY(scanned_at,offer_id)
) STRICT;
CREATE INDEX idx_scan_offer_results_offer ON scan_offer_results(offer_id,scanned_at DESC);

-- scan_profiles
CREATE TABLE scan_profiles (
 name TEXT PRIMARY KEY CHECK(length(trim(name)) BETWEEN 1 AND 60),
 queries_json TEXT NOT NULL CHECK(json_valid(queries_json)),
 sources_json TEXT NOT NULL CHECK(json_valid(sources_json)),
 updated_at TEXT NOT NULL
) STRICT;

-- scan_runs
CREATE TABLE scan_runs (
 scanned_at TEXT PRIMARY KEY,
 summary_json TEXT NOT NULL CHECK (json_valid(summary_json)),
 created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_scan_runs_latest ON scan_runs(scanned_at DESC);

-- schema_migrations
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
 ) STRICT;

-- series_definitions
CREATE TABLE series_definitions (
  cycle_key TEXT PRIMARY KEY CHECK (length(cycle_key) BETWEEN 1 AND 200),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  titles_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(titles_json)),
  updated_at TEXT NOT NULL
) STRICT;

-- source_health
CREATE TABLE source_health (
  source TEXT PRIMARY KEY,
  last_checked_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error TEXT,
  status TEXT NOT NULL
) STRICT;

-- title_proposals
CREATE TABLE title_proposals (
  job_id TEXT PRIMARY KEY REFERENCES identification_jobs(id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  computed_at TEXT NOT NULL,
  queries_json TEXT NOT NULL CHECK(json_valid(queries_json)),
  candidates_json TEXT NOT NULL CHECK(json_valid(candidates_json)),
  best_isbn TEXT,
  best_score REAL,
  confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low','none'))
) STRICT;
CREATE INDEX idx_title_proposals_confidence ON title_proposals(confidence, best_score DESC);

-- universes
CREATE TABLE universes (
  name TEXT PRIMARY KEY CHECK (length(trim(name)) BETWEEN 1 AND 100),
  names_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(names_json) AND json_type(names_json)='array'),
  lines_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(lines_json) AND json_type(lines_json)='array'),
  markers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(markers_json) AND json_type(markers_json)='array'),
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
) STRICT;

-- vinted_detail_cache
CREATE TABLE vinted_detail_cache (
  offer_url TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  isbn TEXT,
  expires_at INTEGER NOT NULL,
  fetched_at TEXT NOT NULL
, shipping_cost INTEGER CHECK (shipping_cost IS NULL OR shipping_cost >= 0)) STRICT;
CREATE INDEX idx_vinted_detail_cache_expiry ON vinted_detail_cache(expires_at);

-- work_keys
CREATE TABLE work_keys (
  work_id TEXT NOT NULL REFERENCES works(id) ON UPDATE CASCADE ON DELETE CASCADE,
  key TEXT NOT NULL,
  PRIMARY KEY (work_id, key)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_work_keys_key ON work_keys(key);

-- work_keys_dirty
CREATE TABLE work_keys_dirty (work_id TEXT PRIMARY KEY) STRICT, WITHOUT ROWID;

-- work_series_annotations
CREATE TABLE work_series_annotations (
  work_id TEXT PRIMARY KEY REFERENCES works(id) ON DELETE CASCADE,
  series TEXT NOT NULL CHECK (length(trim(series)) BETWEEN 1 AND 120),
  volume INTEGER NOT NULL CHECK (volume BETWEEN 1 AND 10000),
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_work_series_annotations_series ON work_series_annotations(series,volume);

-- work_universe_overrides
CREATE TABLE work_universe_overrides (
  work_id TEXT PRIMARY KEY REFERENCES works(id) ON UPDATE CASCADE ON DELETE CASCADE,
  universe TEXT NOT NULL CHECK (length(trim(universe)) BETWEEN 1 AND 80),
  updated_at TEXT NOT NULL
) STRICT;

-- works
CREATE TABLE works (
  id TEXT PRIMARY KEY,
  legacy_id TEXT UNIQUE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  normalized_title TEXT,
  authors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(authors_json)),
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified','historical_unverified','manual','verified')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER work_keys_work_insert AFTER INSERT ON works
BEGIN
  INSERT OR IGNORE INTO work_keys_dirty(work_id) VALUES (NEW.id);
END;
CREATE TRIGGER work_keys_work_update AFTER UPDATE OF title, authors_json ON works
BEGIN
  INSERT OR IGNORE INTO work_keys_dirty(work_id) VALUES (NEW.id);
END;
