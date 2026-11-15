-- When the listing page of an offer was last read for its delivery price (shipping-backfill.mjs).
-- Each page is read for it once: a page without a price block is not read again and again.
ALTER TABLE offers ADD COLUMN shipping_checked_at TEXT;
