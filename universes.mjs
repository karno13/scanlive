// Universes (Świat Dysku, Warhammer, Warcraft…) as data: the `universes` table (migration 126),
// edited in Katalog → „Wydawcy i serie”. Their names are on every cover and in every listing, so
// many parts of the app need them: to strip branding from titles, to tell a universe from a story
// cycle, to widen a search. Every list those parts use is derived here from one set of records:
//
//   names   — how the universe itself is written ("Discworld series", "Warhammer 40 000", "WH40K");
//   lines   — publisher lines tied to it ("Black Library"): branding, but a line, not the universe;
//   markers — cycles and heroes that tell the universe ("Herezja Horusa", "Drizzt"); never removed
//             from a title, because they are part of it.
//
// Until the table is read (and in tests that open no catalogue) the built-in records apply; they
// are the same as the table's initial rows.

import { createHash } from 'node:crypto';

export const DEFAULT_UNIVERSES = [
  { name: 'Świat Dysku', names: ['Świat Dysku', 'Discworld', 'Discworld series'], lines: [], markers: [] },
  { name: 'Warcraft', names: ['World of Warcraft', 'Warcraft', 'Blizzard Legends'], lines: [], markers: [] },
  {
    name: 'Warhammer',
    names: ['Warhammer', 'Warhammer 40 000', 'Warhammer 40K', 'WH40K', 'W40K', '40K', '40 000', 'Warhammer Fantasy', 'Warhammer Chronicles', 'Warhammer Age of Sigmar', 'Age of Sigmar'],
    lines: ['Black Library', 'Czarna Biblioteka'],
    markers: ['Herezja Horusa', 'Horus Heresy', 'Horus'],
  },
  { name: 'Dragonlance', names: ['Dragonlance', 'Dragonlance Saga'], lines: [], markers: [] },
  { name: 'Forgotten Realms', names: ['Forgotten Realms', 'Zapomniane Krainy'], lines: [], markers: ['Drizzt'] },
  { name: 'Diablo', names: ['Diablo'], lines: [], markers: [] },
  { name: 'StarCraft', names: ['StarCraft'], lines: [], markers: [] },
  { name: 'Star Wars', names: ['Star Wars'], lines: [], markers: [] },
];

/** Lower case, no diacritics, punctuation as spaces ("Warhammer 40.000" → "warhammer 40 000"). */
export const foldName = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "40 000" is also written "40000", "40.000", "40,000".
const folded = (name) => escape(foldName(name)).replace(/(\d+) (000)\b/g, '$1 ?$2');
const raw = (name) =>
  [...new Set([String(name).toLowerCase().trim(), foldName(name)])]
    .map((text) => escape(text).replace(/(\d+)(?:\\?[ .,])?(000)\b/g, '$1[\\s.,]?$2').replace(/ +/g, '\\s+'))
    .join('|');
const longestFirst = (list) => [...new Set(list)].sort((a, b) => b.length - a.length || a.localeCompare(b));

function clean(list, limit = 40) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((value) => String(value ?? '').trim().replace(/\s+/g, ' ')).filter((value) => value && value.length <= 100 && foldName(value)))].slice(0, limit);
}
function normalize(record) {
  const name = String(record?.name ?? '').trim().replace(/\s+/g, ' ');
  const names = clean([name, ...(record?.names || [])]);
  return { name, names, lines: clean(record?.lines), markers: clean(record?.markers) };
}

const GENERIC_WORDS = new Set(['of', 'the', 'fantasy', 'saga', 'series', 'chronicles', 'age', 'legends']);

function derive(universes) {
  const names = universes.flatMap((u) => u.names);
  const lines = universes.flatMap((u) => u.lines);
  const alt = (list, form) => longestFirst(list.map(form)).join('|') || '(?!)';
  const foldedNames = alt(names, folded);
  const rawNames = alt(names, raw);
  return {
    // bn-marc: a series statement that is the universe (optionally with its line) names no cycle.
    series: new RegExp(`^(?:${foldedNames})(?: (?:${alt(lines, folded)}))?$`),
    // catalog-series: the universe a title belongs to, first match in table order.
    labels: universes.map((u) => [new RegExp(`\\b(?:${alt([...u.names, ...u.lines, ...u.markers], folded)})\\b`), u.name]),
    brandOnly: new RegExp(`^(?:${foldedNames})$`),
    // edition-series: words around the cycle in listings (longest first, as word lists).
    phrases: longestFirst([...names, ...lines].map(foldName)),
    // offer-editions: the same in raw listing text.
    patterns: longestFirst([...names, ...lines].map(raw)),
    // rejected-offers: words that never tell one product from another.
    words: [...new Set([...names, ...lines].flatMap((name) => foldName(name).replace(/(\d+) (000)\b/g, '$1$2 $1 $2').split(' ')))],
    // search-policy: a search for one name also finds the others (retrieval only).
    families: universes.filter((u) => u.names.length > 1).map((u) => u.names),
    topics: universes.map((u) => ({ keys: [...u.names, ...u.markers].map(foldName), terms: [...u.names, ...u.markers] })),
    // title-consistency: names, lines and markers of one universe stand for each other.
    synonyms: universes.map((u) => [...u.names, ...u.lines, ...u.markers].map(foldName)),
    // title-proposals: brand words that are on the cover but rarely in the catalogued title.
    brandWords: new Set(names.flatMap((name) => foldName(name).split(' ')).filter((word) => !GENERIC_WORDS.has(word)).concat(names.map((name) => foldName(name).replace(/ /g, '')).filter((word) => /^\d+$/.test(word)))),
    // work-grouping: the universe before ":" / "." or in brackets after the title is branding.
    prefix: new RegExp(`^\\s*(?:${rawNames})\\s*[:.]\\s+`, 'iu'),
    suffix: new RegExp(`\\s*[([](?:${rawNames})[)\\]]\\s*$`, 'iu'),
  };
}

