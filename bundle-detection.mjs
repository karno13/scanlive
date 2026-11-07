// A listing that sells several books often shows the ISBN of only one of them ("DragonLance MEGA
// zestaw Trylogia Bohaterowie + Legendy + Kroniki", ISBN of one volume). Assigning that ISBN would
// record a six-book offer as one edition, so such listings go to review where the operator marks
// them as a set. Deliberately conservative: "Trylogia Sigmara" alone may be a one-volume omnibus.
import { fold } from './title-proposals.mjs';

const PATTERNS = [
  /\b(?:zestaw|zestawy|zestawie|komplet|kompletu|pakiet|paczka|kolekcja ksiazek)\b/,
  /\b\d{1,3}\s*(?:tomy|tomow|tomach|ksiazki|ksiazek|ksiazkach|czesci|szt|sztuki|sztuk|egz)\b/,
  /\b\d{1,2}\s*x\s+\p{L}/u,
  /\b(?:tomy|tom|t|cz|czesci|ks|ksiegi)\s*\d{1,3}\s*(?:-|do|i)\s*\d{1,3}\b/,
  /\b\d{1,3}\s*(?:-|i)\s*\d{1,3}\s*(?:tom|tomy|czesc|czesci)\b/,
];

export function looksLikeBundle(title) {
  const raw = String(title ?? '');
  // "Czarodzicielstwo + Kosiarz": a plus between words lists several books.
  if (/\p{L}\s*\+\s*\p{L}/u.test(raw)) return true;
  // fold() turns "–" and "-" into spaces; keep the dash visible for ranges ("tomy 1–4").
  const text = fold(raw.replace(/[–—-]/g, ' - ')).replace(/\s+/g, ' ');
  const dashed = raw.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[–—]/g, '-');
  return PATTERNS.some((pattern) => pattern.test(text) || pattern.test(dashed));
}

const BUNDLE_REVIEW_KEY = 'bundle_review_v1';

/**
 * One-time correction: automatic ISBN assignments made before this guard existed for listings
 * that look like sets go back to review. Manual assignments and offers already marked as sets stay.
 */
export function reviewAutomaticBundleMatches(repository, { now = () => new Date() } = {}) {
  const db = repository.database;
  if (db.prepare('SELECT 1 FROM app_preferences WHERE key=?').get(BUNDLE_REVIEW_KEY)) return { skipped: true };
  const at = now().toISOString();
  const rows = db
    .prepare(
      `SELECT m.id, m.offer_id, o.original_title FROM offer_matches m JOIN offers o ON o.id=m.offer_id
       WHERE m.status='active' AND m.method IN ('structured_isbn','metadata')
         AND NOT EXISTS (SELECT 1 FROM offer_sets s WHERE s.offer_id=m.offer_id)`,
    )
    .all()
    .filter((row) => looksLikeBundle(row.original_title));
  repository.transaction(() => {
    for (const row of rows) {
      db.prepare("UPDATE offer_matches SET status='superseded', valid_to=? WHERE id=? AND status='active'").run(at, row.id);
      db.prepare(
        `UPDATE identification_jobs SET status='queued', run_after=NULL, lease_token=NULL, lease_expires_at=NULL,
           last_error=NULL, result_json=NULL, attempt_count=0, updated_at=? WHERE offer_id=? AND status<>'running'`,
      ).run(at, row.offer_id);
    }
    db.prepare(
      `INSERT INTO app_preferences(key,value_json,updated_at) VALUES(?,?,?)
       ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
    ).run(BUNDLE_REVIEW_KEY, JSON.stringify({ requeued: rows.length }), at);
  });
  return { skipped: false, requeued: rows.length };
}
