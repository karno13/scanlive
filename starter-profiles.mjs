// First-run scan profiles for the operator's niche (fantasy and game tie-in novels). Created once,
// only when no profile exists yet; afterwards the operator edits or deletes them freely.
// Allegro (CAPTCHA) and OLX (HTTP 403) block automated reads on every scan, so they are left out.
import { putScanProfile, listScanProfiles } from './scan-profiles-api.mjs';
import { ALL_PROFILES, getScanSchedule, saveScanSchedule } from './scan-schedule.mjs';

const KEY = 'starter_profiles_v1';
export const STARTER_SOURCES = ['Vinted', 'Allegro Lokalnie', 'Tezeusz.pl', 'Empik', 'Dedalus.pl'];
export const STARTER_PROFILES = [
  {
    name: 'Uniwersa',
    queries: [
      'Warhammer',
      'Warcraft',
      'Forgotten Realms',
      'Dragonlance',
      'Świat Dysku',
      'Terry Pratchett',
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
      'Czarna Biblioteka',
      'Margaret Weis',
      'Graham McNeill',
      'William King',
    ],
  },
];

export function ensureStarterProfiles(repository, { now = Date.now() } = {}) {
  const db = repository.database;
  if (db.prepare('SELECT 1 FROM app_preferences WHERE key=?').get(KEY)) return { skipped: true };
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
    // A nightly rhythm: every profile in turn, one every 12 hours, only while the app runs.
    const hasSchedule = db.prepare("SELECT 1 FROM app_preferences WHERE key='scan_schedule'").get();
    if (!hasSchedule)
      saveScanSchedule(repository, { enabled: true, profile: ALL_PROFILES, everyHours: 12 }, now);
  }
  db.prepare(
    `INSERT INTO app_preferences(key,value_json,updated_at) VALUES(?,?,?)
     ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
  ).run(
    KEY,
    JSON.stringify({ created, schedule: getScanSchedule(repository).profile || null }),
    new Date(now).toISOString(),
  );
  return { skipped: false, created };
}
