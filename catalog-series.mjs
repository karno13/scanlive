// Series view of the catalogue: universe ("Świat Dysku", "Warhammer") → cycle ("Herezja Horusa")
// → volume. Read from BN titles, the scan phrase that found the offers, and the operator's manual
// annotation (which always wins). Display and navigation only — never identification evidence.
import { fold } from './title-proposals.mjs';
import { proxiedImage } from './offer-images.mjs';
import { brandOnlyPattern, seriesUniverses } from './universes.mjs';

// Publisher lines and genre labels: numbered, but not a story cycle.
export const NOT_A_CYCLE =
  /^(?:wielka kolekcja|kolekcja.*|czarna biblioteka|fantastyka|fantasy|sf|seria.*fantasy|biblioteka.*|blizzard legends|nowa fantastyka|sensacja.*fantastyka|.*fantasy adventure|fantasy adventure)$/i;
// Brand words that are not a cycle on their own ("Discworld series t. 14" = the universe itself).
export const BRAND_ONLY = { test: (text) => brandOnlyPattern().test(text) };

export function universeOf(text) {
  const folded = fold(text);
  // Universe names that appear on covers / in BN series statements, with the label shown.
  return seriesUniverses().find(([pattern]) => pattern.test(folded))?.[1] ?? null;
}

/** Cycle and volume from a BN title: "…, Legenda Drizzta ; ks. 7 Forgotten Realms" → {Legenda Drizzta, 7}. */
export function cycleFromTitle(title) {
  const text = String(title ?? '').replace(/\s+/g, ' ');
  const statement = text.includes(' / ') ? text.slice(text.indexOf(' / ') + 3) : '';
  if (!statement) return null;
  const pattern =
    /([^,;/()]*?)\s*(?:;\s*(?:t\.|tom|ks\.|cz\.)?|\b(?:t\.|tom|ks\.|cz\.))\s*(\d{1,3})\b/gi;
  let fallback = null;
  for (const match of statement.matchAll(pattern)) {
    // "Dragonlance Saga. Kroniki Elfich Narodów" → the most specific (last) part names the cycle.
    const parts = match[1]
      .split(/\.\s+/)
      .map((part) => part.replace(/[\s.:,-]+$/g, '').trim())
      .filter(Boolean);
    const name = stripOriginalTitle(parts.at(-1) || '');
    const volume = Number(match[2]);
    if (!volume) continue;
    if (!name || NOT_A_CYCLE.test(name)) continue;
    if (BRAND_ONLY.test(fold(name))) {
      fallback ??= { cycle: null, volume };
      continue;
    }
    if (name.length < 3 || name.length > 60) continue;
    return { cycle: name, volume };
  }
  return fallback;
}

/**
 * Without a comma BN runs the original title into the series: "Halfling's gem Legenda Drizzta",
 * "Horus heresy Herezja Horusa". The cycle starts at the last capitalised word that follows a
 * lower-case word of 3+ letters ("i", "of" do not split "Przygody Gotreka i Felixa").
 */
