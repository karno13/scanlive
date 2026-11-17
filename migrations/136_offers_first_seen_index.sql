-- valuationOptions asks min(first_seen_at) on every list and book page: an index answers it at once.
CREATE INDEX IF NOT EXISTS idx_offers_first_seen ON offers(first_seen_at);
