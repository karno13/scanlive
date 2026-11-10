-- ISBNs no bibliographic source knows (new Copernicus editions: 978-83-61656…) looked up by title
-- on lubimyczytac.pl; a record counts only when its own ISBN equals the offer's. Both answers are
-- kept so the site is not asked again for a month.
CREATE TABLE external_isbn_lookups (
  source TEXT NOT NULL CHECK (source IN ('lubimyczytac')),
  isbn TEXT NOT NULL CHECK (length(isbn) BETWEEN 10 AND 13),
  status TEXT NOT NULL CHECK (status IN ('found','not_found','error')),
  record_json TEXT CHECK (record_json IS NULL OR json_valid(record_json)),
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (source, isbn)
) STRICT;
