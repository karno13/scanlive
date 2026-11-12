-- Missing publisher / year of editions filled from metadata sources (edition-gaps.mjs). Only empty
-- fields of editions the operator did not edit by hand are filled. Every fill is a row, so a whole
-- batch (batch_id) can be undone; the undo restores old_value only when the field still holds new_value.
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

-- When an edition was last asked about (so the same gap is not asked every few minutes).
CREATE TABLE edition_gap_checks (
  edition_id TEXT PRIMARY KEY REFERENCES editions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  checked_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('filled', 'nothing', 'error')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 1)
) STRICT;
