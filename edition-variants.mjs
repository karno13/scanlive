// One book, many editions. Picking the exact edition of a listing without an ISBN is guesswork,
// and prices split over ten editions say nothing. So:
//  - an offer may be assigned to the book only: it lands on the work's "unknown edition"
//    (a placeholder edition with no identifiers) and the operator can name the edition later;
//  - editions that sell for about the same price form a price variant (same publisher and
//    binding; omnibus, collector's and foreign-language editions apart). The operator can move
//    an edition to another variant or to its own;
//  - prices are read per book: all offers together, then per variant.
import { randomUUID } from 'node:crypto';
import { fold } from './title-proposals.mjs';
import { normalizePublisher } from './publisher-names.mjs';
import { isbnKeys } from './isbn-normalization.mjs';

const POLISH = /^(?:pol|pl|polski|polish)?$/i;
// First words that say nothing about which publisher it is ("Dom Wydawniczy Rebis").
const GENERIC_WORDS = new Set(['dom', 'wydawnictwo', 'wydawnictwa', 'wydawniczy', 'oficyna', 'grupa', 'the', 'editions', 'edition', 'i', 'media', 'publishing', 'books', 'ksiazka']);
const SPECIAL = /kolekcjoner|limitowan|ekskluzywn|deluxe|ilustrowan|jubileusz|\bbox\b|komplet|pakiet|collector|illustrated/;

function fail(code, statusCode = 400) {
  throw Object.assign(Error(code), { statusCode });
}

/** "oprawa twarda" / "hardcover" -> 'hard', "oprawa miękka" / "paperback" -> 'soft', else null. */
export function bindingClass(binding) {
  const text = fold(binding ?? '');
  if (!text) return null;
  if (/tward|hard|kartonowa|płóc|ploc|cloth/.test(text)) return 'hard';
  if (/miek|miękk|broszur|paper|kieszon|soft|zeszyt/.test(text)) return 'soft';
  return null;
}

/** "Prószyński i S-ka" and "Prószyński Media" -> "proszynski"; "Dom Wydawniczy Rebis" -> "rebis". */
export function publisherKey(publisher) {
  const name = fold(normalizePublisher(publisher) ?? '');
  if (!name) return '';
  const words = name.split(/[^\p{L}\d]+/u).filter(Boolean);
  return words.find((word) => !GENERIC_WORDS.has(word) && word.length >= 2) || words[0] || '';
}

function displayPublisher(editions) {
  const counts = new Map();
  for (const edition of editions) {
    const name = normalizePublisher(edition.publisher);
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] || '';
}

/** An omnibus ("Kolor magii : Blask fantastyczny ; Czarodzicielstwo") is not the single book. */
function isOmnibus(edition, workTitle) {
  const title = String(edition.title ?? '');
  const own = fold(String(workTitle ?? '').split(' / ')[0]);
  return / ; /.test(title.split(' / ')[0]) && fold(title).length > own.length + 8;
}

/**
 * Computed variant of each edition: publisher and binding. Editions whose binding is not recorded
 * form their own "oprawa nieznana" variant when the publisher also has editions with a known
 * binding; the operator can merge them.
 */
export function computeVariants(editions, { workTitle = '', overrides = new Map() } = {}) {
  const real = editions.filter((edition) => !edition.isUnknown);
  const base = new Map();
  for (const edition of real) {
    const special = SPECIAL.test(fold(`${edition.title ?? ''} ${edition.binding ?? ''}`)) ? 'special' : isOmnibus(edition, workTitle) ? 'omnibus' : '';
    const language = String(edition.language ?? '').trim();
    const foreign = language && !POLISH.test(language) ? fold(language) : '';
    base.set(edition.id, { publisher: publisherKey(edition.publisher) || 'unknown', binding: bindingClass(edition.binding), special, foreign });
  }
  const knownBindings = new Map();
  for (const [, item] of base) {
    if (item.special || item.foreign || !item.binding) continue;
    if (!knownBindings.has(item.publisher)) knownBindings.set(item.publisher, new Set());
    knownBindings.get(item.publisher).add(item.binding);
  }
  const keyOf = new Map();
  for (const [id, item] of base) {
    let key;
    if (item.foreign) key = `lang:${item.foreign}:${item.publisher}`;
    else if (item.special) key = `${item.special}:${item.publisher}`;
    else {
      const known = knownBindings.get(item.publisher);
      // An unrecorded binding never joins a known one: old reprints are often paperbacks even
      // when the newest edition is a hardcover.
      const binding = item.binding || (known?.size ? 'unknown' : 'any');
      key = `pub:${item.publisher}:${binding}`;
    }
    keyOf.set(id, overrides.get(id) || key);
  }
  const groups = new Map();
  for (const edition of real) {
    const key = keyOf.get(edition.id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edition);
  }
  return [...groups].map(([key, members]) => ({
    key,
    label: variantLabel(key, members),
    manual: members.some((edition) => overrides.has(edition.id)),
    editionIds: members.map((edition) => edition.id),
    years: [...new Set(members.map((edition) => edition.publicationYear).filter(Boolean))].sort((a, b) => a - b),
  }));
}

