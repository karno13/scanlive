-- The seller's description of a listing, read from its page. A set listing names its books there
-- ("Blask fantastyczny / Trzy wiedźmy / Straż! Straż!"), so an empty set can be filled from it.
CREATE TABLE offer_descriptions (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  text TEXT,
  status TEXT NOT NULL CHECK (status IN ('found','missing','error')),
  last_error TEXT,
  fetched_at TEXT NOT NULL
) STRICT;

-- When the set's books were filled in from that description; it is done once, so books the
-- operator removed afterwards do not come back.
ALTER TABLE offer_sets ADD COLUMN composed_from_description_at TEXT;
