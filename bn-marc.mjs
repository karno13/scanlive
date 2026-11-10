// Reads the MARC 21 record that BN returns next to its flattened fields. The flattened fields glue
// everything together ("Zabójca gigantów / Giantslayer, Warhammer Fantasy (Copernicus Corporation)
// Przygody Gotreka i Felixa t. 7 Czarna Biblioteka 22", author "King, William Bonikowski, Grzegorz
// Copernicus Corporation"); MARC keeps title, people with roles, publisher and series apart.
import { fold } from './title-proposals.mjs';
import { universeSeriesPattern } from './universes.mjs';

/** [{tag, ind1, ind2, subfields: [[code, value]]}] from BN's {"fields":[{"245":{...}}]} shape. */
export function marcFields(marc) {
  const fields = Array.isArray(marc?.fields) ? marc.fields : [];
  const out = [];
  for (const field of fields) {
    if (!field || typeof field !== 'object') continue;
    for (const [tag, value] of Object.entries(field)) {
      if (value && typeof value === 'object' && Array.isArray(value.subfields))
        out.push({
          tag,
          ind1: value.ind1 ?? ' ',
          ind2: value.ind2 ?? ' ',
          subfields: value.subfields.flatMap((entry) =>
            entry && typeof entry === 'object'
              ? Object.entries(entry).map(([code, text]) => [code, String(text ?? '')])
              : [],
          ),
        });
      else out.push({ tag, value: String(value ?? ''), subfields: [] });
    }
  }
  return out;
}

const all = (field, code) =>
  field.subfields.filter(([key]) => key === code).map(([, value]) => value);
const first = (field, code) => all(field, code)[0] ?? null;

/** ISBD punctuation that closes a MARC subfield: "Zabójca krasnoludów /", "Copernicus Corporation,". */
export function trimPunctuation(value) {
  let text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(/\s*[/:;=,]+$/, '').trim();
  // A final full stop is ISBD punctuation, except after an initial ("Werner, C. L.") or "t. 1".
  if (
    /\.$/.test(text) &&
    !/(?:^|[\s.])\p{L}\.$/u.test(text) &&
    !/\b(?:t|ks|cz|nr|wyd|s)\.$/i.test(text)
  )
    text = text.slice(0, -1).trim();
  return text.replace(/^\[|\]$/g, '').trim();
}

const ROLE_PATTERNS = [
  [/^aut/i, 'author'],
  [/^t[łl]um/i, 'translator'],
  [/^ilustr/i, 'illustrator'],
  [/^(?:red|oprac|wyb)/i, 'editor'],
];

function roleOf(text) {
  const value = trimPunctuation(text);
  return ROLE_PATTERNS.find(([pattern]) => pattern.test(value))?.[1] ?? 'other';
}

/** "Guymer, David" -> "David Guymer"; "Werner, C. L." -> "C. L. Werner". */
export function displayName(sortName) {
  const text = trimPunctuation(sortName).replace(/\s*\([^)]*\)\s*$/, '');
  const comma = text.indexOf(',');
  if (comma < 0) return text;
  const surname = text.slice(0, comma).trim();
  const given = text.slice(comma + 1).trim();
  return given ? `${given} ${surname}` : surname;
}

export function personKey(name) {
  return fold(name);
}

