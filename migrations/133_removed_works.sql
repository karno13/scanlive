-- "Usuń z katalogu": a work the operator removed (junk outside the collected genre). It is hidden
-- from every list with its editions; its offers are rejected (one review decision each, created_by
-- 'catalog_removal:<work id>') and new offers that resolve to its editions are rejected too.
-- Nothing is deleted: review decisions are immutable, and restoring the work brings it all back.
CREATE TABLE removed_works (
  work_id TEXT PRIMARY KEY REFERENCES works(id) ON UPDATE CASCADE ON DELETE CASCADE,
  title TEXT NOT NULL,
  removed_at TEXT NOT NULL
) STRICT;
