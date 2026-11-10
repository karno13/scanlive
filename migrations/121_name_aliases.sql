-- The operator's list of publisher names and publisher / universe series names with their variant
-- spellings: "Discworld series" is "Świat Dysku", "Insignis Media" is "Insignis". An alias joins the
-- editions under one name (filters, grouping) and applies to editions saved later.
CREATE TABLE name_aliases (
  kind TEXT NOT NULL CHECK (kind IN ('publisher','series')),
  alias_key TEXT NOT NULL CHECK (length(alias_key) BETWEEN 1 AND 300),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 300),
  created_at TEXT NOT NULL,
  PRIMARY KEY (kind, alias_key)
) STRICT;
