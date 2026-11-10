// "Tylko polskie wydania": a switch in the scanner form, on by default. With it on, the scan keeps
// only listings that do not name a foreign edition (title markers, Vinted's language field), and an
// offer found to be a foreign edition later (Empik's product page, the offer's own language) is
// rejected at once instead of waiting in "Gry / obce". Every such rejection is a decision in
// "Ostatnie decyzje i poprawianie pomyłek" and can be reopened.

const KEY = 'scan_language_policy';
export const POLISH_ONLY_AUTHOR = 'auto_polish_only';

export function getPolishOnly(repository) {
  try {
    const row = repository.database.prepare('SELECT value_json FROM app_preferences WHERE key=?').get(KEY);
    return row ? JSON.parse(row.value_json).polishOnly !== false : true;
  } catch {
    return true;
  }
}

export function setPolishOnly(repository, polishOnly, { now = () => new Date() } = {}) {
  const value = polishOnly !== false;
  repository.database
    .prepare(
      `INSERT INTO app_preferences(key,value_json,updated_at) VALUES(?,?,?)
       ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
    )
    .run(KEY, JSON.stringify({ polishOnly: value }), now().toISOString());
  const rejected = value ? rejectForeignEditions(repository, { now }).rejected : 0;
  return { polishOnly: value, rejected };
}

/** Review jobs held as foreign editions are rejected while "Tylko polskie wydania" is on. */
export function rejectForeignEditions(repository, { now = () => new Date() } = {}) {
  if (!getPolishOnly(repository)) return { rejected: 0 };
  const db = repository.database;
  const rows = db
    .prepare(
      `SELECT j.id, j.offer_id FROM identification_jobs j
       WHERE j.status='review_required' AND json_valid(j.result_json)
         AND json_extract(j.result_json,'$.reason[0]')='foreign_edition'
         AND NOT EXISTS (SELECT 1 FROM offer_matches m WHERE m.offer_id=j.offer_id AND m.status='active' AND m.method IN ('manual','legacy_manual'))
         AND NOT EXISTS (SELECT 1 FROM offer_sets s WHERE s.offer_id=j.offer_id)`,
    )
    .all();
  if (!rows.length) return { rejected: 0 };
  const at = now().toISOString();
  const reason = 'Wydanie obcojęzyczne — włączone „Tylko polskie wydania”.';
  repository.transaction(() => {
    const decision = db.prepare(
      `INSERT INTO review_decisions(id,job_id,offer_id,edition_id,action,reason,created_by,created_at) VALUES(?,?,?,NULL,'excluded',?,?,?)`,
    );
    const close = db.prepare(
      `UPDATE identification_jobs SET status='completed', run_after=NULL, lease_token=NULL, lease_expires_at=NULL,
         last_error=NULL, result_json=?, updated_at=? WHERE id=?`,
    );
    for (const row of rows) {
      decision.run(`polish_only_${row.id}_${at}`, row.id, row.offer_id, reason, POLISH_ONLY_AUTHOR, at);
      close.run(JSON.stringify({ manualDecision: 'excluded', automatic: true, reason, decidedAt: at }), at, row.id);
    }
  });
  return { rejected: rows.length };
}
