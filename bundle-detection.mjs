// @ts-check
// A listing that sells several books often shows the ISBN of only one of them ("DragonLance MEGA
// zestaw Trylogia Bohaterowie + Legendy + Kroniki", ISBN of one volume). Assigning that ISBN would
// record a six-book offer as one edition, so such listings go to review where the operator marks
// them as a set. Deliberately conservative: "Trylogia Sigmara" alone may be a one-volume omnibus.
import { fold, titleTokens } from './title-proposals.mjs';

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
  const dashed = raw
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[–—]/g, '-');
  return PATTERNS.some((pattern) => pattern.test(text) || pattern.test(dashed));
}

/**
 * Catalogue-aware check: a listing naming two or more different books of the catalogue sells
 * several books ("Bezgłośna klinga, Grzbiet świata, Sługa reliktu", "Fourth Wing i Iron Flame").
 * Returns the matched work ids. Ignored: one-word titles (too common), titles that are an author's
 * name ("Terry Pratchett : życie…") and titles that are the cycle of another matched book
 * ("Wojna starożytnych: Studnia wieczności" is one book of the "Wojna starożytnych" trilogy).
 */
export function createCatalogBundleDetector(repository) {
  const db = repository.database;
  const rows = db
    .prepare(
      'SELECT id, title, authors_json FROM works w WHERE NOT EXISTS (SELECT 1 FROM catalog_work_merges x WHERE x.source_id=w.id) AND NOT EXISTS (SELECT 1 FROM removed_works rw WHERE rw.work_id=w.id)',
    )
    .all();
  const parse = (text) => {
    try {
      return JSON.parse(text || '[]');
    } catch {
      return [];
    }
  };
  const authorWords = new Set(
    rows.flatMap((row) => titleTokens(parse(row.authors_json).join(' '))),
  );
  const cycles = new Map();
  for (const row of db
    .prepare(
      "SELECT e.work_id, s.name FROM edition_series s JOIN editions e ON e.id=s.edition_id WHERE s.kind='cycle'",
    )
    .all()) {
    if (!cycles.has(row.work_id)) cycles.set(row.work_id, []);
    cycles.get(row.work_id).push(' ' + titleTokens(row.name, { dropBrand: true }).join(' ') + ' ');
  }
  const works = rows
    .map((row) => ({
      id: row.id,
      own: titleTokens(
        String(row.title)
          .split(' / ')[0]
          .split(/\s*:\s*/)[0],
        { dropBrand: true },
      ),
    }))
    .filter((work) => work.own.length >= 2 && !work.own.every((word) => authorWords.has(word)));
  const index = new Map();
  for (const work of works) {
    if (!index.has(work.own[0])) index.set(work.own[0], []);
    index.get(work.own[0]).push(work);
  }
  return (title) => {
    // "Gdyby jednak | Autorka Fourth Wing", "w stylu Fourth Wing": another book named as a reference.
    if (/\b(?:autork|autor[a ]|autorstwa|w stylu|dla fan|fani )/i.test(fold(title) + ' '))
      return [];
    const words = new Set(titleTokens(title, { dropBrand: true }));
    let hits = [...words]
      .flatMap((word) => index.get(word) || [])
      .filter((work) => work.own.every((word) => words.has(word)));
    // "Wrota Baldura II: Cienie Amnu" also contains "Wrota Baldura": keep the longer title only.
    hits = hits.filter(
      (hit) =>
        !hits.some(
          (other) =>
            other !== hit &&
            other.own.length > hit.own.length &&
            hit.own.every((word) => other.own.includes(word)),
        ),
    );
    hits = hits.filter(
      (hit) =>
        !hits.some(
          (other) =>
            other !== hit &&
            (cycles.get(other.id) || []).some((cycle) =>
              cycle.includes(' ' + hit.own.join(' ') + ' '),
            ),
        ),
    );
    const byTitle = new Map(hits.map((hit) => [hit.own.join(' '), hit.id]));
    return byTitle.size >= 2 ? [...byTitle.values()] : [];
  };
}

/**
 * One-time corrections: automatic ISBN assignments of listings that look like sets go back to
 * review. v1: set words ("zestaw", "tomy 1-3"); v2: two catalogue titles in one listing.
 * Manual assignments and offers already marked as sets stay.
 */
export function reviewAutomaticBundleMatches(repository, { now = () => new Date() } = {}) {
  const v1 = requeueAutomaticMatches(repository, 'bundle_review_v1', () => looksLikeBundle, now);
  const v2 = requeueAutomaticMatches(
    repository,
    'bundle_review_v2',
    () => {
      const detect = createCatalogBundleDetector(repository);
      return (title) => detect(title).length >= 2;
    },
    now,
  );
  return { skipped: v1.skipped && v2.skipped, requeued: (v1.requeued || 0) + (v2.requeued || 0) };
}

function requeueAutomaticMatches(repository, key, makeTest, now) {
  const db = repository.database;
  if (db.prepare('SELECT 1 FROM app_preferences WHERE key=?').get(key)) return { skipped: true };
  const at = now().toISOString();
  const test = makeTest();
  const rows = db
    .prepare(
      `SELECT m.id, m.offer_id, o.original_title FROM offer_matches m JOIN offers o ON o.id=m.offer_id
       WHERE m.status='active' AND m.method IN ('structured_isbn','metadata')
         AND NOT EXISTS (SELECT 1 FROM offer_sets s WHERE s.offer_id=m.offer_id)`,
    )
    .all()
    .filter((row) => test(row.original_title));
  repository.transaction(() => {
    for (const row of rows) {
      db.prepare(
        "UPDATE offer_matches SET status='superseded', valid_to=? WHERE id=? AND status='active'",
      ).run(at, row.id);
      db.prepare(
        `UPDATE identification_jobs SET status='queued', run_after=NULL, lease_token=NULL, lease_expires_at=NULL,
           last_error=NULL, result_json=NULL, attempt_count=0, updated_at=? WHERE offer_id=? AND status<>'running'`,
      ).run(at, row.offer_id);
    }
    db.prepare(
      `INSERT INTO app_preferences(key,value_json,updated_at) VALUES(?,?,?)
       ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
    ).run(key, JSON.stringify({ requeued: rows.length }), at);
  });
  return { skipped: false, requeued: rows.length };
}
