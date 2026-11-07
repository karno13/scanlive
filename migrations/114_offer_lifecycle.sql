-- Offer lifecycle: when an offer stops appearing in scans, its own page is checked. "sold" (Vinted
-- shows "Sprzedane"), "reserved" and "unavailable" (page gone) record when the change was seen;
-- the last observed price stays as the closest known sale price. Collected now for later analysis.
ALTER TABLE offers ADD COLUMN availability_checked_at TEXT;
ALTER TABLE offers ADD COLUMN availability_changed_at TEXT;
CREATE INDEX idx_offers_lifecycle ON offers(availability, availability_checked_at, last_seen_at);
