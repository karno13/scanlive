// Groups editions of the same book under one work. BN records carry no work identifier, so without
// this every ISBN (every reprint, every publisher) became its own work. The key is deliberately
// strict - same main title AND same first author - because a wrong merge is worse than a missed one.
import { fold } from './title-proposals.mjs';
import {
  brandOnlyPattern,
  universePrefix,
  universeSuffix,
  universesVersion,
} from './universes.mjs';

/** "Para w ruch / Raising steam, Discworld series ; t. 40" -> "Para w ruch" */
export function mainTitle(title) {
  const text = String(title ?? '');
  // "World of Warcraft: Illidan" and "Illidan / World of Warcraft" are the same work: a universe
  // prefix followed by ":" or "." is cover branding, not the title (the author must still match).
  // A universe in brackets after the title ("Blask fantastyczny (ŚWIAT DYSKU)") is branding too.
  const unbranded = text.replace(universePrefix(), '').replace(universeSuffix(), '');
  return (fold(unbranded.split(' / ')[0]).length >= 3 ? unbranded : text)
    .split(' / ')[0]
    .split(' : ')[0]
    .split(' ; ')[0]
    .trim();
}

/** Surname of the first author: BN "Pratchett, Terry (1948-2015) ..." or "Terry Pratchett". */
export function firstSurname(authors) {
  const first = []
    .concat(authors ?? [])
    .map(String)
    .find((value) => value.trim());
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

/** Second key: the original title ("Light fantastic") names one work across translations and publishers. */
export function originalKey(originalTitle, authors) {
  // The whole title: "World of Warcraft : chronicle. Volume 2" must not join volume 1.
  const name = fold(originalTitle);
  const surname = firstSurname(authors);
  if (name.length < 4 || surname.length < 2 || brandOnlyPattern().test(name)) return null;
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

// work_keys (migration 128) holds the keys of every work. Triggers mark works whose title, authors
// or editions changed; their keys are recomputed here before a lookup. A change of the key rules
// (KEYS_VERSION) or of the universe names (they shape mainTitle) recomputes all of them.
const KEYS_VERSION = 1;
const KEYS_STAMP = 'work_keys_version';

/** Recomputes the keys of changed works; returns how many works were refreshed. */
export function refreshWorkKeys(repository) {
  const db = repository.database;
  const wanted = JSON.stringify(`${KEYS_VERSION}:${universesVersion()}`);
  const stamp = db
    .prepare('SELECT value_json FROM app_preferences WHERE key=?')
    .get(KEYS_STAMP)?.value_json;
  return repository.transaction(() => {
    if (stamp !== wanted) {
      db.prepare('INSERT OR IGNORE INTO work_keys_dirty(work_id) SELECT id FROM works').run();
      db.prepare(
        'INSERT INTO app_preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at',
      ).run(KEYS_STAMP, wanted, new Date().toISOString());
    }
    const dirty = db
      .prepare('SELECT work_id FROM work_keys_dirty')
      .all()
      .map((row) => row.work_id);
    if (!dirty.length) return 0;
    const work = db.prepare('SELECT id, title, authors_json FROM works WHERE id=?');
    const originals = db.prepare(
      'SELECT DISTINCT original_title FROM editions WHERE work_id=? AND original_title IS NOT NULL',
    );
    const clear = db.prepare('DELETE FROM work_keys WHERE work_id=?');
    const add = db.prepare('INSERT OR IGNORE INTO work_keys(work_id,key) VALUES(?,?)');
    const done = db.prepare('DELETE FROM work_keys_dirty WHERE work_id=?');
    for (const id of dirty) {
      clear.run(id);
      const row = work.get(id);
      if (row) {
        const authors = parseAuthors(row.authors_json);
        const keys = [
          workKey(row.title, authors),
          ...originals.all(id).map((edition) => originalKey(edition.original_title, authors)),
        ];
        for (const key of new Set(keys.filter(Boolean))) add.run(id, key);
      }
      done.run(id);
    }
    return dirty.length;
  });
}

/** An existing work that is the same book as (title, authors[, original title]), or null. */
export function findWorkByKey(repository, title, authors, originalTitle = null) {
  const wanted = [
    ...new Set([workKey(title, authors), originalKey(originalTitle, authors)].filter(Boolean)),
  ];
  if (!wanted.length) return null;
  refreshWorkKeys(repository);
  const matches = repository.database
    .prepare(
      `SELECT w.id, w.title, w.authors_json, w.created_at,
         (SELECT count(*) FROM editions e WHERE e.work_id = w.id) AS editions,
         (SELECT count(*) FROM offer_matches m JOIN editions e ON e.id = m.edition_id
            WHERE e.work_id = w.id AND m.status = 'active') AS offers
       FROM works w
       WHERE w.id IN (SELECT work_id FROM work_keys WHERE key IN (SELECT value FROM json_each(?)))
         AND NOT EXISTS (SELECT 1 FROM catalog_work_merges x WHERE x.source_id = w.id)`,
    )
    .all(JSON.stringify(wanted));
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
  // A work without author never has a key. When its title equals the title of exactly one work
  // with an author, it is offered in that group (the operator still decides on the merge).
  const byTitle = new Map();
  for (const work of works)
    if (workKeys.get(work.id).length) {
      const title = fold(mainTitle(work.title));
      byTitle.set(
        title,
        byTitle.has(title) && byTitle.get(title) !== root(work.id) ? null : root(work.id),
      );
    }
  for (const work of works) {
    if (workKeys.get(work.id).length) continue;
    const title = fold(mainTitle(work.title));
    const target = title.length >= 3 ? byTitle.get(title) : null;
    if (!target) continue;
    parent.set(work.id, target);
    workKeys.set(work.id, ['title:' + title]);
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
        (a, b) =>
          (b.authors.length > 0) - (a.authors.length > 0) ||
          b.offers - a.offers ||
          b.editions - a.editions ||
          String(a.createdAt).localeCompare(String(b.createdAt)),
      );
      const key = ranked[0].keys.find((entry) => !entry.startsWith('orig:')) ?? ranked[0].keys[0];
      return { key, targetId: ranked[0].id, works: ranked.map(({ keys: _keys, ...work }) => work) };
    })
    .sort((a, b) => b.works.length - a.works.length || a.key.localeCompare(b.key));
}
