// @ts-check
// One spelling per publisher. BN writes 'Dom Wydawniczy "Rebis"', '"ISA"', 'Zysk i S-ka. Wydaw';
// Open Library and listings write 'Proszynski Media', 'REBIS', 'Wydawnictwo MAG'. Different
// spellings of one publisher split the publisher filter and make editions look different.

const fold = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Folded spelling (after the generic clean-up below) → the name shown in the catalogue.
const ALIASES = new Map(
  Object.entries({
    isa: 'ISA',
    ias: 'ISA', // a BN typo of ISA (Warszawa), the publisher of Forgotten Realms and Dragonlance
    mag: 'Mag',
    rebis: 'Dom Wydawniczy Rebis',
    'dom wydawniczy rebis': 'Dom Wydawniczy Rebis',
    proszynski: 'Prószyński i S-ka',
    'proszynski i s ka': 'Prószyński i S-ka',
    'proszynski i ska': 'Prószyński i S-ka',
    'proszynski i spolka': 'Prószyński i S-ka',
    'proszynski i s ka proszynski media': 'Prószyński i S-ka',
    'proszynski media': 'Prószyński Media',
    'zysk i s ka': 'Zysk i S-ka',
    'zysk i ska': 'Zysk i S-ka',
    'fabryka slow': 'Fabryka Słów',
    insignis: 'Insignis',
    'insignis media': 'Insignis',
    filia: 'Filia',
    'grupa wydawnicza filia': 'Filia',
    amber: 'Amber',
    'egmont polska': 'Egmont Polska',
    'copernicus corporation': 'Copernicus Corporation',
    'coprenicus corporation': 'Copernicus Corporation',
    fantastyka: 'Fantastyka',
  }),
);

const EMPTY = new Set(['', 'n a', 'na', 'brak', 'nieznany', 'unknown', 's n']);

// The operator's merges from Katalog → "Wydawcy i serie" (name_aliases), loaded at start-up.
let overrides = new Map();
let overrideKey = (value) => value;
export function setPublisherAliasOverrides(map, keyOf) {
  overrides = map instanceof Map ? map : new Map();
  if (typeof keyOf === 'function') overrideKey = keyOf;
}

/** The catalogue spelling of a publisher name, or null for an empty or placeholder value. */
export function normalizePublisher(value) {
  if (value == null) return null;
  let name = String(value)
    .replace(/["„”“«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s,.;:]+$/, '');
  // Legal forms and BN's "Wydaw" abbreviation say nothing about which publisher it is.
  name = name
    .replace(
      /,?\s+(?:sp\.?\s*z\s*o\.?\s*o\.?|s\.?\s*a\.?|sp\.?\s*j\.?|spółka z ograniczoną odpowiedzialnością)$/i,
      '',
    )
    .replace(/[.\s]+wydaw(?:nictwo|nictwa)?\.?$/i, '')
    .replace(/^wydawnictwo\s+/i, '')
    .trim();
  const key = fold(name);
  if (EMPTY.has(key)) return null;
  const known = ALIASES.get(key) ?? name;
  return (
    overrides.get(overrideKey(value)) ??
    overrides.get(overrideKey(name)) ??
    overrides.get(overrideKey(known)) ??
    known
  );
}

/**
 * Re-spells stored publishers once per start (cheap: one pass over editions). Editions the
 * operator edited by hand keep their spelling.
 */
// Bump when the spelling rules above change: stored publishers are re-spelled once more at start-up.
export const PUBLISHER_RULES_VERSION = 1;
export function normalizeStoredPublishers(repository, { now = () => new Date() } = {}) {
  const db = repository.database;
  const rows = db
    .prepare(
      "SELECT id, publisher FROM editions WHERE publisher IS NOT NULL AND coalesce(verification_status,'')<>'manual'",
    )
    .all();
  const update = db.prepare('UPDATE editions SET publisher=?, updated_at=? WHERE id=?');
  const at = now().toISOString();
  let changed = 0;
  repository.transaction(() => {
    for (const row of rows) {
      const name = normalizePublisher(row.publisher);
      if (name === row.publisher) continue;
      update.run(name, at, row.id);
      changed++;
    }
  });
  return { changed };
}
