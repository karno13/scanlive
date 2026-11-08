-- The operator's list of a cycle's volumes, in reading order (one title per volume). It numbers
-- catalogue works whose title matches a listed one and makes "missing volumes" reliable.
CREATE TABLE series_definitions (
  cycle_key TEXT PRIMARY KEY CHECK (length(cycle_key) BETWEEN 1 AND 200),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  titles_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(titles_json)),
  updated_at TEXT NOT NULL
) STRICT;
