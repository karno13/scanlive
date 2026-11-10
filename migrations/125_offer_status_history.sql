-- Every observed state of an offer with the moment it was observed: first sight and re-sight in a
-- scan ('seen'), missing from a complete scan ('not_seen'), and each check of its page ('available',
-- 'reserved', 'sold', 'unavailable', 'unknown'). A sale then has an interval: between the last time
-- the listing was seen on sale and the check that found it sold.
CREATE TABLE offer_status_history (
  id INTEGER PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('seen','not_seen','available','reserved','sold','unavailable','unknown')),
  via TEXT NOT NULL CHECK (via IN ('scan','check','backfill')),
  observed_at TEXT NOT NULL,
  UNIQUE (offer_id, status, observed_at)
) STRICT;
CREATE INDEX idx_offer_status_history_offer ON offer_status_history(offer_id, observed_at);

-- What is known from before this table: first sight, and the last change found by a check.
INSERT OR IGNORE INTO offer_status_history(offer_id,status,via,observed_at)
  SELECT id,'seen','backfill',first_seen_at FROM offers WHERE first_seen_at IS NOT NULL;
INSERT OR IGNORE INTO offer_status_history(offer_id,status,via,observed_at)
  SELECT id,availability,'backfill',availability_changed_at FROM offers
  WHERE availability IN ('sold','reserved','unavailable','available') AND availability_changed_at IS NOT NULL;

-- A listing taken down and put up again by the same seller (Vinted gives it a new number). The
-- link is a visible, reversible automatic decision: nothing is rejected because of it.
CREATE TABLE offer_relists (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  previous_offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('same_seller_title','same_seller_isbn','manual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','undone')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (offer_id <> previous_offer_id)
) STRICT;
CREATE INDEX idx_offer_relists_previous ON offer_relists(previous_offer_id);