const BINDING_LABEL = { hard: 'oprawa twarda', soft: 'oprawa miękka', unknown: 'oprawa nieznana', any: '' };

function variantLabel(key, members) {
  const publisher = displayPublisher(members) || 'wydawca nieznany';
  const [kind, a, b] = key.split(':');
  if (kind === 'pub') return [publisher, BINDING_LABEL[b] ?? ''].filter(Boolean).join(' · ');
  if (kind === 'lang') return `${publisher} · język: ${a}`;
  if (kind === 'special') return `${publisher} · wydanie specjalne`;
  if (kind === 'omnibus') return `${publisher} · wydanie zbiorcze`;
  return `${publisher} · wariant własny`;
}

function overridesFor(db, editionIds) {
  if (!editionIds.length) return new Map();
  return new Map(
    db
      .prepare(`SELECT edition_id, variant_key FROM edition_variant_overrides WHERE edition_id IN (${editionIds.map(() => '?').join(',')})`)
      .all(...editionIds)
      .map((row) => [row.edition_id, row.variant_key]),
  );
}

function workEditions(db, workId) {
  return db
    .prepare('SELECT id, title, publisher, publication_year, language, binding, is_unknown FROM editions WHERE work_id=? ORDER BY publication_year, title')
    .all(workId)
    .map((row) => ({
      id: row.id,
      title: row.title,
      publisher: row.publisher,
      publicationYear: row.publication_year,
      language: row.language,
      binding: row.binding,
      isUnknown: row.is_unknown === 1,
    }));
}

function liveWorkId(db, workId) {
  const alias = db.prepare('SELECT target_id FROM catalog_work_merges WHERE source_id=?').get(String(workId));
  return alias ? liveWorkId(db, alias.target_id) : String(workId);
}

export function variantsOfWork(repository, workId) {
  const db = repository.database;
  const id = liveWorkId(db, workId);
  const work = db.prepare('SELECT id, title FROM works WHERE id=?').get(id);
  if (!work) return null;
  const editions = workEditions(db, id);
  return { work, editions, variants: computeVariants(editions, { workTitle: work.title, overrides: overridesFor(db, editions.map((e) => e.id)) }) };
}

/** The work's placeholder edition, created on first use. */
export function ensureUnknownEdition(repository, workId, { now = () => new Date(), idFactory = randomUUID } = {}) {
  const db = repository.database;
  const id = liveWorkId(db, workId);
  const work = db.prepare('SELECT id, title FROM works WHERE id=?').get(id);
  if (!work) fail('WORK_NOT_FOUND', 404);
  const existing = db.prepare('SELECT id FROM editions WHERE work_id=? AND is_unknown=1 ORDER BY created_at, id LIMIT 1').get(id);
  if (existing) return existing.id;
  const editionId = `unknown_${idFactory()}`;
  const at = now().toISOString();
  db.prepare(
    "INSERT INTO editions(id, work_id, title, publisher, publication_year, language, binding, verification_status, created_at, updated_at, is_unknown) VALUES(?,?,?,NULL,NULL,NULL,NULL,'manual',?,?,1)",
  ).run(editionId, id, String(work.title).slice(0, 500), at, at);
  return editionId;
}

const YEAR = /(?<!\d)(19[5-9]\d|20[0-3]\d)(?!\d)/g;

/** What the listing says about its edition: years, binding, publisher words. */
export function listingHints(text) {
  const folded = fold(text ?? '');
  const years = [...new Set([...folded.matchAll(YEAR)].map((match) => Number(match[1])))];
  const hard = /twarda|twardej|hardcover|hard cover|\bhc\b/.test(folded);
  const soft = /miekka|miekkiej|paperback|broszur|kieszonkow/.test(folded);
  return { folded, years, binding: hard && !soft ? 'hard' : soft && !hard ? 'soft' : null };
}

