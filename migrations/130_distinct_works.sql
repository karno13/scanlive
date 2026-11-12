-- "To różne książki": the operator says that works the duplicate finder groups are not one book.
-- One decision (decision_id) holds every pair of the group; undone_at makes it reversible
-- ("Ostatnie decyzje" -> "Cofnij"). The duplicate finder skips a group whose every pair is distinct.
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