function contributors(fields) {
  const people = [];
  const seen = new Set();
  for (const field of fields) {
    if (!['100', '700'].includes(field.tag)) continue;
    // 700 with $t is an analytic entry for a contained work, not a person of this edition.
    if (field.tag === '700' && all(field, 't').length) continue;
    const sortName = trimPunctuation(first(field, 'a') ?? '');
    if (!sortName) continue;
    const roles = all(field, 'e')
      .flatMap((value) => value.split(/[,;]/))
      .map((value) => value.trim())
      .filter(Boolean);
    const mapped = roles.length
      ? [...new Set(roles.map(roleOf))]
      : [field.tag === '100' ? 'author' : 'other'];
    for (const role of mapped) {
      const name = displayName(sortName);
      const key = `${personKey(name)}|${role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      people.push({ name, sortName, role });
    }
  }
  return people;
}

// Series statements that name a universe or a franchise rather than a story cycle.
// Publisher imprints and genre lines: numbered, but the number is the imprint's, not a story's.
const PUBLISHER_LINE =
  /^(?:fantasy|sf|fantastyka|science fiction|wielka kolekcja|kolekcja.*|czarna biblioteka|black library(?: czarna biblioteka)?|biblioteka.*|seria.*|bestseller.*|powiesc|warhammer powiesc)$/;

/** "Świat Dysku / Terry Pratchett ;" -> "Świat Dysku"; "Fantasy (Copernicus Corporation)" -> "Fantasy". */
export function seriesName(value, publisher = null) {
  let text = String(value ?? '');
  text = text.split(' / ')[0];
  text = text.replace(/\s*\([^)]*\)\s*$/, '');
  if (text.includes(' = ')) text = text.split(' = ').at(-1);
  const dash = text.match(/^(.*?)\s+-\s+(.+)$/);
  if (
    dash &&
    (/(?:corporation|media|wydawnictwo|s-ka|słów|slow)\b/i.test(dash[2]) ||
      (publisher && fold(publisher).startsWith(fold(dash[2]))))
  )
    text = dash[1];
  return trimPunctuation(text);
}

export function seriesKind(name) {
  const key = fold(name);
  if (universeSeriesPattern().test(key)) return 'universe';
  if (PUBLISHER_LINE.test(key)) return 'publisher_line';
  return 'cycle';
}

export function volumeNumber(value) {
  const match = String(value ?? '').match(/(\d{1,4})/);
  return match ? Number(match[1]) : null;
}

function series(fields, publisher) {
  const found = [];
  const add = (raw, volumeText, source) => {
    const name = seriesName(raw, publisher);
    // "Dragonlance Saga. Kroniki Elfich Narodów": a universe, then the cycle that is numbered.
    const split = name.match(/^(.+?)\.\s+(\p{Lu}.+)$/u);
    if (split && seriesKind(split[1]) === 'universe' && !/^\d/.test(split[2])) {
      add(split[1], null, source);
      add(split[2], volumeText, source);
      return;
    }
    if (fold(name).length < 2) return;
    const volume = volumeNumber(volumeText);
    const normalized = fold(name);
    const existing = found.find((entry) => entry.normalizedName === normalized);
    if (existing) {
      existing.volume ??= volume;
      return;
    }
    found.push({ name, normalizedName: normalized, kind: seriesKind(name), volume, source });
  };
  for (const field of fields.filter((entry) => entry.tag === '490'))
    add(first(field, 'a'), first(field, 'v'), '490');
  for (const field of fields.filter((entry) => entry.tag === '830')) {
    const name = first(field, 'a');
    const part = first(field, 'p');
    const volume = first(field, 'v');
    // "Warhammer 40.000. $p Herezja Horusa $v 30": the universe, then the cycle that is numbered.
    if (part) {
      add(name, null, '830');
      add(part, volume, '830');
    } else add(name, volume, '830');
  }
  // 800 $t is the authorised (often English) cycle title; use it only when nothing named the cycle.
  if (!found.some((entry) => entry.kind === 'cycle'))
    for (const field of fields.filter((entry) => entry.tag === '800')) {
      const name = first(field, 't');
      if (name) add(name, first(field, 'v') ?? first(field, 'n'), '800');
    }
  return found.map((entry, position) => ({ ...entry, position }));
}

function titleParts(fields) {
  const field = fields.find((entry) => entry.tag === '245');
  if (!field) return { title: null, subtitle: null, fullTitle: null };
  // Subfields in record order: "World of Warcraft : $b kronika. $n T. 1" keeps the volume after the subtitle.
  let fullTitle = '';
  let previous = '';
  const main = [];
  const subtitles = [];
  for (const [code, raw] of field.subfields) {
    if (!['a', 'b', 'n', 'p'].includes(code)) continue;
    const value = trimPunctuation(raw);
    if (!value) continue;
    // "Tytuł = Parallel title": $b after "=" is the parallel title, not a subtitle.
    if (code === 'b' && /=s*$/.test(previous)) {
      previous = raw;
      continue;
    }
    if (code === 'a') main.push(value);
    if (code === 'b') subtitles.push(value);
    if (code === 'n' || code === 'p') main.push(value);
    fullTitle += fullTitle ? (code === 'b' ? ' : ' : '. ') + value : value;
    previous = raw;
  }
  return {
    title: main.join('. ') || null,
    subtitle: subtitles.join(' ') || null,
    fullTitle: fullTitle || null,
  };
}

function originalTitle(fields) {
  for (const field of fields.filter((entry) => entry.tag === '246')) {
    const label = all(field, 'i').join(' ');
    if (/oryg/i.test(label) && !/cykl/i.test(label)) {
      const value = [first(field, 'a'), first(field, 'b')]
        .map((part) => trimPunctuation(part ?? ''))
        .filter(Boolean)
        .join(' : ');
      if (value) return value;
    }
  }
  const uniform = fields.find((entry) => entry.tag === '240');
  return uniform ? trimPunctuation(first(uniform, 'a') ?? '') || null : null;
}

function publication(fields) {
  const field =
    fields.find((entry) => entry.tag === '264' && entry.ind2 === '1') ??
    fields.find((entry) => ['260', '264'].includes(entry.tag));
  if (!field) return { publisher: null, place: null, year: null };
  // The first $b is the publisher; later ones are co-publishers / collection partners.
  const publishers = all(field, 'b').map(trimPunctuation).filter(Boolean).slice(0, 1);
  const place = trimPunctuation(all(field, 'a').join(' ; ')) || null;
  const year = String(first(field, 'c') ?? '').match(/(1[4-9]\d\d|20\d\d)/);
  return { publisher: publishers[0] ?? null, place, year: year ? Number(year[1]) : null };
}

function binding(fields) {
  const text = fields
    .filter((entry) => entry.tag === '020')
    .flatMap((entry) => all(entry, 'q'))
    .join(' ');
  if (/tward/i.test(text)) return 'oprawa twarda';
  if (/mi[ęe]kk/i.test(text)) return 'oprawa miękka';
  return null;
}

function physical(fields) {
  const field = fields.find((entry) => entry.tag === '300');
  if (!field) return { pageCount: null, heightCm: null };
  const extent = all(field, 'a').join(' ');
  // "405, [3] strony", "165, [1] strona, [1] karta tablic": the paginated count is the first number.
  const counted = /(?:\bs\.|\bs\b|stron|str\b)/i.test(extent)
    ? Number(extent.match(/\d{1,5}/)?.[0] ?? 0)
    : 0;
  const pages = counted ? [counted] : [];
  const height = String(first(field, 'c') ?? '').match(/(\d{1,3})\s*cm/);
  const pageCount = pages[0] ?? null;
  return {
    pageCount: pageCount && pageCount <= 20000 ? pageCount : null,
    heightCm: height && Number(height[1]) <= 200 ? Number(height[1]) : null,
  };
}

/**
 * Structured details of one BN record, or null when it carries no MARC. Every field may be null.
 * { title, subtitle, originalTitle, originalLanguage, authors[], contributors[{name,sortName,role}],
 *   publisher, placeOfPublication, publicationYear, binding, pageCount, heightCm,
 *   series[{name,normalizedName,kind,volume,position,source}], genres[] }
 */
export function parseBnMarc(record) {
  const fields = marcFields(record?.marc);
  if (!fields.length) return null;
  const { title, subtitle, fullTitle } = titleParts(fields);
  const people = contributors(fields);
  const { publisher, place, year } = publication(fields);
  const genres = [
    ...new Set(
      fields
        .filter((entry) => entry.tag === '655')
        .map((entry) => trimPunctuation(first(entry, 'a') ?? ''))
        .filter(Boolean),
    ),
  ];
  return {
    title,
    subtitle,
    fullTitle,
    originalTitle: originalTitle(fields),
    originalLanguage:
      typeof record.languageOfOriginal === 'string' && record.languageOfOriginal.trim()
        ? record.languageOfOriginal.trim()
        : null,
    authors: people.filter((person) => person.role === 'author').map((person) => person.name),
    contributors: people,
    publisher,
    placeOfPublication: place,
    publicationYear: year,
    binding: binding(fields),
    ...physical(fields),
    series: series(fields, publisher),
    genres,
  };
}

/** Title as stored in the catalogue: "Zstąpienie Aniołów : lojalność i honor". */
export function catalogTitle(details) {
  if (details?.fullTitle) return details.fullTitle;
  if (!details?.title) return null;
  return details.subtitle ? `${details.title} : ${details.subtitle}` : details.title;
}
