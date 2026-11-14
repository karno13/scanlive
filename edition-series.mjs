// @ts-check
// Cycle and volume for editions that BN has not described: from the publisher's own series
// statement in the e-ISBN record, and from the titles of the listings assigned to the work
// ("Duchy Gaunta. Tom 2. Komisarz Gaunt", "Kolor magii. Świat Dysku. Tom 1").
// Listing titles disagree now and then (a newspaper collection numbers Discworld its own way), so
// the cycle and the volume most listings agree on win. BN statements, a cycle readable from the BN
// title and the operator's annotation always take precedence; listing rows are stored with
// source 'listing' and recomputed, never mixed with BN rows.
import { fold } from './title-proposals.mjs';
import { mainTitle } from './work-grouping.mjs';
import { BRAND_ONLY, NOT_A_CYCLE, cycleFromTitle } from './catalog-series.mjs';
import { seriesKind } from './bn-marc.mjs';
import { listingUniversePhrases } from './universes.mjs';

const VOLUME_WORD = /^(?:tom|t|ksiega|ks|vol|volume|czesc|cz|#)$/;
const PRIMARY_VOLUME_WORD = /^(?:tom|t|ksiega|ks|vol|volume|#)$/;
// Universe names and sales words that sit next to the cycle in listings.
const SALES_PHRASES = [
  'ksiazka',
  'ksiazki',
  'nowa',
  'nowy',
  'unikat',
  'bdb',
  'stan bardzo dobry',
  'stan dobry',
  'wyd',
  'wydanie',
  'isa',
  'mag',
].map((phrase) => phrase.split(' '));
// Universe names (from the universes table) first, longest first, then sales words.
let noiseFor = null;
let noisePhrases = [];
function NOISE_PHRASES_NOW() {
  const universes = listingUniversePhrases();
  if (noiseFor !== universes) {
    noiseFor = universes;
    noisePhrases = [...universes.map((phrase) => phrase.split(' ')), ...SALES_PHRASES];
  }
  return noisePhrases;
}

const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100 };
function romanValue(text) {
  let total = 0;
  for (let index = 0; index < text.length; index++) {
    const value = ROMAN[text[index]],
      next = ROMAN[text[index + 1]] ?? 0;
    if (!value) return null;
    total += value < next ? -value : value;
  }
  return total > 0 && total <= 200 ? total : null;
}
function volumeOf(token) {
  if (/^\d{1,3}$/.test(token)) return Number(token) || null;
  if (/^[ivxlc]{1,7}$/.test(token)) return romanValue(token);
  return null;
}

const words = (text) =>
  String(text ?? '')
    .split(/\s+/)
    .map((raw) => ({ raw: raw.replace(/^[^\p{L}\d#]+|[^\p{L}\d]+$/gu, ''), key: fold(raw) }))
    .filter((word) => word.raw || word.key);

/** Removes a run of folded tokens (`phrase`) wherever it appears in `list`. */
function removeRun(list, phrase) {
  if (!phrase.length) return list;
  const out = [];
  for (let index = 0; index < list.length;) {
    if (phrase.every((token, offset) => list[index + offset]?.key === token))
      index += phrase.length;
    else out.push(list[index++]);
  }
  return out;
}

const sentence = (text) => {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters && letters === letters.toLocaleUpperCase('pl') && letters.length > 3)
    text = text.toLocaleLowerCase('pl');
  return text.charAt(0).toLocaleUpperCase('pl') + text.slice(1);
};

/**
 * One listing title → { cycle, volume } or { universe, volume } or null.
 * `context`: { titles: [work / edition titles], authors: [names] } — removed before reading the cycle.
 */
export function seriesFromListing(listing, context = {}) {
  const text = String(listing ?? '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  // Find "tom 2" / "Tom IV" / "ks. 7" (not "tom 1-3" bundles, not "tom 1,5").
  const tokens = text.split(' ');
  let hit = null;
  for (let index = 0; index < tokens.length; index++) {
    const word = fold(tokens[index]);
    // "T.Pratchett" or "t.3": a volume word glued to its number.
    const glued = word.match(/^(tom|t|ks|cz)\s*(\d{1,3})$/);
    let keyword = null,
      number = null,
      end = index;
    if (glued) [keyword, number] = [glued[1], glued[2]];
    else if (VOLUME_WORD.test(word) && tokens[index + 1] !== undefined) {
      keyword = word;
      number = fold(tokens[index + 1]);
      end = index + 1;
    }
    if (!keyword) continue;
    const volume = volumeOf(number);
    if (!volume) continue;
    const after = tokens.slice(end + 1, end + 3).join(' ');
    if (/^[-–]\s*\d|^\d/.test(after) || /[,.]\d/.test(tokens[end])) continue;
    const candidate = { at: index, end, volume, primary: PRIMARY_VOLUME_WORD.test(keyword) };
    if (!hit || (candidate.primary && !hit.primary)) hit = candidate;
  }
  if (!hit) return null;
  const before = tokens.slice(0, hit.at).join(' ');
  const segments = before
    .split(/\s[-–—|/]\s|[|/]|[.!?:;,](?:\s+|$)|\s[-–—]$/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const titleRuns = (context.titles ?? [])
    .map((title) => fold(mainTitle(title)).split(' ').filter(Boolean))
    .filter((run) => run.length);
  const authorTokens = new Set(
    (context.authors ?? [])
      .flatMap((name) => fold(String(name).replace(/\([^)]*\)/g, ' ')).split(' '))
      .filter((token) => token.length >= 3),
  );
  // Last resort, "Piekło pocztowe Tom 35 Świat Dysku": the universe right after the number.
  const universeAfter = () => {
    const after = tokens.slice(hit.end + 1, hit.end + 4).filter((token) => /\p{L}/u.test(token));
    for (const length of [3, 2, 1]) {
      const phrase = after.slice(0, length);
      if (phrase.length === length && BRAND_ONLY.test(fold(phrase.join(' '))))
        return {
          universe: sentence(phrase.join(' ').replace(/[^\p{L}\s]+$/u, '')),
          volume: hit.volume,
        };
    }
    return null;
  };
  for (const segment of segments.reverse()) {
    let list = words(segment);
    const folded = list.map((word) => word.key).join(' ');
    if (BRAND_ONLY.test(folded))
      return { universe: sentence(list.map((word) => word.raw).join(' ')), volume: hit.volume };
    for (const run of titleRuns) list = removeRun(list, run);
    // "Blask fantastyczny Świat Dysku Tom 2": what is left after the book's title is the universe.
    const rest = list.filter((word) => !authorTokens.has(word.key));
    if (rest.length && BRAND_ONLY.test(rest.map((word) => word.key).join(' ')))
      return { universe: sentence(rest.map((word) => word.raw).join(' ')), volume: hit.volume };
    for (const phrase of NOISE_PHRASES_NOW()) list = removeRun(list, phrase);
    // Authors, single letters and another volume statement ("Część 2") are not part of a cycle name.
    list = list.filter(
      (word, index, all) =>
        word.raw &&
        !authorTokens.has(word.key) &&
        !/^\p{L}$/u.test(word.raw) &&
        !VOLUME_WORD.test(word.key) &&
        !/^(?:\p{Lu}\.?){1,3}$/u.test(word.raw.replace(/\./g, '.')) &&
        !/^\d+$/.test(word.key) &&
        !(volumeOf(word.key) && VOLUME_WORD.test(all[index - 1]?.key ?? '')),
    );
    if (!list.length) continue;
    const name = list
      .map((word) => word.raw)
      .join(' ')
      .replace(/^[\s\-–—]+|[\s\-–—]+$/g, '');
    if (list.length > 6 || name.length < 3 || name.length > 60 || /^\d+$/.test(name)) continue;
    if (NOT_A_CYCLE.test(name) || NOT_A_CYCLE.test(fold(name))) return null;
    return { cycle: sentence(name), volume: hit.volume };
  }
  return universeAfter();
}

/** The cycle and volume most listings agree on. */
export function seriesFromListings(listings, context = {}) {
  const cycles = new Map();
  const universes = new Map();
  // Strings count once; { text, weight } entries (the edition's own title) count more.
  for (const item of listings) {
    const listing = typeof item === 'string' ? item : item?.text;
    const weight = typeof item === 'string' ? 1 : Number(item?.weight) || 1;
    const found = seriesFromListing(listing, context);
    if (!found) continue;
    const bucket = found.cycle ? cycles : universes;
    const name = found.cycle ?? found.universe;
    const key = fold(name)
      .replace(/\b(?:cykl|saga|seria|series|trylogia|trilogy)\b/g, '')
      .trim();
    if (!bucket.has(key)) bucket.set(key, { names: new Map(), volumes: new Map(), votes: 0 });
    const entry = bucket.get(key);
    entry.votes += weight;
    entry.names.set(name, (entry.names.get(name) ?? 0) + weight);
    entry.volumes.set(found.volume, (entry.volumes.get(found.volume) ?? 0) + weight);
  }
  const best = (bucket) => {
    const ranked = [...bucket.values()].sort((a, b) => b.votes - a.votes);
    if (!ranked.length || (ranked[1] && ranked[1].votes === ranked[0].votes)) return null;
    const pick = (map) =>
      [...map].sort((a, b) => b[1] - a[1] || (typeof a[0] === 'number' ? a[0] - b[0] : 0))[0];
    const [volume, volumeVotes] = pick(ranked[0].volumes);
    // Two listings that disagree on the number: no number rather than a guess.
    const contested =
      [...ranked[0].volumes.values()].filter((votes) => votes === volumeVotes).length > 1;
    return {
      name: pick(ranked[0].names)[0],
      volume: contested ? null : volume,
      votes: ranked[0].votes,
    };
  };
  const cycle = best(cycles);
  if (cycle) return { kind: 'cycle', ...cycle };
  const universe = best(universes);
  return universe && universe.volume != null ? { kind: 'universe', ...universe } : null;
}

/** Series statements of one record (e-ISBN Collection, …) stored under `source`. */
export function storeSeriesStatements(repository, editionId, entries, source) {
  const db = repository.database;
  db.prepare('DELETE FROM edition_series WHERE edition_id=? AND source=?').run(editionId, source);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO edition_series(edition_id,name,normalized_name,kind,volume,position,source) VALUES(?,?,?,?,?,?,?)',
  );
  entries.forEach((entry, position) => {
    const name = String(entry?.name ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
    if (!name) return;
    const kind =
      entry.kind ??
      (BRAND_ONLY.test(fold(name))
        ? 'universe'
        : NOT_A_CYCLE.test(name)
          ? 'publisher_line'
          : seriesKind(name));
    const volume = Number.isInteger(entry.volume)
      ? entry.volume
      : volumeOf(
          fold(String(entry.part ?? entry.volume ?? ''))
            .split(' ')
            .pop() ?? '',
        );
    insert.run(editionId, name, fold(name), kind, volume ?? null, position, source);
  });
}

/**
 * Recomputes listing-derived series for every work that has no cycle from a better source.
 * Cheap (a few SQL reads); run at start-up and every few minutes beside the resolver.
 */
export function inferListingSeries(repository) {
  const db = repository.database;
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edition_series'").get())
    return { works: 0, stored: 0 };
  const editions = db.prepare('SELECT id, work_id, title FROM editions').all();
  const byWork = new Map();
  for (const edition of editions) {
    if (!byWork.has(edition.work_id)) byWork.set(edition.work_id, []);
    byWork.get(edition.work_id).push(edition);
  }
  const works = new Map(
    db
      .prepare('SELECT id, title, authors_json FROM works')
      .all()
      .map((row) => [row.id, row]),
  );
  const annotated = new Set(
    db
      .prepare('SELECT work_id FROM work_series_annotations')
      .all()
      .map((row) => row.work_id),
  );
  const better = new Set(
    db
      .prepare(
        "SELECT DISTINCT e.work_id FROM edition_series s JOIN editions e ON e.id=s.edition_id WHERE s.source<>'listing' AND (s.kind='cycle' OR s.volume IS NOT NULL)",
      )
      .all()
      .map((row) => row.work_id),
  );
  // Every person named on the work's editions (co-authors, translators) is no cycle name.
  const people = new Map();
  if (
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edition_contributors'")
      .get()
  )
    for (const row of db
      .prepare(
        'SELECT e.work_id, p.name FROM edition_contributors c JOIN persons p ON p.id=c.person_id JOIN editions e ON e.id=c.edition_id',
      )
      .all()) {
      if (!people.has(row.work_id)) people.set(row.work_id, []);
      people.get(row.work_id).push(row.name);
    }
  const listings = new Map();
  for (const row of db
    .prepare(
      "SELECT e.work_id, o.original_title FROM offer_matches m JOIN editions e ON e.id=m.edition_id JOIN offers o ON o.id=m.offer_id WHERE m.status='active'",
    )
    .all()) {
    if (!listings.has(row.work_id)) listings.set(row.work_id, []);
    listings.get(row.work_id).push(row.original_title);
  }
  const remove = db.prepare("DELETE FROM edition_series WHERE edition_id=? AND source='listing'");
  const insert = db.prepare(
    "INSERT OR IGNORE INTO edition_series(edition_id,name,normalized_name,kind,volume,position,source) VALUES(?,?,?,?,?,100,'listing')",
  );
  let stored = 0,
    counted = 0;
  repository.transaction(() => {
    for (const [workId, list] of byWork) {
      const work = works.get(workId);
      let found = null;
      const titles = [work?.title, ...list.map((edition) => edition.title)].filter(Boolean);
      if (
        work &&
        !annotated.has(workId) &&
        !better.has(workId) &&
        !titles.some((title) => cycleFromTitle(title)?.cycle)
      ) {
        let authors = [];
        try {
          authors = JSON.parse(work.authors_json || '[]');
        } catch {}
        const own = list.map((edition) => ({ text: edition.title, weight: 2 }));
        found = seriesFromListings([...own, ...(listings.get(workId) ?? [])], {
          titles,
          authors: [...authors, ...(people.get(workId) ?? [])],
        });
      }
      for (const edition of list) {
        remove.run(edition.id);
        if (found)
          stored += Number(
            insert.run(edition.id, found.name, fold(found.name), found.kind, found.volume ?? null)
              .changes,
          );
      }
      if (found) counted += 1;
    }
  });
  return { works: counted, stored };
}
