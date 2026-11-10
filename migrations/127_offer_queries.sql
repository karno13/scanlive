-- The scan phrases that found each offer, as rows instead of a JSON array searched with json_each
-- on every query (marking unseen offers, phrase statistics). matched_queries_json stays the source
-- (it keeps the order); triggers keep this table equal to it for every writer.
CREATE TABLE offer_queries (
  offer_id TEXT NOT NULL REFERENCES offers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  query TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (offer_id, query)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_offer_queries_query ON offer_queries(query, offer_id);

INSERT OR IGNORE INTO offer_queries(offer_id, query, position)
  SELECT o.id, q.value, q.key FROM offers o,
    json_each(CASE WHEN json_valid(o.matched_queries_json) THEN o.matched_queries_json ELSE '[]' END) q
  WHERE q.type = 'text';

CREATE TRIGGER offer_queries_after_insert AFTER INSERT ON offers
BEGIN
  INSERT OR IGNORE INTO offer_queries(offer_id, query, position)
    SELECT NEW.id, q.value, q.key
    FROM json_each(CASE WHEN json_valid(NEW.matched_queries_json) THEN NEW.matched_queries_json ELSE '[]' END) q
    WHERE q.type = 'text';
END;

CREATE TRIGGER offer_queries_after_update AFTER UPDATE OF matched_queries_json ON offers
WHEN NEW.matched_queries_json IS NOT OLD.matched_queries_json
BEGIN
  DELETE FROM offer_queries WHERE offer_id = NEW.id;
  INSERT OR IGNORE INTO offer_queries(offer_id, query, position)
    SELECT NEW.id, q.value, q.key
    FROM json_each(CASE WHEN json_valid(NEW.matched_queries_json) THEN NEW.matched_queries_json ELSE '[]' END) q
    WHERE q.type = 'text';
END;
