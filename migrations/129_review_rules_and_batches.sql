-- Rejection rules ("odrzucaj takie zawsze"): by the seller, by a phrase in the title, or by a price
-- threshold. Every rejection a rule makes is a review_decisions row with
-- created_by 'rejection_rule:<id>', so it is visible in "Ostatnie decyzje" and can be undone there.
-- A deleted rule keeps its row (deleted_at) so those decisions still name it.
CREATE TABLE rejection_rules (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('seller', 'phrase', 'price_above', 'price_below')),
  -- Seller rules: the marketplace the seller id belongs to. Other rules: NULL (every source).
  source TEXT CHECK (source IS NULL OR length(source) <= 100),
  -- Seller id, folded phrase, or a price in grosze.
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 200),
  -- What the operator saw when making the rule (seller name, the phrase as typed).
  label TEXT CHECK (label IS NULL OR length(label) <= 200),
  created_from_offer_id TEXT REFERENCES offers(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;
CREATE UNIQUE INDEX idx_rejection_rules_live ON rejection_rules(kind, coalesce(source, ''), value)
  WHERE deleted_at IS NULL;

-- Decisions taken together (batch approval in "Szybkie" and "Do dodania"). Each offer still gets
-- its own review_decisions row; this only groups them, so the whole batch can be undone at once.
CREATE TABLE review_batches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('quick', 'add')),
  created_at TEXT NOT NULL
) STRICT;
CREATE TABLE review_batch_decisions (
  batch_id TEXT NOT NULL REFERENCES review_batches(id) ON DELETE CASCADE,
  decision_id TEXT NOT NULL UNIQUE REFERENCES review_decisions(id),
  PRIMARY KEY (batch_id, decision_id)
) STRICT;

-- Sets: "Nie interesuje mnie" straight from the list. Reversible ("Przywróć" clears it).
ALTER TABLE offer_sets ADD COLUMN dismissed_at TEXT;
