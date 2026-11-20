-- A new deal announced to the owner (deal-alerts.mjs): one row per offer, so the same deal is
-- announced once. Price, worth, saving and the 30-day sale chance as they were at the alert;
-- seen_at is set when the owner has looked at it.
CREATE TABLE deal_alerts (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
  price INTEGER NOT NULL CHECK (price > 0),
  worth INTEGER NOT NULL CHECK (worth > 0),
  saving INTEGER NOT NULL,
  chance REAL CHECK (chance IS NULL OR chance BETWEEN 0 AND 1),
  alerted_at TEXT NOT NULL,
  seen_at TEXT
) STRICT;
CREATE INDEX idx_deal_alerts_unseen ON deal_alerts(alerted_at) WHERE seen_at IS NULL;