/**
 * Which edition of `workId` the offer is, when the listing makes it clear: its ISBN, the only
 * edition of the book, or listing hints (year, binding, publisher) that fit exactly one edition.
 * Otherwise null: the offer goes to the unknown edition.
 */
export function chooseEditionForOffer(repository, workId, offerId) {
  const db = repository.database;
  const id = liveWorkId(db, workId);
  const editions = workEditions(db, id).filter((edition) => !edition.isUnknown);
  if (!editions.length) return { editionId: null, reason: 'no_editions' };
  const offer = db.prepare('SELECT original_title, observed_isbn FROM offers WHERE id=?').get(String(offerId)) || {};
  const keys = isbnKeys(offer.observed_isbn ?? '');
  if (keys.length) {
    const byIsbn = db
      .prepare(
        `SELECT e.id FROM edition_identifiers i JOIN editions e ON e.id=i.edition_id WHERE e.work_id=? AND i.scheme IN ('isbn13','isbn10') AND i.normalized_value IN (${keys.map(() => '?').join(',')})`,
      )
      .get(id, ...keys);
    if (byIsbn) return { editionId: byIsbn.id, reason: 'isbn' };
  }
  if (editions.length === 1) return { editionId: editions[0].id, reason: 'only_edition' };
  const description = db.prepare("SELECT text FROM offer_descriptions WHERE offer_id=? AND status='found'").get(String(offerId))?.text || '';
  const hints = listingHints(`${offer.original_title ?? ''} ${description}`);
  let pool = editions;
  const used = [];
  if (hints.years.length) {
    const byYear = pool.filter((edition) => hints.years.includes(edition.publicationYear));
    if (byYear.length) { pool = byYear; used.push('year'); }
  }
  if (hints.binding) {
    const byBinding = pool.filter((edition) => bindingClass(edition.binding) === hints.binding);
    if (byBinding.length) { pool = byBinding; used.push('binding'); }
  }
  const named = pool.filter((edition) => {
    const key = publisherKey(edition.publisher);
    return key.length >= 4 && hints.folded.includes(key);
  });
  if (named.length && named.length < pool.length) { pool = named; used.push('publisher'); }
  if (pool.length === 1 && used.length) return { editionId: pool[0].id, reason: `listing:${used.join('+')}` };
  return { editionId: null, reason: 'ambiguous' };
}

