// Structured bibliographic details of catalogue editions: people with roles, series with volume
// numbers, original title, physical description. Read from the BN MARC record kept in
// external_records, so existing editions can be upgraded without asking BN again.
// Operator edits (verification_status 'manual') are never overwritten.
import { createHash } from 'node:crypto';

import { catalogTitle, parseBnMarc, personKey } from './bn-marc.mjs';
import { fold } from './title-proposals.mjs';
import { normalizePublisher } from './publisher-names.mjs';

const UPGRADE_KEY = 'bibliography_upgrade_v1';

function personId(key) {
  return 'person_' + createHash('sha256').update(key).digest('hex').slice(0, 24);
}

function bnPayload(db, editionId) {
  const row = db
    .prepare(
      `SELECT r.payload_json FROM external_records r
       WHERE r.provider='bn' AND r.status='found' AND r.payload_json IS NOT NULL AND (
         r.edition_id=?
         OR r.id IN (SELECT external_record_id FROM external_record_links WHERE edition_id=?)
         OR r.external_id IN (SELECT normalized_value FROM edition_identifiers WHERE edition_id=? AND scheme='bn'))
       ORDER BY r.fetched_at DESC LIMIT 1`,
    )
    .get(editionId, editionId, editionId);
  if (!row) return null;
  try {
    return JSON.parse(row.payload_json);
  } catch {
    return null;
  }
}

function parseAuthors(value) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function upsertPerson(db, person, at) {
  const key = personKey(person.name);
  if (!key) return null;
  const id = personId(key);
  db.prepare(
    `INSERT INTO persons(id,name,sort_name,normalized_name,created_at) VALUES(?,?,?,?,?)
     ON CONFLICT(normalized_name) DO UPDATE SET sort_name=coalesce(persons.sort_name,excluded.sort_name)`,
  ).run(id, person.name, person.sortName ?? null, key, at);
  return db.prepare('SELECT id FROM persons WHERE normalized_name=?').get(key).id;
}

function replaceContributors(db, editionId, people, source, at) {
  db.prepare('DELETE FROM edition_contributors WHERE edition_id=? AND source=?').run(
    editionId,
    source,
  );
  const insert = db.prepare(
    'INSERT OR IGNORE INTO edition_contributors(edition_id,person_id,role,position,source) VALUES(?,?,?,?,?)',
  );
  people.forEach((person, position) => {
    const id = upsertPerson(db, person, at);
    if (id) insert.run(editionId, id, person.role, position, source);
  });
}

function replaceSeries(db, editionId, series, source) {
  db.prepare('DELETE FROM edition_series WHERE edition_id=? AND source=?').run(editionId, source);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO edition_series(edition_id,name,normalized_name,kind,volume,position,source) VALUES(?,?,?,?,?,?,?)',
  );
  for (const entry of series)
    if (entry.normalizedName)
      insert.run(
        editionId,
        entry.name,
        entry.normalizedName,
        entry.kind,
        entry.volume ?? null,
        entry.position ?? 0,
        source,
      );
}

/**
 * Fills one edition (and its work, when the work's first edition) from its BN MARC record.
 * Editions without one get their work's authors as people. Returns what changed.
 */
export function enrichEdition(repository, editionId, { now = () => new Date() } = {}) {
  const db = repository?.database;
  if (
    !db?.prepare ||
    !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edition_series'").get()
  )
    return { editionId, updated: false, reason: 'schema_missing' };
  const edition = db.prepare('SELECT * FROM editions WHERE id=?').get(editionId);
  if (!edition) return { editionId, updated: false, reason: 'edition_not_found' };
  const at = now().toISOString();
  const payload = bnPayload(db, editionId);
  const details = payload ? parseBnMarc(payload) : null;
  const work = db.prepare('SELECT * FROM works WHERE id=?').get(edition.work_id);
  if (!details) {
    // Open Library and older records: the work's author list is all we know.
    const hasPeople = db
      .prepare('SELECT 1 FROM edition_contributors WHERE edition_id=? LIMIT 1')
      .get(editionId);
    if (!hasPeople && work) {
      const people = parseAuthors(work.authors_json).map((name) => ({ name, role: 'author' }));
      replaceContributors(db, editionId, people, 'work_authors', at);
    }
    return { editionId, updated: false, reason: 'no_marc' };
  }
  const title = catalogTitle(details);
  if (edition.verification_status !== 'manual') {
    db.prepare(
      `UPDATE editions SET title=coalesce(?,title), publisher=coalesce(?,publisher),
         publication_year=coalesce(publication_year,?), binding=coalesce(?,binding),
         subtitle=?, original_title=?, original_language=?, page_count=?, height_cm=?,
         place_of_publication=?, genres_json=?, updated_at=? WHERE id=?`,
    ).run(
      title,
      normalizePublisher(details.publisher),
      details.publicationYear,
      details.binding,
      details.subtitle,
      details.originalTitle,
      details.originalLanguage,
      details.pageCount,
      details.heightCm,
      details.placeOfPublication,
      JSON.stringify(details.genres),
      at,
      editionId,
    );
  } else {
    // Manual edition: keep what the operator typed, add only fields they cannot edit.
    db.prepare(
      `UPDATE editions SET subtitle=coalesce(subtitle,?), original_title=coalesce(original_title,?),
         original_language=coalesce(original_language,?), page_count=coalesce(page_count,?),
         height_cm=coalesce(height_cm,?), place_of_publication=coalesce(place_of_publication,?),
         genres_json=CASE WHEN genres_json='[]' THEN ? ELSE genres_json END WHERE id=?`,
    ).run(
      details.subtitle,
      details.originalTitle,
      details.originalLanguage,
      details.pageCount,
      details.heightCm,
      details.placeOfPublication,
      JSON.stringify(details.genres),
      editionId,
    );
  }
  db.prepare("DELETE FROM edition_contributors WHERE edition_id=? AND source='work_authors'").run(
    editionId,
  );
  replaceContributors(db, editionId, details.contributors, 'bn', at);
  replaceSeries(db, editionId, details.series, 'bn');

  let workUpdated = false;
  if (work && work.verification_status !== 'manual' && title) {
    const firstEdition = db
      .prepare('SELECT id FROM editions WHERE work_id=? ORDER BY created_at, id LIMIT 1')
      .get(work.id);
    if (firstEdition?.id === editionId) {
      const authors = details.authors.length ? details.authors : parseAuthors(work.authors_json);
      db.prepare(
        'UPDATE works SET title=?, normalized_title=?, authors_json=?, updated_at=? WHERE id=?',
      ).run(
        title,
        title.normalize('NFC').toLocaleLowerCase('pl'),
        JSON.stringify(authors),
        at,
        work.id,
      );
      workUpdated = true;
    }
  }
  return { editionId, updated: true, workUpdated };
}

