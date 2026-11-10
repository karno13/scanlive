// Katalog → "Wydawcy i serie": every publisher and publisher / universe series name with the
// number of editions, and the operator's merges of variant spellings ("Discworld series" →
// "Świat Dysku", "Insignis Media" → "Insignis"). A merge renames the stored editions and is kept
// as an alias, so editions saved later from BN, Open Library, e-ISBN or listings use the same name.

import { fold } from './title-proposals.mjs';
import { normalizePublisher, setPublisherAliasOverrides } from './publisher-names.mjs';

const KINDS = new Set(['publisher', 'series']);
const aliasKey = (name) =>
  fold(String(name ?? ''))
    .replace(/\s+/g, ' ')
    .trim();

function aliases(db, kind) {
  return db
    .prepare('SELECT alias_key, name FROM name_aliases WHERE kind=? ORDER BY name, alias_key')
    .all(kind);
}

/** Loads the publisher aliases into normalizePublisher (start-up and after every change). */
export function loadNameAliases(repository) {
  const map = new Map(
    aliases(repository.database, 'publisher').map((row) => [row.alias_key, row.name]),
  );
  setPublisherAliasOverrides(map, aliasKey);
  return map.size;
}

/** Applies every alias to stored editions; cheap, run at start-up and after a merge. */
export function applyNameAliases(repository, { now = () => new Date() } = {}) {
  const db = repository.database;
  const at = now().toISOString();
  let publishers = 0;
  let series = 0;
  repository.transaction(() => {
    for (const row of aliases(db, 'publisher')) {
      for (const edition of db
        .prepare('SELECT id, publisher FROM editions WHERE publisher IS NOT NULL AND publisher<>?')
        .all(row.name))
        if (aliasKey(edition.publisher) === row.alias_key) {
          db.prepare('UPDATE editions SET publisher=?, updated_at=? WHERE id=?').run(
            row.name,
            at,
            edition.id,
          );
          publishers++;
        }
    }
    for (const row of aliases(db, 'series')) {
      const target = fold(row.name);
      if (target === row.alias_key) continue;
      // An edition that already has the target name keeps one row (primary key edition + name).
      const moved = db
        .prepare(
          `UPDATE OR IGNORE edition_series SET name=?, normalized_name=? WHERE kind<>'cycle' AND normalized_name=?`,
        )
        .run(row.name, target, row.alias_key);
      db.prepare(`DELETE FROM edition_series WHERE kind<>'cycle' AND normalized_name=?`).run(
        row.alias_key,
      );
      series += Number(moved.changes);
    }
  });
  return { publishers, series };
}

/** Publishers and publisher / universe series with edition counts and their variant spellings. */
export function listNames(repository) {
  const db = repository.database;
  const variants = (kind) => {
    const byName = new Map();
    for (const row of aliases(db, kind))
      byName.set(row.name, [...(byName.get(row.name) || []), row.alias_key]);
    return byName;
  };
  const publisherVariants = variants('publisher');
  const seriesVariants = variants('series');
  const publishers = db
    .prepare(
      'SELECT publisher AS name, count(*) AS editions FROM editions WHERE publisher IS NOT NULL GROUP BY publisher ORDER BY editions DESC, publisher',
    )
    .all()
    .map((row) => ({
      name: row.name,
      editions: Number(row.editions),
      variants: publisherVariants.get(row.name) || [],
    }));
  const series = db
    .prepare(
      `SELECT min(name) AS name, kind, count(DISTINCT edition_id) AS editions FROM edition_series
       WHERE kind<>'cycle' GROUP BY normalized_name ORDER BY editions DESC, name`,
    )
    .all()
    .map((row) => ({
      name: row.name,
      kind: row.kind,
      editions: Number(row.editions),
      variants: seriesVariants.get(row.name) || [],
    }));
  return { publishers, series };
}

/** Joins `from` into `into` (both existing names): stores the alias and renames the editions. */
export function mergeNames(repository, { kind, from, into } = {}, { now = () => new Date() } = {}) {
  if (!KINDS.has(kind)) throw Object.assign(Error('INVALID_NAME_KIND'), { statusCode: 400 });
  const source = String(from ?? '').trim();
  const target = String(into ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!source || !target || source.length > 300 || target.length > 300)
    throw Object.assign(Error('INVALID_NAME'), { statusCode: 400 });
  const key = aliasKey(source);
  if (!key || key === aliasKey(target))
    throw Object.assign(Error('SAME_NAME'), { statusCode: 400 });
  const at = now().toISOString();
  const db = repository.database;
  repository.transaction(() => {
    // Names that pointed at `from` follow it into `into`.
    db.prepare('UPDATE name_aliases SET name=? WHERE kind=? AND name=?').run(target, kind, source);
    db.prepare(
      `INSERT INTO name_aliases(kind,alias_key,name,created_at) VALUES(?,?,?,?)
       ON CONFLICT(kind,alias_key) DO UPDATE SET name=excluded.name, created_at=excluded.created_at`,
    ).run(kind, key, target, at);
    // The target must not itself be an alias of something else.
    db.prepare('DELETE FROM name_aliases WHERE kind=? AND alias_key=?').run(kind, aliasKey(target));
  });
  if (kind === 'publisher') loadNameAliases(repository);
  const applied = applyNameAliases(repository, { now });
  return {
    kind,
    from: source,
    into: target,
    renamed: kind === 'publisher' ? applied.publishers : applied.series,
  };
}

/** Removes a variant spelling (future editions keep their own spelling again). */
export function removeNameAlias(repository, { kind, alias } = {}) {
  if (!KINDS.has(kind)) throw Object.assign(Error('INVALID_NAME_KIND'), { statusCode: 400 });
  const result = repository.database
    .prepare('DELETE FROM name_aliases WHERE kind=? AND alias_key=?')
    .run(kind, aliasKey(alias));
  if (kind === 'publisher') loadNameAliases(repository);
  return { removed: Number(result.changes) };
}

export { normalizePublisher };
