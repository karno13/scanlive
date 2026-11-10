// Editions created from a listing when no bibliographic source knows its ISBN (BN, Open Library,
// Google Books). The operator gets a filled-in draft (title and author from the listing and its
// sibling offers, the ISBN) and creates the edition with one click. It stays 'unverified'; BN is
// asked again about once a week and, when it finally answers, the edition gets the full record.
import { randomUUID } from 'node:crypto';
import { isbnKeys, normalizeISBN } from './isbn-normalization.mjs';
import { fold } from './title-proposals.mjs';
import { findWorkByKey } from './work-grouping.mjs';
import { universeOf } from './catalog-series.mjs';
import { decideIdentificationJob } from './catalog-api.mjs';
import { persistMetadataResults } from './metadata-lookup.mjs';
import { enrichEdition } from './catalog-bibliography.mjs';
import { chooseAmongRecords } from './catalog-resolver.mjs';
import { storeSeriesStatements } from './edition-series.mjs';
import { normalizePublisher } from './publisher-names.mjs';
import { storedIsbnRecord } from './isbn-lookups.mjs';
import { LISTING_UNIVERSE_PATTERNS } from './universes.mjs';

const RECHECK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_SOON_MS = 24 * 60 * 60 * 1000;
const L = '[\\p{L}\\d]';
const word = (pattern) => new RegExp(`(?<!${L})(?:${pattern})(?!${L})`, 'giu');
// Universe names and sales words: on every cover and in every listing, never the book's own title.
const NOISE = word(
  [
    ...LISTING_UNIVERSE_PATTERNS,
    'książka',
    'ksiazka',
    'książki',
    'stan (?:bardzo )?dobry',
    'bdb',
    'unikat',
    'unikatowa',
    'okazja',
    'nowa',
    'nowy',
    'black library',
    'copernicus',
    'chronicles',
  ].join('|'),
);

const clean = (text) =>
  String(text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—|,;:.'"„”]+|[\s\-–—|,;:'"„”]+$/g, '')
    .trim();

/** "Abnett, Dan (1965- ) Tłumaczenie" or "Dan Abnett" → { display: "Dan Abnett", surname, first }. */
function personName(raw) {
  const text = String(raw ?? '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  let first, surname;
  if (text.includes(',')) {
    [surname, first] = text.split(',').map((part) => part.trim());
    first = (first || '').split(' ').slice(0, 2).join(' ');
  } else {
    const parts = text.split(' ');
    if (parts.length < 2 || parts.length > 3) return null;
    // "Werner C. L." (surname first, then initials) and "C. L. Werner".
    const initials = (part) => /^(?:\p{Lu}\.)+$/u.test(part);
    if (!initials(parts[0]) && parts.slice(1).every(initials)) {
      surname = parts[0];
      first = parts.slice(1).join(' ');
    } else {
      surname = parts.at(-1);
      first = parts.slice(0, -1).join(' ');
    }
  }
  if (!surname || surname.length < 2) return null;
  return { display: clean(`${first} ${surname}`), surname, first };
}

function knownPeople(repository) {
  const people = new Map();
  for (const row of repository.database.prepare('SELECT authors_json FROM works').all()) {
    let authors = [];
    try {
      authors = JSON.parse(row.authors_json || '[]');
    } catch {}
    for (const raw of [].concat(authors)) {
      const person = personName(raw);
      if (person && !people.has(fold(person.display))) people.set(fold(person.display), person);
    }
  }
  return [...people.values()];
}

/** Authors of the catalogue whose surname (and first name, for short surnames) the title names. */
function authorsInTitle(title, people) {
  const folded = ` ${fold(title)} `;
  const hit = (name) => folded.includes(` ${fold(name)} `);
  return people
    .filter((person) => hit(person.surname) && (fold(person.surname).length >= 5 || (person.first && hit(person.first.split(' ')[0]))))
    .map((person) => ({ person, at: folded.indexOf(` ${fold(person.surname)} `) }))
    .sort((a, b) => a.at - b.at)
    .map((item) => item.person)
    .slice(0, 3);
}

/**
 * A name-shaped segment ("Darius Hinks") of a listing such as "Zabójca Pentaków - Darius Hinks".
 * The first segment is the title in nearly every listing, so it is never taken for a name.
 */
function nameSegment(title) {
  for (const segment of String(title).split(/\s[-–—|]\s|,\s/).slice(1)) {
    const text = clean(segment.replace(NOISE, ' '));
    if (/^(?:\p{Lu}[\p{Ll}'’-]+|\p{Lu}\.)(?:\s(?:\p{Lu}[\p{Ll}'’-]+|\p{Lu}\.)){1,2}$/u.test(text)) return text;
  }
  return null;
}

function removeName(text, person) {
  let result = text;
  for (const form of [person.display, `${person.surname} ${person.first}`, person.surname])
    if (form) result = result.replace(word(form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), ' ');
  return result;
}

function sentenceCase(text) {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 4 || letters !== letters.toLocaleUpperCase('pl')) return text;
  const lower = text.toLocaleLowerCase('pl');
  return lower.charAt(0).toLocaleUpperCase('pl') + lower.slice(1);
}