/** Upgrades every edition once (per upgrade version); safe to run again. */
export function upgradeCatalogBibliography(
  repository,
  { now = () => new Date(), force = false } = {},
) {
  const db = repository.database;
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edition_series'").get())
    return { skipped: true, reason: 'schema_missing' };
  if (!force && db.prepare('SELECT 1 FROM app_preferences WHERE key=?').get(UPGRADE_KEY))
    return { skipped: true, reason: 'already_done' };
  const ids = db
    .prepare('SELECT id FROM editions ORDER BY created_at, id')
    .all()
    .map((row) => row.id);
  let updated = 0;
  let works = 0;
  repository.transaction(() => {
    for (const id of ids) {
      const result = enrichEdition(repository, id, { now });
      if (result.updated) updated += 1;
      if (result.workUpdated) works += 1;
    }
    db.prepare(
      `INSERT INTO app_preferences(key,value_json,updated_at) VALUES(?,?,?)
       ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
    ).run(
      UPGRADE_KEY,
      JSON.stringify({ editions: ids.length, updated, works }),
      now().toISOString(),
    );
  });
  return { skipped: false, editions: ids.length, updated, works };
}

/** People of an edition, in record order: [{id, name, role}]. */
export function editionContributors(repository, editionId) {
  return repository.database
    .prepare(
      `SELECT p.id, p.name, c.role FROM edition_contributors c JOIN persons p ON p.id=c.person_id
       WHERE c.edition_id=? ORDER BY c.position, p.name`,
    )
    .all(editionId)
    .map((row) => ({ ...row }));
}

/** Series statements of an edition: [{name, kind, volume}]. */
export function editionSeries(repository, editionId) {
  return repository.database
    .prepare(
      'SELECT name, kind, volume FROM edition_series WHERE edition_id=? ORDER BY position, name',
    )
    .all(editionId)
    .map((row) => ({ ...row }));
}

/** Everyone in the catalogue with counts per role, most editions first. */
export function catalogPersons(repository, { query = '', limit = 200 } = {}) {
  const needle = fold(query);
  const rows = repository.database
    .prepare(
      `SELECT p.id, p.name, p.normalized_name,
         count(DISTINCT c.edition_id) AS editions,
         count(DISTINCT CASE WHEN c.role='author' THEN c.edition_id END) AS asAuthor,
         count(DISTINCT CASE WHEN c.role='translator' THEN c.edition_id END) AS asTranslator,
         count(DISTINCT e.work_id) AS works
       FROM persons p JOIN edition_contributors c ON c.person_id=p.id JOIN editions e ON e.id=c.edition_id
       GROUP BY p.id ORDER BY editions DESC, p.name LIMIT 2000`,
    )
    .all();
  return rows
    .filter((row) => !needle || row.normalized_name.includes(needle))
    .slice(0, Math.max(1, Math.min(2000, Number(limit) || 200)))
    .map(({ normalized_name: _ignored, ...row }) => ({
      ...row,
      editions: Number(row.editions),
      asAuthor: Number(row.asAuthor),
      asTranslator: Number(row.asTranslator),
      works: Number(row.works),
    }));
}

/** Works a person contributed to, with the role(s). */
export function personWorks(repository, personId) {
  const db = repository.database;
  const person = db.prepare('SELECT id, name FROM persons WHERE id=?').get(personId);
  if (!person) throw Object.assign(Error('PERSON_NOT_FOUND'), { statusCode: 404 });
  const rows = db
    .prepare(
      `SELECT w.id AS workId, w.title, e.id AS editionId, e.publisher, e.publication_year AS year, group_concat(DISTINCT c.role) AS roles
       FROM edition_contributors c JOIN editions e ON e.id=c.edition_id JOIN works w ON w.id=e.work_id
       WHERE c.person_id=? GROUP BY e.id ORDER BY w.title, e.publication_year`,
    )
    .all(personId);
  return {
    person: { ...person },
    editions: rows.map((row) => ({
      ...row,
      roles: String(row.roles || '')
        .split(',')
        .filter(Boolean),
    })),
  };
}
