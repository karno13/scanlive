-- What a source says about a listing besides title and price. A listing that disappears cannot be
-- read again, so these are kept from the first sight. Money in grosze, like current_price.
ALTER TABLE offers ADD COLUMN condition_text TEXT CHECK (condition_text IS NULL OR length(condition_text) <= 200);
ALTER TABLE offers ADD COLUMN condition_class TEXT CHECK (condition_class IS NULL OR condition_class IN ('new','very_good','good','satisfactory','unknown'));
ALTER TABLE offers ADD COLUMN buyer_fee INTEGER CHECK (buyer_fee IS NULL OR buyer_fee >= 0);
ALTER TABLE offers ADD COLUMN shipping_cost INTEGER CHECK (shipping_cost IS NULL OR shipping_cost >= 0);
-- The source's own seller id (Vinted user id, Empik merchant id). seller_name only for shops.
ALTER TABLE offers ADD COLUMN seller_id TEXT CHECK (seller_id IS NULL OR length(seller_id) <= 100);
ALTER TABLE offers ADD COLUMN seller_name TEXT CHECK (seller_name IS NULL OR length(seller_name) <= 200);
ALTER TABLE offers ADD COLUMN seller_business INTEGER CHECK (seller_business IS NULL OR seller_business IN (0,1));
ALTER TABLE offers ADD COLUMN photo_count INTEGER CHECK (photo_count IS NULL OR photo_count >= 0);
-- listed_at is approximate when the source gives only an age ("3 godz."); listed_at_text keeps it.
ALTER TABLE offers ADD COLUMN listed_at TEXT;
ALTER TABLE offers ADD COLUMN listed_at_text TEXT CHECK (listed_at_text IS NULL OR length(listed_at_text) <= 60);
ALTER TABLE offers ADD COLUMN favourite_count INTEGER CHECK (favourite_count IS NULL OR favourite_count >= 0);
ALTER TABLE offers ADD COLUMN view_count INTEGER CHECK (view_count IS NULL OR view_count >= 0);
-- The source's own availability code (Empik "IN_24_H", "PRE_SALE").
ALTER TABLE offers ADD COLUMN source_availability TEXT CHECK (source_availability IS NULL OR length(source_availability) <= 100);
CREATE INDEX idx_offers_seller ON offers(source, seller_id) WHERE seller_id IS NOT NULL;

-- The raw listing object from the result list ('listing') and from the listing page ('detail'),
-- saved at first sight and when it changes (likes and ages do not count as a change).
CREATE TABLE offer_raw_snapshots (
  id INTEGER PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('listing','detail')),
  digest TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (length(payload) <= 16000),
  truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1)),
  observed_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_offer_raw_snapshots_offer ON offer_raw_snapshots(offer_id, kind, observed_at);
