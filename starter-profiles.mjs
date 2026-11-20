// @ts-check
// Ready scan profiles for the operator's niche (fantasy and game tie-in novels). Created once, only
// when no profile exists yet; afterwards the operator edits or deletes them freely. A newer version
// replaces a stored starter profile only while it still holds exactly an older version (never an
// edited one). Sources without legal access (Allegro, OLX, Dedalus) are left out.
import { putScanProfile, listScanProfiles } from './scan-profiles-api.mjs';
import { ALL_PROFILES, getScanSchedule, saveScanSchedule } from './scan-schedule.mjs';

const KEY = 'starter_profiles_v1';
const UPGRADE_KEY = 'starter_profiles_v2';
export const STARTER_SOURCES = [
  'Vinted',
  'Allegro Lokalnie',
  'Tezeusz.pl',
  'Empik',
  'Skupszop.pl',
  'BlackBooks.pl',
  'Antykwariat Conroy',
  'Szarlatan.pl',
  'Stara Dobra Książka',
  'Antykwariat NWS',
  'Antykwariat Toruń',
  'Kultura Wraca',
  'Bookway',
  'Antykwariat Gryf',
  'Lagano',
  'Vanaheim',
];
// Phrases chosen from saved scan results (2026-11-17): whole universes and their Polish names (the
// universes defined in the catalogue), cycles that bring offers no other phrase finds, and authors.
// Single title words ("Mort", "Piramidy", "Zabójca") are left out: almost all they find is noise.
export const STARTER_PROFILES = [
  {
    name: 'Uniwersa',
    queries: [
      'Warhammer',
      'Warcraft',
      'Forgotten Realms',
      'Zapomniane Krainy',
      'Dragonlance',
      'Świat Dysku',
      'Terry Pratchett',
      'Diablo',
      'StarCraft',
      'Star Wars',
      'Gwiezdne Wojny',
    ],
  },
  {
    name: 'Autorzy i cykle',
    queries: [
      'Dan Abnett',
      'Salvatore',
      'Richard Knaak',
      'Christie Golden',
      'Herezja Horusa',
      'Gotrek i Felix',
      'Przygody Gotreka i Felixa',
      'Duchy Gaunta',
      'Kosmiczny wilk',
      'Czarna Biblioteka',
      'Margaret Weis',
      'Graham McNeill',
      'William King',
      'Drizzt',
    ],
  },
];
// The first version, as created on 2026-11-07: a stored profile equal to it was never edited.
const V1_SOURCES = ['Vinted', 'Allegro Lokalnie', 'Tezeusz.pl', 'Empik', 'Dedalus.pl'];
const V1_QUERIES = {
  Uniwersa: [
    'Warhammer',
    'Warcraft',
    'Forgotten Realms',
    'Dragonlance',
    'Świat Dysku',
    'Terry Pratchett',
  ],
  'Autorzy i cykle': [
    'Dan Abnett',
    'Salvatore',
    'Richard Knaak',
    'Christie Golden',
    'Herezja Horusa',
    'Gotrek i Felix',
    'Czarna Biblioteka',
    'Margaret Weis',
    'Graham McNeill',
    'William King',
  ],
};
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

function mark(repository, key, value, now) {
  repository.database
    .prepare(
      `INSERT INTO app_preferences(key,value_json,updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), new Date(now).toISOString());
}

/** Once: starter profiles that still hold the first version get the current phrases and sources. */
export function upgradeStarterProfiles(repository, { now = Date.now() } = {}) {
  const db = repository.database;
  if (db.prepare('SELECT 1 FROM app_preferences WHERE key=?').get(UPGRADE_KEY))
    return { skipped: true };
  const upgraded = [];
  for (const stored of listScanProfiles(repository)) {
    const next = STARTER_PROFILES.find((profile) => profile.name === stored.name);
    const old = V1_QUERIES[stored.name];
    if (!next || !old || !same(stored.queries, old) || !same(stored.sources, V1_SOURCES)) continue;
    putScanProfile(repository, stored.name, { queries: next.queries, sources: STARTER_SOURCES });
    upgraded.push(stored.name);
  }
  mark(repository, UPGRADE_KEY, { upgraded }, now);
  return { skipped: false, upgraded };
}

// Niche or broad market is still open (docs/PRODUCT-DIRECTION.md): a few broad-market bestsellers,
// Vinted only (the resale reference), so the phrase statistics compare how fast each side sells.
const MEASURE_KEY = 'starter_measure_profile_v1';
export const MEASURE_PROFILE = {
  name: 'Pomiar: szeroki rynek',
  queries: [
    'Fourth Wing',
    'Iron Flame',
    'Onyx Storm',
    'Sarah J. Maas',
    'Wiedźmin',
    'Sapkowski',
    'Brandon Sanderson',
    'Harry Potter',
  ],
  sources: ['Vinted'],
};

/** Once: the broad-market measurement profile; a deleted one is not created again. */
export function addMeasureProfile(repository, { now = Date.now() } = {}) {
  if (repository.database.prepare('SELECT 1 FROM app_preferences WHERE key=?').get(MEASURE_KEY))
    return { skipped: true };
  const { name, ...input } = MEASURE_PROFILE;
  const { created } = putScanProfile(repository, name, input, { onlyIfAbsent: true });
  mark(repository, MEASURE_KEY, { created: Boolean(created) }, now);
  return { skipped: false, created: Boolean(created) };
}

export function ensureStarterProfiles(repository, { now = Date.now() } = {}) {
  const db = repository.database;
  if (db.prepare('SELECT 1 FROM app_preferences WHERE key=?').get(KEY))
    return {
      skipped: true,
      upgrade: upgradeStarterProfiles(repository, { now }),
      measure: addMeasureProfile(repository, { now }),
    };
  const created = [];
  if (!listScanProfiles(repository).length) {
    for (const profile of STARTER_PROFILES) {
      putScanProfile(
        repository,
        profile.name,
        { queries: profile.queries, sources: STARTER_SOURCES },
        { onlyIfAbsent: true },
      );
      created.push(profile.name);
    }
    if (addMeasureProfile(repository, { now }).created) created.push(MEASURE_PROFILE.name);
    // A nightly rhythm: every profile in turn, one every 12 hours, only while the app runs.
    const hasSchedule = db.prepare("SELECT 1 FROM app_preferences WHERE key='scan_schedule'").get();
    if (!hasSchedule)
      saveScanSchedule(repository, { enabled: true, profile: ALL_PROFILES, everyHours: 12 }, now);
  }
  mark(repository, KEY, { created, schedule: getScanSchedule(repository).profile || null }, now);
  // A fresh install already has the current version: nothing to upgrade later.
  mark(repository, UPGRADE_KEY, { upgraded: [] }, now);
  // An operator who already had own profiles gets no starter profile, also not this one.
  if (!created.length) mark(repository, MEASURE_KEY, { created: false }, now);
  return { skipped: false, created };
}
