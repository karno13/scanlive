-- The grouping keys of each work ("blask fantastyczny|pratchett", "orig:light fantastic|pratchett")
-- in an indexed table, so that finding the work of a new edition does not read every work. The
-- keys are computed in JavaScript (work-grouping.mjs: title folding, universe names), so SQL only
-- marks the works whose title, authors or editions' original titles changed; their keys are
-- recomputed before the next lookup.
CREATE TABLE work_keys (
  work_id TEXT NOT NULL REFERENCES works(id) ON UPDATE CASCADE ON DELETE CASCADE,
  key TEXT NOT NULL,
  PRIMARY KEY (work_id, key)
) STRICT, WITHOUT ROWID;
CREATE INDEX idx_work_keys_key ON work_keys(key);

CREATE TABLE work_keys_dirty (work_id TEXT PRIMARY KEY) STRICT, WITHOUT ROWID;
INSERT OR IGNORE INTO work_keys_dirty(work_id) SELECT id FROM works;

CREATE TRIGGER work_keys_work_insert AFTER INSERT ON works
BEGIN
  INSERT OR IGNORE INTO work_keys_dirty(work_id) VALUES (NEW.id);
END;
CREATE TRIGGER work_keys_work_update AFTER UPDATE OF title, authors_json ON works
BEGIN
  INSERT OR IGNORE INTO work_keys_dirty(work_id) VALUES (NEW.id);
END;
CREATE TRIGGER work_keys_edition_insert AFTER INSERT ON editions WHEN NEW.original_title IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO work_keys_dirty(work_id) VALUES (NEW.work_id);
END;
CREATE TRIGGER work_keys_edition_update AFTER UPDATE OF original_title, work_id ON editions
BEGIN
  INSERT OR IGNORE INTO work_keys_dirty(work_id) VALUES (NEW.work_id);
  INSERT OR IGNORE INTO work_keys_dirty(work_id) VALUES (OLD.work_id);
END;
CREATE TRIGGER work_keys_edition_delete AFTER DELETE ON editions
BEGIN
  INSERT OR IGNORE INTO work_keys_dirty(work_id) VALUES (OLD.work_id);
END;
