-- Universes as data instead of code (Katalog → „Wydawcy i serie”). names: how the universe itself is
-- written; lines: publisher lines tied to it (branding, not the universe); markers: cycles and heroes
-- that tell the universe but are part of a title. The rows below are the lists the code used until now.
CREATE TABLE universes (
  name TEXT PRIMARY KEY CHECK (length(trim(name)) BETWEEN 1 AND 100),
  names_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(names_json) AND json_type(names_json)='array'),
  lines_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(lines_json) AND json_type(lines_json)='array'),
  markers_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(markers_json) AND json_type(markers_json)='array'),
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
) STRICT;
INSERT INTO universes(name, names_json, lines_json, markers_json, position, updated_at) VALUES
  ('Świat Dysku', '["Discworld","Discworld series"]', '[]', '[]', 0, '2026-11-10T00:00:00.000Z'),
  ('Warcraft', '["World of Warcraft","Blizzard Legends"]', '[]', '[]', 1, '2026-11-10T00:00:00.000Z'),
  ('Warhammer', '["Warhammer 40 000","Warhammer 40K","WH40K","W40K","40K","40 000","Warhammer Fantasy","Warhammer Chronicles","Warhammer Age of Sigmar","Age of Sigmar"]', '["Black Library","Czarna Biblioteka"]', '["Herezja Horusa","Horus Heresy","Horus"]', 2, '2026-11-10T00:00:00.000Z'),
  ('Dragonlance', '["Dragonlance Saga"]', '[]', '[]', 3, '2026-11-10T00:00:00.000Z'),
  ('Forgotten Realms', '["Zapomniane Krainy"]', '[]', '["Drizzt"]', 4, '2026-11-10T00:00:00.000Z'),
  ('Diablo', '[]', '[]', '[]', 5, '2026-11-10T00:00:00.000Z'),
  ('StarCraft', '[]', '[]', '[]', 6, '2026-11-10T00:00:00.000Z'),
  ('Star Wars', '[]', '[]', '[]', 7, '2026-11-10T00:00:00.000Z');
