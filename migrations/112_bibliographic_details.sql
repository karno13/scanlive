-- Structured bibliographic data read from the BN MARC record instead of BN's flattened fields
-- ("Guymer, David Czuba, Jacek Copernicus Corporation" was author + translator + publisher).
-- People are entities with a role per edition; series statements (490/8XX) are stored as given,
-- classified as universe / publisher line / story cycle, with the volume number.
ALTER TABLE editions ADD COLUMN subtitle TEXT;
ALTER TABLE editions ADD COLUMN original_title TEXT;
ALTER TABLE editions ADD COLUMN original_language TEXT;
ALTER TABLE editions ADD COLUMN page_count INTEGER CHECK (page_count IS NULL OR page_count BETWEEN 1 AND 20000);
ALTER TABLE editions ADD COLUMN height_cm INTEGER CHECK (height_cm IS NULL OR height_cm BETWEEN 1 AND 200);
ALTER TABLE editions ADD COLUMN place_of_publication TEXT;
ALTER TABLE editions ADD COLUMN genres_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(genres_json));

CREATE TABLE persons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 300),
  sort_name TEXT,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE edition_contributors (
  edition_id TEXT NOT NULL REFERENCES editions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES persons(id) ON UPDATE CASCADE ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('author','translator','illustrator','editor','other')),
  position INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  PRIMARY KEY (edition_id, person_id, role)
) STRICT;
CREATE INDEX idx_edition_contributors_person ON edition_contributors(person_id, role);

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
