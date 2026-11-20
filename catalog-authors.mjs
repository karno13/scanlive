// @ts-check
// Katalog → "Filtry katalogu" → "Autor": every author of the catalogue's books, with one name per
// person whatever the spelling ("Rowling, J. K.", "J. K. Rowling", "Rowling, J.K" are one author),
// and the works of one author for the works list. Authors come from the work (authors_json) and
// from the BN contributors of its editions (role author), so a book known only one way still counts.
import { fold } from './title-proposals.mjs';

const LIVE_WORK =
  'NOT EXISTS (SELECT 1 FROM catalog_work_merges cm WHERE cm.source_id=w.id) AND NOT EXISTS (SELECT 1 FROM removed_works rw WHERE rw.work_id=w.id)';

/** "Pratchett, Terry (1948-2015)" → "Terry Pratchett"; "J. K. Rowling" stays. */
export function authorName(raw) {
  const text = String(raw ?? '')
    .replace(/\(\s*\d{3,4}\s*-?\s*(?:\d{3,4})?\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;.]+|[\s,;]+$/g, '')
    .trim();
  const swapped = text.match(/^([^,]+),\s*([^,]+)$/);
  return swapped ? `${swapped[2].trim()} ${swapped[1].trim()}` : text;
}

/** One key per person: case, accents, dots and the "Surname, Name" order do not matter. */
export const authorKey = (raw) => fold(authorName(raw));

/** @param {{ database: import('node:sqlite').DatabaseSync }} repository */
function authorsByWork(repository) {
  const db = repository.database;
  /** @type {Map<string, Set<string>>} */
  const byWork = new Map();
  /** @type {Map<string, Map<string, number>>} spellings per key, to show the most used one */
  const spellings = new Map();
  const add = (workId, raw) => {
    const name = authorName(raw);
    const key = fold(name);
    if (!key) return;
    (byWork.get(workId) ?? byWork.set(workId, new Set()).get(workId))?.add(key);
    const names = spellings.get(key) ?? spellings.set(key, new Map()).get(key);
    names?.set(name, (names.get(name) ?? 0) + 1);
  };
  for (const row of db
    .prepare(
      `SELECT w.id AS workId, j.value AS name FROM works w, json_each(CASE WHEN json_valid(w.authors_json) THEN w.authors_json ELSE '[]' END) j
       WHERE ${LIVE_WORK} AND j.type='text'`,
    )
    .all())
    add(String(row.workId), row.name);
  for (const row of db
    .prepare(
      `SELECT DISTINCT e.work_id AS workId, p.name FROM editions e JOIN works w ON w.id=e.work_id
         JOIN edition_contributors c ON c.edition_id=e.id AND c.role='author' JOIN persons p ON p.id=c.person_id
       WHERE ${LIVE_WORK}`,
    )
    .all())
    add(String(row.workId), row.name);
  return { byWork, spellings };
}

/**
 * Authors with their number of works, most works first.
 * @param {{ database: import('node:sqlite').DatabaseSync }} repository
 */
export function catalogAuthors(repository) {
  const { byWork, spellings } = authorsByWork(repository);
  /** @type {Map<string, number>} */
  const works = new Map();
  for (const keys of byWork.values())
    for (const key of keys) works.set(key, (works.get(key) ?? 0) + 1);
  const items = [...works].map(([key, count]) => {
    const names = [...(spellings.get(key) ?? new Map())].sort((a, b) => b[1] - a[1]);
    return { name: names[0]?.[0] ?? key, works: count };
  });
  items.sort((a, b) => b.works - a.works || a.name.localeCompare(b.name, 'pl'));
  return { items };
}

/**
 * Ids of the works by the author named (any spelling).
 * @param {{ database: import('node:sqlite').DatabaseSync }} repository
 * @param {string} name
 */
export function authorWorkIds(repository, name) {
  const key = authorKey(name);
  if (!key) return [];
  const ids = [];
  for (const [workId, keys] of authorsByWork(repository).byWork)
    if (keys.has(key)) ids.push(workId);
  return ids;
}
