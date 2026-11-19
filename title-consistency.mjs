// @ts-check
// ISBN ↔ title consistency. Sellers often type the ISBN of a different book (or a scanner reads
// one from "recommended offers"), so an ISBN alone can file "Logik der Forschung" under Warcraft.
// The check is lenient: one shared title word is enough. A shared word that only names the
// universe, its line or cycle, or the author does not tell one book of it from another, so when
// both sides also have title words of their own and none of those agree ("Warcraft Wichry wojny"
// against "Warcraft. Wojna starożytnych"), the listing is held back for review as well.
import { titleTokens, fold } from './title-proposals.mjs';
import { universeSynonyms } from './universes.mjs';

const stem = (token) => token.slice(0, 5);

// Words that say what kind of listing it is, not which book.
const GENERIC = new Set(
  [
    'tom',
    'tomy',
    'tomow',
    'tomie',
    'czesc',
    'czesci',
    'seria',
    'serii',
    'series',
    'cykl',
    'cyklu',
    'zestaw',
    'komplet',
    'kolekcja',
    'pakiet',
    'powiesc',
    'fantasy',
    'fantastyka',
    'opowiadania',
    'antologia',
    'edycja',
    'limitowana',
    'ekskluzywna',
    'specjalna',
  ].map(stem),
);
// Numbers and roman numerals ("40000", "II") are volumes or lines, not titles.
const NUMBER = /^(?:\d+|[ivx]{1,4})$/;

/**
 * Word stems of a text. Names, lines and markers of one universe stand for each other
 * (universes table), so a universe named in the text adds all of them; those stems are also
 * returned as `universe` — they name the universe, not a book of it. A word of a longer name
 * ("świat" of "Świat Dysku") counts as the universe only when the whole name is in the text.
 */
function stems(text) {
  let folded = fold(text);
  const words = ` ${folded} `;
  const universe = new Set();
  for (const group of universeSynonyms())
    if (group.some((name) => name && words.includes(` ${name} `))) {
      folded += ' ' + group.join(' ');
      for (const token of titleTokens(group.join(' '))) universe.add(stem(token));
    }
  const all = new Set(
    titleTokens(folded)
      .filter((token) => !/^\d{1,3}$/.test(token))
      .map(stem),
  );
  return { all, universe };
}

function authorText(authors) {
  if (!authors) return '';
  if (typeof authors === 'string') {
    try {
      return [].concat(JSON.parse(authors)).join(' ');
    } catch {
      return authors;
    }
  }
  return [].concat(authors).join(' ');
}

/**
 * True when the offer title and the catalogue record name different books: no word in common,
 * or only universe / cycle / author words in common while both have other title words that
 * differ. `record`: { title, workTitle?, authors? }. Offers without usable words ("Książka",
 * "zestaw") or with nothing beyond the universe and the author never conflict.
 */
export function titleConflict(offerTitle, record = {}) {
  const offer = stems(offerTitle);
  if (!offer.all.size) return false;
  const authors = stems(authorText(record.authors)).all;
  const known = stems([record.title, record.workTitle].filter(Boolean).join(' '));
  const knownAll = new Set([...known.all, ...authors]);
  if (!knownAll.size) return false;
  const umbrella = (token) =>
    offer.universe.has(token) || known.universe.has(token) || authors.has(token);
  const shared = [...offer.all].filter((token) => knownAll.has(token));
  if (!shared.length) return true;
  if (shared.some((token) => !umbrella(token))) return false;
  const ownOf = (tokens) =>
    [...tokens].filter((token) => !umbrella(token) && !GENERIC.has(token) && !NUMBER.test(token));
  const offerOwn = ownOf(offer.all);
  const knownOwn = ownOf(knownAll);
  if (!offerOwn.length || !knownOwn.length) return false;
  // One word written apart on the other side ("Roleplay" / "Role Play") is still the same word.
  const joined = (text) => fold(text).replace(/ /g, '');
  const offerJoined = joined(offerTitle);
  const knownJoined = joined([record.title, record.workTitle].filter(Boolean).join(' '));
  const fullWords = (text) => titleTokens(text).filter((token) => token.length >= 5);
  const counts = (word) => !umbrella(stem(word)) && !GENERIC.has(stem(word));
  return !(
    fullWords(offerTitle).some((word) => counts(word) && knownJoined.includes(word)) ||
    fullWords([record.title, record.workTitle].filter(Boolean).join(' ')).some(
      (word) => counts(word) && offerJoined.includes(word),
    )
  );
}

