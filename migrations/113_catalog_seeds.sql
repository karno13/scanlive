-- Catalogue seeding from the national library: the operator names an author, publisher or title
-- ("Abnett", "Copernicus Corporation") and a slow background pass adds every book BN lists with an
-- ISBN as a reference edition (no offer is assigned). The catalogue then knows the whole universe,
-- so title-only listings can be matched to a known edition and missing volumes are visible.
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
