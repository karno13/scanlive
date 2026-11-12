-- One value per day and measure of "Dziś" (automatic recognition, age of the oldest decision,
-- complete editions, confirmed availability), so that the trend can be shown. Written by
-- catalog-measures.mjs from SQL on the same database; nothing here is an input to decisions.
CREATE TABLE metric_snapshots (
  day TEXT NOT NULL CHECK (length(day) = 10),
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 60),
  value REAL NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (day, key)
) STRICT, WITHOUT ROWID;