/** Active automatic assignments whose offer title shares nothing with the edition. */
export function findTitleConflicts(repository) {
  const rows = repository.database
    .prepare(
      `SELECT m.offer_id, m.edition_id, m.method, o.original_title, o.source, o.normalized_url, o.observed_isbn, o.image_url,
              e.title AS edition_title, e.work_id, w.title AS work_title, w.authors_json
       FROM offer_matches m
       JOIN offers o ON o.id = m.offer_id
       JOIN editions e ON e.id = m.edition_id
       JOIN works w ON w.id = e.work_id
       WHERE m.status = 'active' AND m.method NOT IN ('manual', 'legacy_manual')`,
    )
    .all();
  return rows
    .filter((row) =>
      titleConflict(row.original_title, {
        title: row.edition_title,
        workTitle: row.work_title,
        authors: row.authors_json,
      }),
    )
    .map((row) => ({
      offerId: row.offer_id,
      editionId: row.edition_id,
      workId: row.work_id,
      offerTitle: row.original_title,
      source: row.source,
      url: row.normalized_url,
      isbn: row.observed_isbn,
      editionTitle: row.edition_title,
      workTitle: row.work_title,
    }));
}

/**
 * Operator decision on a suspicious assignment:
 * - "confirm": the ISBN is right after all - the assignment becomes manual and is not flagged again;
 * - "review": the assignment is withdrawn and the offer goes back to the review queue.
 */
export function resolveTitleConflict(repository, input = {}, { now = () => new Date() } = {}) {
  const offerId = String(input.offerId ?? '');
  const action = String(input.action ?? '');
  if (!['confirm', 'review'].includes(action))
    throw Object.assign(Error('INVALID_ACTION'), { statusCode: 400 });
  return repository.transaction(() => {
    const active = repository.database
      .prepare("SELECT * FROM offer_matches WHERE offer_id=? AND status='active'")
      .get(offerId);
    if (!active) throw Object.assign(Error('MATCH_NOT_FOUND'), { statusCode: 404 });
    const at = now().toISOString();
    if (action === 'confirm') {
      repository.assignOfferToEdition(offerId, active.edition_id, {
        id: `title_confirmed_${active.id}`,
        method: 'manual',
        status: 'active',
        reason: 'Potwierdzono ręcznie mimo niezgodnego tytułu ogłoszenia.',
        createdBy: 'local_user',
        at,
      });
      return { offerId, action, editionId: active.edition_id };
    }
    repository.database
      .prepare(
        "UPDATE offer_matches SET status='superseded', valid_to=? WHERE offer_id=? AND status='active'",
      )
      .run(at, offerId);
    const result = JSON.stringify({
      decision: 'review_required',
      reason: ['isbn_title_mismatch'],
      editionId: active.edition_id,
      withdrawnAt: at,
    });
    const job = repository.database
      .prepare(
        "SELECT id FROM identification_jobs WHERE offer_id=? AND job_type='identify_edition'",
      )
      .get(offerId);
    if (job)
      repository.database
        .prepare(
          "UPDATE identification_jobs SET status='review_required', run_after=NULL, lease_token=NULL, lease_expires_at=NULL, last_error=NULL, result_json=?, updated_at=? WHERE id=?",
        )
        .run(result, at, job.id);
    else
      repository.database
        .prepare(
          "INSERT INTO identification_jobs(id, offer_id, job_type, status, attempt_count, created_at, updated_at, result_json) VALUES(?, ?, 'identify_edition', 'review_required', 0, ?, ?, ?)",
        )
        .run(`title_conflict_${offerId}`, offerId, at, at, result);
    return { offerId, action, editionId: active.edition_id };
  });
}
