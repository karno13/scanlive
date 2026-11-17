-- The owner's verdict on an "Okazje" entry (deals.mjs): was the deal real? Measures how often the
-- list is right. The price, worth and confidence at the time of the verdict are kept, because the
-- list itself is recomputed and an offer can stop being a deal later.
CREATE TABLE deal_verdicts (
  offer_id TEXT PRIMARY KEY REFERENCES offers(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('good','wrong_match','condition','overvalued')),
  price INTEGER CHECK (price IS NULL OR price > 0),
  worth INTEGER CHECK (worth IS NULL OR worth > 0),
  confidence TEXT CHECK (confidence IS NULL OR confidence IN ('high','medium','low','none')),
  created_at TEXT NOT NULL
) STRICT;