export function stripOriginalTitle(name) {
  const words = String(name).split(' ');
  for (let index = words.length - 1; index > 0; index--)
    if (/^\p{Lu}/u.test(words[index]) && /^\p{Ll}[\p{L}'’-]{2,}$/u.test(words[index - 1]))
      return words.slice(index).join(' ');
  return name;
}

export function cycleKey(name) {
  return fold(name)
    .replace(/\b(?:cykl|saga|seria|series|trylogia|trilogy)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function catalogSeries(repository) {
  const db = repository.database;
  const works = db
    .prepare(
      `SELECT w.id, w.title,
         (SELECT count(*) FROM editions e WHERE e.work_id=w.id) AS editions,
         (SELECT count(*) FROM offer_matches m JOIN editions e ON e.id=m.edition_id WHERE e.work_id=w.id AND m.status='active') AS offers
       FROM works w WHERE NOT EXISTS (SELECT 1 FROM catalog_work_merges x WHERE x.source_id=w.id)`,
    )
    .all();
  const editionTitles = new Map();
  for (const row of db.prepare('SELECT work_id, title, publication_year FROM editions').all()) {
    if (!editionTitles.has(row.work_id)) editionTitles.set(row.work_id, []);
    editionTitles.get(row.work_id).push(row);
  }
  // The phrase that found most of a work's offers is the operator's own name for its series.
  const phrases = new Map();
  for (const row of db
    .prepare(
      `SELECT e.work_id, json_extract(o.matched_queries_json,'$[0]') AS phrase, count(*) AS n
       FROM offer_matches m JOIN editions e ON e.id=m.edition_id JOIN offers o ON o.id=m.offer_id
       WHERE m.status='active' AND phrase IS NOT NULL GROUP BY e.work_id, phrase ORDER BY n DESC`,
    )
    .all())
    if (!phrases.has(row.work_id)) phrases.set(row.work_id, String(row.phrase).trim());
  const covers = new Map();
  for (const row of db
    .prepare(
      `SELECT e.work_id, o.image_url FROM offer_matches m JOIN editions e ON e.id=m.edition_id JOIN offers o ON o.id=m.offer_id
       WHERE m.status='active' AND o.image_url IS NOT NULL
       ORDER BY CASE o.source WHEN 'Empik' THEN 0 WHEN 'Tezeusz.pl' THEN 1 WHEN 'Dedalus.pl' THEN 2 ELSE 3 END, o.last_seen_at DESC`,
    )
    .all())
    if (!covers.has(row.work_id)) covers.set(row.work_id, proxiedImage(row.image_url));
  const universeOverride = new Map(
    db
      .prepare('SELECT work_id, universe FROM work_universe_overrides')
      .all()
      .map((row) => [row.work_id, row.universe]),
  );
  const authorsOf = new Map(
    db
      .prepare('SELECT id, authors_json FROM works')
      .all()
      .map((row) => [row.id, parseAuthors(row.authors_json)]),
  );
  const manual = new Map(
    db
      .prepare('SELECT work_id, series, volume FROM work_series_annotations')
      .all()
      .map((row) => [row.work_id, row]),
  );
  // Series statements from the BN record (migration 112): the cycle and its volume number as printed.
  const recordSeries = new Map();
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edition_series'").get())
    for (const row of db
      .prepare(
        'SELECT e.work_id, s.name, s.kind, s.volume, s.source FROM edition_series s JOIN editions e ON e.id=s.edition_id ORDER BY e.created_at, s.position',
      )
      .all()) {
      if (!recordSeries.has(row.work_id)) recordSeries.set(row.work_id, []);
      recordSeries.get(row.work_id).push(row);
    }

  const definitions = loadSeriesDefinitions(db);
  const authorNames = new Map();
  const universes = new Map();
  for (const work of works) {
    const statements = recordSeries.get(work.id) || [];
    const titles = [
      work.title,
      ...(editionTitles.get(work.id) || []).map((edition) => edition.title),
      ...statements.filter((entry) => entry.kind === 'universe').map((entry) => entry.name),
    ];
    const phrase = phrases.get(work.id) || '';
    // Outside the known worlds a work is grouped by its author, not by the scan phrase that found
    // it: phrases mix authors ("Salvatore"), single books ("Iron Flame") and name variants.
    const author = mainAuthor(authorsOf.get(work.id));
    if (author) {
      const votes = authorNames.get(author.key) || new Map();
      votes.set(author.name, (votes.get(author.name) || 0) + 1);
      authorNames.set(author.key, votes);
    }
    // An authorless work found by a phrase that names an author ("Richard Knaak") joins that author.
    const phraseAuthor =
      !author && phrase ? mainAuthor([phraseLabel(phrase, authorsOf.get(work.id))]) : null;
    const universe =
      universeOverride.get(work.id) ||
      universeOf(titles.join(' ')) ||
      universeOf(phrase) ||
      (author
        ? AUTHOR_PREFIX + author.key
        : phraseAuthor
          ? AUTHOR_PREFIX + phraseAuthor.key
          : phrase
            ? phraseLabel(phrase, authorsOf.get(work.id))
            : NO_UNIVERSE);
    const annotation = manual.get(work.id);
    // BN files some publisher lines as series ("Nowa Fantastyka", "… : fantasy adventure"): not cycles.
    const cycles = statements.filter(
      (entry) => entry.kind === 'cycle' && !NOT_A_CYCLE.test(String(entry.name).trim()),
    );
    const recordCycle = cycles.find((entry) => entry.volume != null) || cycles[0] || null;
    // "Świat Dysku t. 14": the universe itself is numbered when no cycle is named.
    const universeEntry =
      statements.find((entry) => entry.kind === 'universe' && entry.volume != null) ?? null;
    const universeVolume = universeEntry?.volume ?? null;
    const titleCycle = recordCycle
      ? null
      : (titles.map(cycleFromTitle).find((item) => item?.cycle) ?? null);
    const parsed = recordCycle
      ? { cycle: recordCycle.name, volume: recordCycle.volume ?? null, source: recordCycle.source }
      : titleCycle ||
        (universeVolume != null
          ? { cycle: null, volume: universeVolume, source: universeEntry.source }
          : null) ||
        titles.map(cycleFromTitle).find(Boolean) ||
        null;
    const cycle = annotation ? annotation.series : parsed?.cycle || null;
    const volume = annotation ? annotation.volume : (parsed?.volume ?? null);
    // Read from listing titles (edition-series.mjs), not from a bibliographic record: worth a look.
    const guessed = !annotation && parsed?.source === 'listing';
    const years = (editionTitles.get(work.id) || [])
      .map((edition) => edition.publication_year)
      .filter(Boolean);
    if (!universes.has(universe)) universes.set(universe, []);
    universes.get(universe).push({
      id: work.id,
      title: work.title,
      cover: covers.get(work.id) || null,
      cycle,
      volume,
      manual: Boolean(annotation),
      guessed,
      universeManual: universeOverride.has(work.id),
      editions: Number(work.editions || 0),
      offers: Number(work.offers || 0),
      firstYear: years.length ? Math.min(...years) : null,
    });
  }
  // Author groups take the spelling used most often; one equal to a named group joins it.
  for (const [key, list] of [...universes]) {
    if (!key.startsWith(AUTHOR_PREFIX)) continue;
    universes.delete(key);
    const votes = [...(authorNames.get(key.slice(AUTHOR_PREFIX.length)) || new Map())].sort(
      (a, b) => b[1] - a[1] || b[0].length - a[0].length,
    );
    // One stray book by an author is not a group: it waits under "Poza seriami" unless it has a cycle.
    const label =
      list.length < 2 && !list.some((work) => work.cycle)
        ? NO_UNIVERSE
        : votes[0]?.[0] || NO_UNIVERSE;
    universes.set(label, [...(universes.get(label) || []), ...list]);
  }

  return [...universes]
    .map(([name, list]) => {
      const cycles = new Map();
      for (const work of list) {
        const key =
          work.cycle && cycleKey(work.cycle) !== cycleKey(name) ? cycleKey(work.cycle) : '';
        if (!cycles.has(key)) cycles.set(key, { name: key ? work.cycle : null, works: [] });
        cycles.get(key).works.push(work);
      }
      applyDefinitions(cycles, definitions);
      const cycleList = [...cycles.values()]
        .map((cycle) => {
          cycle.works.sort(
            (a, b) =>
              (a.volume ?? 1e6) - (b.volume ?? 1e6) ||
              (a.firstYear ?? 1e4) - (b.firstYear ?? 1e4) ||
              String(a.title).localeCompare(String(b.title), 'pl'),
          );
          const volumes = [
            ...new Set(cycle.works.map((work) => work.volume).filter(Number.isInteger)),
          ].sort((a, b) => a - b);
          // With the operator's list the cycle has a known length; without it only inner gaps count.
          const definition = cycle.name ? definitions.get(cycleKey(cycle.name)) : null;
          const last = Math.max(volumes.at(-1) || 0, definition?.entries.at(-1)?.number || 0);
          const missing = [];
          for (let number = 1; number <= last && missing.length < 60; number++)
            if (!volumes.includes(number) && (definition || number < last)) missing.push(number);
          const listed = new Map(
            (definition?.entries || []).map((entry) => [entry.number, entry.title]),
          );
          const missingTitles = Object.fromEntries(
            missing
              .filter((number) => listed.has(number))
              .map((number) => [number, listed.get(number)]),
          );
          return { ...cycle, volumes, missing, missingTitles, defined: listed.size };
        })
        // Named cycles first (by size), the loose works of the universe last.
        .sort(
          (a, b) =>
            (a.name === null) - (b.name === null) ||
            b.works.length - a.works.length ||
            String(a.name).localeCompare(String(b.name), 'pl'),
        );
      return {
        name,
        works: list.length,
        offers: list.reduce((sum, work) => sum + work.offers, 0),
        cycles: cycleList,
      };
    })
    .sort(
      (a, b) =>
        (a.name === NO_UNIVERSE) - (b.name === NO_UNIVERSE) ||
        b.works - a.works ||
        a.name.localeCompare(b.name, 'pl'),
    );
}

export const NO_UNIVERSE = 'Poza seriami';

function parseAuthors(value) {
  try {
    const parsed = JSON.parse(value ?? '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/**
 * A scan phrase used as a group name, spelled like the author when it is a typo of one:
 * "Terry Prachet" + BN "Pratchett, Terry (1948-2015)" -> "Terry Pratchett".
 */
export function phraseLabel(phrase, authors = []) {
  const folded = fold(phrase);
  // BN glues all people into one string: "Pratchett, Terry (1948-2015) Cholewa, Piotr W. (1955- ) …".
  const names = authors.flatMap((author) => {
    const text = String(author);
    const people = [
      ...text.matchAll(/(\p{Lu}[\p{L}'’-]+),\s*(\p{Lu}[\p{L}.'’ -]*?)\s*(?=\(|$)/gu),
    ].map((match) => `${match[2].trim()} ${match[1]}`);
    return people.length
      ? people
      : [
          text
            .replace(/\([^)]*\)/g, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
        ];
  });
  for (const name of names) {
    const candidate = fold(name);
    if (candidate.length >= 5 && candidate !== folded && editDistance(candidate, folded) <= 2)
      return name;
  }
  return capitalize(phrase);
}

/** Operator override of a work's universe; null/empty restores the automatic choice. */
export function setWorkUniverse(repository, workId, input = {}) {
  if (typeof workId !== 'string' || !workId || workId.length > 200)
    throw Object.assign(Error('INVALID_WORK_ID'), { statusCode: 400 });
  if (!repository.database.prepare('SELECT id FROM works WHERE id=?').get(workId))
    throw Object.assign(Error('WORK_NOT_FOUND'), { statusCode: 404 });
  const universe = typeof input.universe === 'string' ? input.universe.trim() : '';
  if (!universe) {
    repository.database.prepare('DELETE FROM work_universe_overrides WHERE work_id=?').run(workId);
    return { workId, universe: null };
  }
  if (universe.length > 80) throw Object.assign(Error('INVALID_UNIVERSE'), { statusCode: 400 });
  repository.database
    .prepare(
      `INSERT INTO work_universe_overrides(work_id, universe, updated_at) VALUES(?,?,?)
       ON CONFLICT(work_id) DO UPDATE SET universe=excluded.universe, updated_at=excluded.updated_at`,
    )
    .run(workId, universe, new Date().toISOString());
  return { workId, universe };
}

function capitalize(text) {
  return text.charAt(0).toLocaleUpperCase('pl') + text.slice(1);
}

// ---- Series definitions: the operator's list of a cycle's volumes (migration 118) ----

/** Comparable key of a title: its main part, without the BN subtitle, original title or volume. */
export function volumeTitleKey(title) {
  const main = String(title ?? '')
    .split(' / ')[0]
    .split(/\s*:\s/)[0];
  return fold(main)
    .replace(/^(?:tom|t|cz|czesc)\s*\d+\s*/, '')
    .trim();
}

/** "1. Czas Horusa" lines → [{number, title}]; unnumbered lines continue from the previous one. */
export function parseVolumeList(text) {
  const entries = [];
  let next = 1;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const numbered = line.match(/^(?:tom\s*)?(\d{1,3})\s*[.):\-–]?\s+(.+)$/i);
    const number = numbered ? Number(numbered[1]) : next;
    const title = (numbered ? numbered[2] : line).trim().slice(0, 200);
    if (!title || number < 1 || number > 500 || entries.some((entry) => entry.number === number))
      continue;
    entries.push({ number, title });
    next = number + 1;
  }
  return entries.sort((a, b) => a.number - b.number).slice(0, 300);
}

function loadSeriesDefinitions(db) {
  const map = new Map();
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='series_definitions'")
      .get()
  )
    return map;
  for (const row of db
    .prepare('SELECT cycle_key, name, titles_json FROM series_definitions')
    .all()) {
    let entries = [];
    try {
      entries = JSON.parse(row.titles_json);
    } catch {}
    if (Array.isArray(entries) && entries.length)
      map.set(row.cycle_key, { name: row.name, entries });
  }
  return map;
}

/** Numbers works without a volume (or with one guessed from listings) by their cycle's list. */
function applyDefinitions(cycles, definitions) {
  const loose = cycles.get('');
  for (const [key, cycle] of cycles) {
    const definition = key ? definitions.get(key) : null;
    if (!definition) continue;
    const byTitle = new Map(
      definition.entries.map((entry) => [volumeTitleKey(entry.title), entry.number]),
    );
    const listed = (work) => byTitle.get(volumeTitleKey(work.title));
    for (const work of cycle.works)
      if ((work.volume == null || work.guessed) && listed(work) != null) {
        work.volume = listed(work);
        work.guessed = false;
        work.fromList = true;
      }
    // Loose works of the universe that are on this cycle's list belong to it.
    if (loose)
      for (const work of [...loose.works])
        if (!work.manual && listed(work) != null) {
          loose.works.splice(loose.works.indexOf(work), 1);
          cycle.works.push({
            ...work,
            cycle: cycle.name,
            volume: listed(work),
            guessed: false,
            fromList: true,
          });
        }
  }
  if (loose && !loose.works.length) cycles.delete('');
}

export function getSeriesDefinition(repository, name) {
  const row = repository.database
    .prepare('SELECT name, titles_json FROM series_definitions WHERE cycle_key=?')
    .get(cycleKey(name));
  return { name: row?.name || String(name ?? ''), entries: row ? JSON.parse(row.titles_json) : [] };
}

/** Saves a cycle's volume list; an empty list removes it. */
export function saveSeriesDefinition(repository, input = {}, now = () => new Date()) {
  const name = String(input.name ?? '').trim();
  const key = cycleKey(name);
  if (!name || name.length > 200 || !key)
    throw Object.assign(Error('INVALID_SERIES_NAME'), { statusCode: 400 });
  const entries = parseVolumeList(input.text ?? '');
  if (!entries.length) {
    repository.database.prepare('DELETE FROM series_definitions WHERE cycle_key=?').run(key);
    return { name, entries: [] };
  }
  repository.database
    .prepare(
      `INSERT INTO series_definitions(cycle_key,name,titles_json,updated_at) VALUES(?,?,?,?)
       ON CONFLICT(cycle_key) DO UPDATE SET name=excluded.name, titles_json=excluded.titles_json, updated_at=excluded.updated_at`,
    )
    .run(key, name, JSON.stringify(entries), now().toISOString());
  return { name, entries };
}

const AUTHOR_PREFIX = 'author:';

/**
 * The first author of a work as {key, name}: "Knaak, Richard A. (1961- )" and "Richard Knaak"
 * share the key "r knaak" (first initial + surname), so name variants form one group.
 */
export function mainAuthor(authors = []) {
  const text = String(authors[0] ?? '').trim();
  if (!text) return null;
  const bn = text.match(
    /^(\p{Lu}[\p{L}'’-]+),\s*(\p{Lu}[\p{L}.'’ -]*?)\s*(?=\(|$|\p{Lu}[\p{L}'’-]+,)/u,
  );
  const name = (bn ? `${bn[2].trim()} ${bn[1]}` : text.replace(/\([^)]*\)/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  const words = name.split(' ').filter(Boolean);
  if (words.length < 2) return null;
  const surname = fold(words.at(-1));
  const initial = fold(words[0]).charAt(0);
  if (!surname || !initial || /^(?:praca|red|opracowanie|autor)/.test(fold(name))) return null;
  return { key: `${initial} ${surname}`, name };
}
