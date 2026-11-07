// Groups editions of the same book under one work. BN records carry no work identifier, so without
// this every ISBN (every reprint, every publisher) became its own work. The key is deliberately
// strict - same main title AND same first author - because a wrong merge is worse than a missed one.
import { fold } from './title-proposals.mjs';

const UNIVERSE_PREFIX =
  /^\s*(?:world of warcraft|warcraft|warhammer(?: 40[ ,.]?000| 40k)?|dragonlance|forgotten realms|świat dysku)\s*[:.]\s+/i;

/** "Para w ruch / Raising steam, Discworld series ; t. 40" -> "Para w ruch" */
export function mainTitle(title) {
  const text = String(title ?? '');
  // "World of Warcraft: Illidan" and "Illidan / World of Warcraft" are the same work: a universe
  // prefix followed by ":" or "." is cover branding, not the title (the author must still match).
  const unbranded = text.replace(UNIVERSE_PREFIX, '');
  return (fold(unbranded.split(' / ')[0]).length >= 3 ? unbranded : text)
    .split(' / ')[0]
    .split(' : ')[0]
    .split(' ; ')[0]
    .trim();
}

/** Surname of the first author: BN "Pratchett, Terry (1948-2015) ..." or "Terry Pratchett". */
export function firstSurname(authors) {
  const first = [].concat(authors ?? []).map(String).find((value) => value.trim());
  if (!first) return '';
  const text = first.replace(/\([^)]*\)/g, ' ').trim();
  const surname = text.includes(',') ? text.split(',')[0] : text.split(/\s+/).at(-1);
  return fold(surname);
}

export function workKey(title, authors) {
  const name = fold(mainTitle(title));
  const surname = firstSurname(authors);
  if (name.length < 3 || surname.length < 2) return null;
  return `${name}|${surname}`;
}

function parseAuthors(value) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function liveWorks(repository) {
  return repository.database
    .prepare(
      `SELECT w.id, w.title, w.authors_json, w.created_at,
         (SELECT count(*) FROM editions e WHERE e.work_id = w.id) AS editions,
         (SELECT count(*) FROM offer_matches m JOIN editions e ON e.id = m.edition_id
            WHERE e.work_id = w.id AND m.status = 'active') AS offers
       FROM works w
       WHERE NOT EXISTS (SELECT 1 FROM catalog_work_merges x WHERE x.source_id = w.id)`,
    )
    .all();
}

const BRAND_ONLY_ORIGINAL = /^(?:world of warcraft|warcraft|warhammer(?: 40 ?000)?|discworld(?: series)?|dragonlance|forgotten realms)$/;

/** Second key: the original title ("Light fantastic") names one work across translations and publishers. */
export function originalKey(originalTitle, authors) {
  // The whole title: "World of Warcraft : chronicle. Volume 2" must not join volume 1.
  const name = fold(originalTitle);
  const surname = firstSurname(authors);
  if (name.length < 4 || surname.length < 2 || BRAND_ONLY_ORIGINAL.test(name)) return null;
  return `orig:${name}|${surname}`;
}

function originalTitlesByWork(repository) {
  const map = new Map();
  const hasColumn = repository.database
    .prepare("SELECT 1 FROM pragma_table_info('editions') WHERE name='original_title'")
    .get();
  if (!hasColumn) return map;
  for (const row of repository.database
    .prepare('SELECT work_id, original_title FROM editions WHERE original_title IS NOT NULL')
    .all()) {
    if (!map.has(row.work_id)) map.set(row.work_id, new Set());
    map.get(row.work_id).add(row.original_title);
  }
  return map;
}

function keysOf(work, originals) {
  const authors = parseAuthors(work.authors_json);
  return [
    workKey(work.title, authors),
    ...[...(originals.get(work.id) ?? [])].map((title) => originalKey(title, authors)),
  ].filter(Boolean);
}

/** An existing work that is the same book as (title, authors[, original title]), or null. */
export function findWorkByKey(repository, title, authors, originalTitle = null) {
  const wanted = new Set([workKey(title, authors), originalKey(originalTitle, authors)].filter(Boolean));
  if (!wanted.size) return null;
  const originals = originalTitlesByWork(repository);
  const matches = liveWorks(repository).filter((work) => keysOf(work, originals).some((key) => wanted.has(key)));
  // Ambiguous (several works already share the key): leave the decision to the operator.
  return matches.length === 1 ? matches[0] : null;
}

/** Groups of works that look like the same book, largest first, with a suggested target. */
export function findDuplicateWorkGroups(repository) {
  const originals = originalTitlesByWork(repository);
  const works = liveWorks(repository);
  // Union of works sharing any key (same Polish title, or same original title, with the same author).
  const parent = new Map(works.map((work) => [work.id, work.id]));
  const root = (id) => {
    while (parent.get(id) !== id) id = parent.get(id);
    return id;
  };
  const byKey = new Map();
  const workKeys = new Map();
  for (const work of works) {
    const keys = keysOf(work, originals);
    workKeys.set(work.id, keys);
    for (const key of keys) {
      if (byKey.has(key)) parent.set(root(work.id), root(byKey.get(key)));
      else byKey.set(key, work.id);
    }
  }
  const groups = new Map();
  for (const work of works) {
    if (!workKeys.get(work.id).length) continue;
    const id = root(work.id);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({
      id: work.id,
      title: work.title,
      authors: parseAuthors(work.authors_json),
      editions: Number(work.editions),
      offers: Number(work.offers),
      createdAt: work.created_at,
      keys: workKeys.get(work.id),
    });
  }
  return [...groups.values()]
    .filter((list) => list.length > 1)
    .map((list) => {
      // Keep the work that already carries the most offers, then editions, then the oldest.
      const ranked = [...list].sort(
        (a, b) => b.offers - a.offers || b.editions - a.editions || String(a.createdAt).localeCompare(String(b.createdAt)),
      );
      const key = ranked[0].keys.find((entry) => !entry.startsWith('orig:')) ?? ranked[0].keys[0];
      return { key, targetId: ranked[0].id, works: ranked.map(({ keys: _keys, ...work }) => work) };
    })
    .sort((a, b) => b.works.length - a.works.length || a.key.localeCompare(b.key));
}