let records = DEFAULT_UNIVERSES.map(normalize);
let derived = derive(records);
let version = digest(records);
function digest(list) {
  return createHash('sha256').update(JSON.stringify(list)).digest('hex').slice(0, 16);
}

/** Replaces the universes in use (the table after an edit, or the defaults in tests). */
export function setUniverses(list) {
  records = list.map(normalize).filter((record) => record.name);
  derived = derive(records);
  version = digest(records);
  return currentUniverses();
}
/** Changes whenever the universes in use change (work keys depend on them). */
export const universesVersion = () => version;
export function currentUniverses() {
  return records.map((record) => ({ ...record, names: record.names.filter((name) => name !== record.name) }));
}

// The derived lists, for their single users (see the header).
export const universeSeriesPattern = () => derived.series;
export const seriesUniverses = () => derived.labels;
export const brandOnlyPattern = () => derived.brandOnly;
export const listingUniversePhrases = () => derived.phrases;
export const listingUniversePatterns = () => derived.patterns;
export const universeWords = () => derived.words;
export const searchFamilies = () => derived.families;
export const universeSynonyms = () => derived.synonyms;
export const brandWords = () => derived.brandWords;
export const universePrefix = () => derived.prefix;
export const universeSuffix = () => derived.suffix;

/** Words a discovery phrase of a universe accepts in listing titles: all names and markers of it. */
export function topicTerms(category) {
  const key = ` ${foldName(category)} `;
  return derived.topics.find((topic) => topic.keys.some((name) => name && key.includes(` ${name} `)))?.terms ?? [];
}

// --- the table (migration 126)

export function loadUniverses(repository) {
  let rows;
  try {
    rows = repository.database.prepare('SELECT name, names_json, lines_json, markers_json FROM universes ORDER BY position, name').all();
  } catch {
    return currentUniverses();
  }
  return setUniverses(rows.map((row) => ({ name: row.name, names: JSON.parse(row.names_json), lines: JSON.parse(row.lines_json), markers: JSON.parse(row.markers_json) })));
}

function fail(code, statusCode = 400) {
  throw Object.assign(Error(code), { statusCode });
}

export function listUniverses(repository) {
  return { items: loadUniverses(repository) };
}

/** Adds or replaces one universe; `previousName` renames it. */
export function saveUniverse(repository, input = {}, { now = () => new Date() } = {}) {
  const record = normalize(input);
  if (!record.name || record.name.length > 100) fail('INVALID_UNIVERSE_NAME');
  for (const field of ['names', 'lines', 'markers']) if (input[field] != null && !Array.isArray(input[field])) fail('INVALID_UNIVERSE_FIELDS');
  const previous = typeof input.previousName === 'string' && input.previousName.trim() ? input.previousName.trim() : record.name;
  const db = repository.database;
  // A spelling may belong to one universe only: otherwise a title would be filed under two.
  const taken = new Map();
  for (const other of loadUniverses(repository)) if (other.name !== previous) for (const name of [other.name, ...other.names]) taken.set(foldName(name), other.name);
  const clash = record.names.find((name) => taken.has(foldName(name)));
  if (clash) throw Object.assign(Error('UNIVERSE_NAME_TAKEN'), { statusCode: 409, detail: `${clash} → ${taken.get(foldName(clash))}` });
  const at = now().toISOString();
  repository.transaction(() => {
    const old = db.prepare('SELECT position FROM universes WHERE name=?').get(previous);
    const position = old?.position ?? Number(db.prepare('SELECT coalesce(max(position),-1)+1 AS next FROM universes').get().next);
    if (old && previous !== record.name) db.prepare('DELETE FROM universes WHERE name=?').run(previous);
    db.prepare(
      `INSERT INTO universes(name,names_json,lines_json,markers_json,position,updated_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(name) DO UPDATE SET names_json=excluded.names_json, lines_json=excluded.lines_json,
         markers_json=excluded.markers_json, updated_at=excluded.updated_at`,
    ).run(record.name, JSON.stringify(record.names.filter((name) => name !== record.name)), JSON.stringify(record.lines), JSON.stringify(record.markers), position, at);
  });
  return listUniverses(repository);
}

export function deleteUniverse(repository, name) {
  const result = repository.database.prepare('DELETE FROM universes WHERE name=?').run(String(name ?? ''));
  if (!Number(result.changes)) fail('UNIVERSE_NOT_FOUND', 404);
  return listUniverses(repository);
}
