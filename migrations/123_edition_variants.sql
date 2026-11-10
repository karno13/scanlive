-- An offer can be assigned to a book (work) without choosing which of its editions it is: it goes
-- to the work's "unknown edition", a placeholder edition with no identifiers. The operator can name
-- the edition later; prices of such offers count for the book as a whole.
ALTER TABLE editions ADD COLUMN is_unknown INTEGER NOT NULL DEFAULT 0 CHECK (is_unknown IN (0,1));
CREATE INDEX idx_editions_unknown ON editions(work_id) WHERE is_unknown=1;

-- Price variants group editions that sell for about the same price (same publisher and binding).
-- The grouping is computed; the operator can move an edition to another variant or to its own.
CREATE TABLE edition_variant_overrides (
  edition_id TEXT PRIMARY KEY REFERENCES editions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  variant_key TEXT NOT NULL CHECK (length(variant_key) BETWEEN 1 AND 200),
  updated_at TEXT NOT NULL
) STRICT;