/** The edition for an approval: the chosen one, or the one the listing points at, or unknown. */
export function editionForWorkAssignment(repository, workId, offerId, options = {}) {
  const chosen = chooseEditionForOffer(repository, workId, offerId);
  if (chosen.editionId) return chosen;
  return { editionId: ensureUnknownEdition(repository, workId, options), reason: chosen.reason, unknown: true };
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function stats(offers) {
  const live = offers.filter((item) => !['unavailable', 'sold', 'reserved'].includes(item.availability) && item.currency === 'PLN' && item.price > 0).map((item) => item.price).sort((a, b) => a - b);
  const sold = offers.filter((item) => item.availability === 'sold' && item.currency === 'PLN' && item.price > 0).map((item) => item.price).sort((a, b) => a - b);
  return {
    offers: offers.length,
    live: live.length,
    median: median(live),
    min: live[0] ?? null,
    max: live.at(-1) ?? null,
    sold: sold.length,
    soldMedian: median(sold),
  };
}

/**
 * Prices of a book: every offer assigned to any of its editions, overall and per variant, with
 * the recorded price observations for a chart. Offer prices, not sale prices.
 */
export function workPriceOverview(repository, workId) {
  const db = repository.database;
  const base = variantsOfWork(repository, workId);
  if (!base) return null;
  const { work, editions, variants } = base;
  const variantOf = new Map();
  for (const variant of variants) for (const editionId of variant.editionIds) variantOf.set(editionId, variant.key);
  const unknownIds = new Set(editions.filter((edition) => edition.isUnknown).map((edition) => edition.id));
  const rows = editions.length
    ? db
        .prepare(
          `SELECT o.id, o.source, o.original_title, o.current_price, o.currency, o.availability, o.last_seen_at, m.edition_id
           FROM offer_matches m JOIN offers o ON o.id=m.offer_id
           WHERE m.status='active' AND m.edition_id IN (${editions.map(() => '?').join(',')})
           ORDER BY o.last_seen_at DESC`,
        )
        .all(...editions.map((edition) => edition.id))
    : [];
  const offers = rows.map((row) => ({
    id: row.id,
    source: row.source,
    title: row.original_title,
    price: row.current_price,
    currency: row.currency,
    availability: row.availability,
    lastSeenAt: row.last_seen_at,
    editionId: row.edition_id,
    variant: unknownIds.has(row.edition_id) ? 'unknown' : variantOf.get(row.edition_id) ?? 'unknown',
  }));
  const history = offers.length
    ? db
        .prepare(
          `SELECT offer_id, price, observed_at FROM offer_price_history WHERE offer_id IN (${offers.map(() => '?').join(',')}) ORDER BY observed_at`,
        )
        .all(...offers.map((item) => item.id))
    : [];
  const variantOfOffer = new Map(offers.map((item) => [item.id, item.variant]));
  const currencyOf = new Map(offers.map((item) => [item.id, item.currency]));
  return {
    workId: work.id,
    title: work.title,
    overall: stats(offers),
    variants: variants.map((variant) => ({ ...variant, ...stats(offers.filter((item) => item.variant === variant.key)) })),
    unknown: { editionIds: [...unknownIds], ...stats(offers.filter((item) => item.variant === 'unknown')) },
    offers,
    points: history
      .filter((point) => currencyOf.get(point.offer_id) === 'PLN')
      .map((point) => ({ offerId: point.offer_id, price: point.price, observedAt: point.observed_at, variant: variantOfOffer.get(point.offer_id) })),
  };
}

/**
 * Moves an edition to the variant `variantKey` (another variant's key), to a new variant of its
 * own (`'own'`), or back to the computed one (`null`).
 */
export function setEditionVariant(repository, editionId, variantKey, { now = () => new Date() } = {}) {
  const db = repository.database;
  const edition = db.prepare('SELECT id, work_id, is_unknown FROM editions WHERE id=?').get(String(editionId ?? ''));
  if (!edition) fail('EDITION_NOT_FOUND', 404);
  if (edition.is_unknown === 1) fail('UNKNOWN_EDITION_HAS_NO_VARIANT', 409);
  if (variantKey == null || variantKey === '') {
    db.prepare('DELETE FROM edition_variant_overrides WHERE edition_id=?').run(edition.id);
  } else {
    const key = variantKey === 'own' ? `own:${randomUUID()}` : String(variantKey);
    if (key.length > 200) fail('INVALID_VARIANT');
    if (variantKey !== 'own' && !variantsOfWork(repository, edition.work_id).variants.some((variant) => variant.key === key)) fail('VARIANT_NOT_FOUND', 404);
    db.prepare(
      'INSERT INTO edition_variant_overrides(edition_id, variant_key, updated_at) VALUES(?,?,?) ON CONFLICT(edition_id) DO UPDATE SET variant_key=excluded.variant_key, updated_at=excluded.updated_at',
    ).run(edition.id, key, now().toISOString());
  }
  return variantsOfWork(repository, edition.work_id);
}

/** All editions of variant `fromKey` join variant `toKey` (both of the same work). */
export function mergeVariants(repository, workId, fromKey, toKey, { now = () => new Date() } = {}) {
  const base = variantsOfWork(repository, workId);
  if (!base) fail('WORK_NOT_FOUND', 404);
  const from = base.variants.find((variant) => variant.key === fromKey);
  const to = base.variants.find((variant) => variant.key === toKey);
  if (!from || !to) fail('VARIANT_NOT_FOUND', 404);
  if (from.key === to.key) fail('SAME_VARIANT');
  const at = now().toISOString();
  return repository.transaction(() => {
    const upsert = repository.database.prepare(
      'INSERT INTO edition_variant_overrides(edition_id, variant_key, updated_at) VALUES(?,?,?) ON CONFLICT(edition_id) DO UPDATE SET variant_key=excluded.variant_key, updated_at=excluded.updated_at',
    );
    // Pin the target's members too: its computed key might otherwise change later.
    for (const editionId of [...to.editionIds, ...from.editionIds]) upsert.run(editionId, to.key, at);
    return variantsOfWork(repository, workId);
  });
}