/** Title of the book from a listing: no universe names, no author, no sales words. */
export function titleFromListing(title, authors = []) {
  let text = String(title ?? '').replace(/#/g, ' ').replace(NOISE, ' ');
  for (const author of authors) {
    const person = personName(author);
    if (person) text = removeName(text, person);
  }
  // Leftover initials ("C.L." of "C.L. Werner") and the volume ("tom IV", "Tom 13"): the volume
  // belongs to the series, not to the book's title.
  text = text
    .replace(/(?<![\p{L}\d])(?:\p{Lu}\.\s?){1,3}(?![\p{L}\d])/gu, ' ')
    .replace(/(?<![\p{L}\d])(?:tom|t\.|cz\.|część|księga|ks\.)\s*(?:[ivxlc]+|\d{1,3})(?![\p{L}\d])/giu, ' ');
  // "Tytuł - Autor" leaves a dangling separator; keep the first meaningful segment when the
  // listing is "Tytuł | Seria | ..." and the rest is only noise.
  const segments = text.split(/\s[-–—|]\s/).map(clean).filter((segment) => fold(segment).length >= 3);
  return sentenceCase(clean((segments[0] ?? clean(text)).replace(/\s*[,;]\s*$/, '')));
}

function sameIsbnOffers(repository, isbn) {
  const keys = isbnKeys(isbn);
  if (!keys.length) return [];
  return repository.database
    .prepare(
      `SELECT j.id AS job_id, j.status, o.id AS offer_id, o.original_title, o.matched_queries_json, e.facts_json
       FROM offers o JOIN identification_jobs j ON j.offer_id=o.id AND j.job_type='identify_edition'
       LEFT JOIN offer_enrichment e ON e.offer_id=o.id
       WHERE upper(replace(replace(o.observed_isbn,'-',''),' ','')) IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(keys));
}

function jobOffer(repository, jobId) {
  const row = repository.database
    .prepare(
      `SELECT j.id, j.status, j.offer_id, o.original_title, o.observed_isbn
       FROM identification_jobs j JOIN offers o ON o.id=j.offer_id WHERE j.id=?`,
    )
    .get(String(jobId));
  if (!row) throw Object.assign(Error('IDENTIFICATION_JOB_NOT_FOUND'), { statusCode: 404 });
  return row;
}

/** Draft of an edition for an offer whose ISBN nobody knows, built from all offers with that ISBN. */
export function offerEditionDraft(repository, jobId) {
  const job = jobOffer(repository, jobId);
  const isbn = normalizeISBN(job.observed_isbn);
  const offers = isbn ? sameIsbnOffers(repository, isbn) : [];
  if (!offers.some((offer) => offer.job_id === job.id)) offers.push({ ...job, job_id: job.id, matched_queries_json: '[]' });
  const people = knownPeople(repository);
  const authorVotes = new Map();
  const vote = (name, weight) => {
    const person = personName(name);
    if (!person) return;
    const key = fold(person.display);
    const known = authorVotes.get(key) ?? { name: person.display, score: 0 };
    known.score += weight;
    authorVotes.set(key, known);
  };
  for (const offer of offers) {
    let facts = null;
    try {
      facts = offer.facts_json ? JSON.parse(offer.facts_json) : null;
    } catch {}
    for (const name of facts?.authors ?? []) vote(name, 3);
    for (const person of authorsInTitle(offer.original_title, people)) vote(person.display, 2);
  }
  // A name-shaped part of the listing counts only when nothing better names the author.
  if (!authorVotes.size)
    for (const offer of offers) {
      const segment = nameSegment(offer.original_title);
      if (segment) vote(segment, 1);
    }
  const authors = [...authorVotes.values()]
    .sort((a, b) => b.score - a.score)
    .filter((item, index, all) => index === 0 || item.score >= all[0].score / 2)
    .slice(0, 2)
    .map((item) => item.name);
  // The title most listings agree on wins; then this offer's own; then the shorter one.
  const listings = offers.map((offer) => ` ${fold(offer.original_title)} `);
  const titles = [...new Set(offers.map((offer) => titleFromListing(offer.original_title, authors)))]
    .filter((title) => fold(title).length >= 3)
    .map((title) => ({
      title,
      votes: listings.filter((listing) => listing.includes(` ${fold(title)} `)).length,
      own: title === titleFromListing(job.original_title, authors),
    }))
    .sort((a, b) => b.votes - a.votes || b.own - a.own || a.title.length - b.title.length)
    .map((item) => item.title);
  let queries = [];
  for (const offer of offers)
    try {
      queries.push(...JSON.parse(offer.matched_queries_json || '[]'));
    } catch {}
  queries = [...new Set(queries)];
  // A lubimyczytac.pl page with this exact ISBN (looked up in the background) beats the listings.
  const record = isbn ? storedIsbnRecord(repository, isbn) : null;
  return {
    jobId: job.id,
    isbn,
    title: record?.title || titles[0] || clean(job.original_title).slice(0, 200),
    authors: record?.authors?.length ? record.authors.slice(0, 2) : authors,
    ...(record
      ? { record: { source: 'lubimyczytac.pl', url: record.url, publisher: record.publisher, publicationYear: record.publicationYear, cycle: record.cycle, pages: record.pages } }
      : {}),
    universe: universeOf([job.original_title, ...queries].join(' ')),
    siblings: offers.filter((offer) => offer.job_id !== job.id && offer.status === 'review_required').length,
    listings: offers.slice(0, 8).map((offer) => offer.original_title),
  };
}

function validInput(input) {
  const title = clean(input?.title);
  if (!title || title.length > 300) throw Object.assign(Error('INVALID_BOOK_TITLE'), { statusCode: 400 });
  const authors = [].concat(input?.authors ?? [])
    .map((name) => clean(name))
    .filter(Boolean)
    .slice(0, 5);
  if (authors.some((name) => name.length > 120)) throw Object.assign(Error('INVALID_AUTHOR'), { statusCode: 400 });
  const isbn = normalizeISBN(input?.isbn);
  if (!isbn) throw Object.assign(Error('INVALID_ISBN'), { statusCode: 400 });
  const publisher = clean(input?.publisher).slice(0, 200) || null;
  const year = Number(input?.publicationYear);
  return { title, authors, isbn, publisher, publicationYear: Number.isInteger(year) && year >= 1400 && year <= 2100 ? year : null };
}

/**
 * Creates (or reuses) the edition with this ISBN and assigns the offer to it as a manual decision.
 * The other offers with the same ISBN follow automatically (see requeueReviewsWithKnownIsbn).
 */
export function createEditionFromOffer(repository, jobId, input = {}, { now = () => new Date() } = {}) {
  const { title, authors, isbn, publisher, publicationYear } = validInput(input);
  // Publisher, year and cycle confirmed by a page with this exact ISBN (lubimyczytac.pl).
  const record = storedIsbnRecord(repository, isbn);
  const job = jobOffer(repository, jobId);
  if (job.status !== 'review_required') throw Object.assign(Error('REVIEW_JOB_NOT_PENDING'), { statusCode: 409 });
  const at = now().toISOString();
  return repository.transaction(() => {
    let edition = repository.findEditionByISBN(isbn);
    let created = false;
    if (!edition) {
      // A reprint of a book already in the catalogue joins its work (same strict key as the resolver).
      const work =
        findWorkByKey(repository, title, authors) ??
        repository.createWork({ id: randomUUID(), title, normalizedTitle: fold(title), authors, verificationStatus: 'unverified', at });
      edition = repository.createEdition({
        id: randomUUID(),
        workId: work.id,
        title,
        publisher: publisher ?? record?.publisher ?? null,
        publicationYear: publicationYear ?? record?.publicationYear ?? null,
        verificationStatus: 'unverified',
        at,
      });
      if (record?.cycle?.name)
        storeSeriesStatements(repository, edition.id, [{ name: record.cycle.name, volume: record.cycle.volume, kind: 'cycle' }], 'lubimyczytac');
      const keys = isbnKeys(isbn).length ? isbnKeys(isbn) : [isbn];
      for (const key of keys)
        repository.attachIdentifier(edition.id, key.length === 10 ? 'isbn10' : 'isbn13', key, {
          source: 'offer_listing',
          verificationStatus: 'unverified',
          at,
        });
      repository.database
        .prepare('INSERT OR IGNORE INTO offer_editions(edition_id,offer_id,isbn,created_at,checked_at) VALUES(?,?,?,?,?)')
        .run(edition.id, job.offer_id, keys.find((key) => key.length === 13) ?? keys[0], at, at);
      created = true;
    }
    const decision = decideIdentificationJob(repository, job.id, {
      action: 'approved',
      editionId: edition.id,
      reason: created
        ? record
          ? 'Wydanie utworzone z ogłoszenia — ISBN nieznany BN, Open Library i e-ISBN; opis z lubimyczytac.pl (ten sam ISBN).'
          : 'Wydanie utworzone z ogłoszenia — ISBN nieznany BN, Open Library i Google Books.'
        : 'Przypisano do wydania z tym ISBN.',
    }, { now });
    return { editionId: edition.id, workId: edition.work_id, created, decision: decision.decision };
  });
}

function primaryRecords(metadata) {
  for (const entry of [metadata?.bn, metadata?.openLibrary, metadata?.eIsbn, metadata?.googleBooks])
    if (entry?.status === 'found' && entry.records?.length) return entry.records;
  return [];
}

/** Gives an offer-made edition the bibliographic record that a source finally returned. */
export function upgradeOfferEdition(repository, editionId, metadata, { now = () => new Date() } = {}) {
  const edition = repository.database.prepare('SELECT * FROM editions WHERE id=?').get(editionId);
  if (!edition) return { upgraded: false, reason: 'edition_not_found' };
  const records = primaryRecords(metadata);
  if (!records.length) return { upgraded: false, reason: 'not_found' };
  const record = records.length === 1 ? records[0] : chooseAmongRecords(records, edition.title);
  if (!record) return { upgraded: false, reason: 'multiple_records' };
  const at = now().toISOString();
  repository.transaction(() => {
    repository.database
      .prepare(
        `UPDATE editions SET title=?, publisher=COALESCE(?,publisher), publication_year=COALESCE(?,publication_year),
           language=COALESCE(?,language), binding=COALESCE(?,binding), verification_status='verified', updated_at=? WHERE id=?`,
      )
      .run(
        String(record.title || edition.title).slice(0, 500),
        normalizePublisher(record.publisher),
        Number.isInteger(Number(record.publicationYear)) && record.publicationYear >= 1400 && record.publicationYear <= 2100
          ? Number(record.publicationYear)
          : null,
        record.language || null,
        record.binding || null,
        at,
        edition.id,
      );
    const work = repository.database.prepare('SELECT * FROM works WHERE id=?').get(edition.work_id);
    // Only a work this listing created is rewritten; a known work keeps its operator-checked title.
    if (work?.verification_status === 'unverified')
      repository.database
        .prepare("UPDATE works SET title=?, normalized_title=?, authors_json=?, verification_status='verified', updated_at=? WHERE id=?")
        .run(String(record.title || work.title).slice(0, 500), fold(record.title || work.title), JSON.stringify(record.authors?.length ? record.authors : JSON.parse(work.authors_json || '[]')), at, work.id);
    repository.database
      .prepare("UPDATE edition_identifiers SET verification_status='verified' WHERE edition_id=? AND scheme IN ('isbn10','isbn13')")
      .run(edition.id);
    const scheme = record.source === 'open_library' ? 'open_library' : record.source === 'bn' ? 'bn' : null;
    if (scheme && record.externalRecordId)
      try {
        repository.attachIdentifier(edition.id, scheme, record.externalRecordId, { source: record.source, verificationStatus: 'verified', at });
      } catch {}
    persistMetadataResults(repository, [metadata.bn, metadata.openLibrary, metadata.eIsbn, metadata.googleBooks].filter(Boolean), {
      workId: edition.work_id,
      editionId: edition.id,
    });
    const external = repository.database
      .prepare('SELECT id FROM external_records WHERE provider=? AND external_id=?')
      .all(record.source, record.externalRecordId);
    for (const row of external)
      repository.database
        .prepare('INSERT OR IGNORE INTO external_record_links(external_record_id,work_id,edition_id,linked_at) VALUES(?,?,?,?)')
        .run(row.id, edition.work_id, edition.id, at);
    enrichEdition(repository, edition.id, { now });
    if (record.source === 'e_isbn' && record.payload?.onix?.series?.length)
      storeSeriesStatements(repository, edition.id, record.payload.onix.series, 'e_isbn');
    repository.database.prepare('UPDATE offer_editions SET upgraded_at=?, last_outcome=? WHERE edition_id=?').run(at, 'upgraded', edition.id);
  });
  return { upgraded: true, source: record.source };
}

/** About once a week per edition: asks the sources again about offer-made editions. */
export async function recheckOfferEditions(catalog, { limit = 3, now = () => new Date() } = {}) {
  const repository = catalog.repository;
  const due = new Date(now().getTime() - RECHECK_AFTER_MS).toISOString();
  const rows = repository.database
    .prepare(
      `SELECT x.edition_id, x.isbn FROM offer_editions x JOIN editions e ON e.id=x.edition_id
       WHERE x.upgraded_at IS NULL AND e.verification_status<>'verified' AND (x.checked_at IS NULL OR x.checked_at<=?)
       ORDER BY x.checked_at LIMIT ?`,
    )
    .all(due, Math.max(1, limit));
  const report = { checked: 0, upgraded: 0, waiting: 0, errors: 0 };
  for (const row of rows) {
    let metadata;
    try {
      metadata = await catalog.lookupIsbn(row.isbn);
    } catch {
      metadata = null;
    }
    report.checked += 1;
    const temporary = !metadata || metadata.bn?.status === 'temporary_error';
    const result = metadata ? upgradeOfferEdition(repository, row.edition_id, metadata, { now }) : { upgraded: false, reason: 'error' };
    if (result.upgraded) report.upgraded += 1;
    else if (temporary && !primaryRecords(metadata).length) report.errors += 1;
    else report.waiting += 1;
    if (!result.upgraded)
      repository.database
        .prepare('UPDATE offer_editions SET checked_at=?, check_count=check_count+1, last_outcome=? WHERE edition_id=?')
        .run(
          // A source outage is retried the next day, not in a week.
          temporary ? new Date(now().getTime() - RECHECK_AFTER_MS + RETRY_SOON_MS).toISOString() : now().toISOString(),
          String(result.reason || 'not_found').slice(0, 60),
          row.edition_id,
        );
  }
  return report;
}
