// @ts-check
// Indeks rynku: for every edition, what a used copy resells for (market-valuation.mjs), how likely
// a listed copy is to sell within 30 days and how long that usually takes. Liquidity comes from
// Vinted, the resale channel: every Vinted listing of the edition is time on the market ("offer
// days", from first seen to sold / withdrawn / now) and a sale is an event. Sales per offer day is
// the edition's sale rate; editions with few listings borrow strength from editions with similar
// demand (the median favourite count of their listings), so one lucky sale is not "fast".
// Measured on saved data (2026-11-20, 2 364 listings, 151 sales, 23 388 offer days): 14-day sale
// chance 6.3% at demand 0–3, 12.9% at 8 or more; 2.1% for a listing with no favourite, 11.8% at 10+.
import { editionCovers } from './catalog-api.mjs';
import { marketValuations } from './market-valuation.mjs';
import { firstSurname, mainTitle } from './work-grouping.mjs';
import { fold } from './title-proposals.mjs';

const DAY = 86_400_000;
/** Strength of the demand prior, in offer days: about ten listings watched for ten days. */
export const PRIOR_OFFER_DAYS = 100;
/** The horizon of the sale chance, in days. */
export const HORIZON_DAYS = 30;
/** Sale chance in the horizon from which an edition counts as fast, below which as slow. */
export const LIQUIDITY_LEVELS = { fast: 0.25, slow: 0.13 };
const GONE = new Set(['sold', 'unavailable', 'reserved']);

/** @param {number[]} values */
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};
/** Demand bucket from the median favourite count of an edition's listings (null: no data). */
export function demandBucket(favourites) {
  if (favourites.length < 2) return 'none';
  const value = Number(median(favourites));
  return value >= 8 ? 'high' : value >= 4 ? 'medium' : 'low';
}

/**
 * @typedef {{ sales: number, days: number, listings: number, live: number, favourites: number[] }} EditionMarket
 * @typedef {{ at: number, global: { sales: number, days: number }, buckets: Record<string, { sales: number, days: number }>, editions: Map<string, EditionMarket> }} LiquidityModel
 */

/**
 * The sale-rate model from every Vinted listing matched to an edition.
 * @param {import('node:sqlite').DatabaseSync} database
 * @returns {LiquidityModel}
 */
export function liquidityModel(database, at = Date.now()) {
  const rows = database
    .prepare(
      `SELECT m.edition_id AS editionId, o.availability, o.first_seen_at AS firstSeenAt,
         o.availability_changed_at AS changedAt, o.favourite_count AS favourites
       FROM offer_matches m JOIN offers o ON o.id=m.offer_id
       WHERE m.status='active' AND o.source='Vinted' AND o.first_seen_at IS NOT NULL`,
    )
    .all();
  /** @type {Map<string, EditionMarket>} */
  const editions = new Map();
  for (const row of rows) {
    const id = String(row.editionId);
    const item = editions.get(id) ?? { sales: 0, days: 0, listings: 0, live: 0, favourites: [] };
    editions.set(id, item);
    const availability = String(row.availability);
    const gone = GONE.has(availability) && row.changedAt;
    const end = gone ? Date.parse(String(row.changedAt)) : at;
    item.days += Math.max(0.5, (end - Date.parse(String(row.firstSeenAt))) / DAY);
    item.listings += 1;
    if (availability === 'sold') item.sales += 1;
    if (!GONE.has(availability)) item.live += 1;
    if (row.favourites != null) item.favourites.push(Number(row.favourites));
  }
  const global = { sales: 0, days: 0 };
  /** @type {Record<string, { sales: number, days: number }>} */
  const buckets = {};
  for (const item of editions.values()) {
    global.sales += item.sales;
    global.days += item.days;
    const bucket = (buckets[demandBucket(item.favourites)] ??= { sales: 0, days: 0 });
    bucket.sales += item.sales;
    bucket.days += item.days;
  }
  return { at, global, buckets, editions };
}

/**
 * Liquidity of one edition: sale rate per listing day, the chance to sell within 30 days and the
 * median days to a sale. An edition with no Vinted listing gets its demand bucket's (or the
 * market's) figures with basis 'market'.
 * @param {LiquidityModel} model
 * @param {string} editionId
 */
export function editionLiquidity(model, editionId) {
  const own = model.editions.get(editionId) ?? {
    sales: 0,
    days: 0,
    listings: 0,
    live: 0,
    favourites: [],
  };
  const demand = demandBucket(own.favourites);
  // Without favourites the market as a whole is the prior: the "none" bucket is biased fast (a
  // listing sold before its page was read has no favourite count).
  const bucket = demand === 'none' ? null : model.buckets[demand];
  const prior = bucket && bucket.days >= PRIOR_OFFER_DAYS ? bucket : model.global;
  const priorRate = prior.days ? prior.sales / prior.days : 0;
  const rate = (own.sales + priorRate * PRIOR_OFFER_DAYS) / (own.days + PRIOR_OFFER_DAYS);
  const chance = 1 - Math.exp(-HORIZON_DAYS * rate);
  return {
    chance: Math.round(chance * 1000) / 1000,
    medianDays: rate > 0 ? Math.min(365, Math.round(Math.LN2 / rate)) : null,
    level:
      chance >= LIQUIDITY_LEVELS.fast ? 'fast' : chance < LIQUIDITY_LEVELS.slow ? 'slow' : 'normal',
    sales: own.sales,
    listings: own.listings,
    live: own.live,
    demand,
    demandMedian: own.favourites.length >= 2 ? median(own.favourites) : null,
    basis: own.sales >= 2 ? 'own' : own.listings ? 'mixed' : 'market',
  };
}

const SORTS = {
  // What a listed copy is expected to bring in within 30 days: value × chance to sell.
  turnover: (a, b) => b.turnover - a.turnover || b.value - a.value,
  liquidity: (a, b) => b.liquidity.chance - a.liquidity.chance || b.turnover - a.turnover,
  value: (a, b) => b.value - a.value,
  supply: (a, b) => b.liquidity.live - a.liquidity.live || b.turnover - a.turnover,
};

/**
 * The index: editions with a valuation, their liquidity and turnover, in the chosen order.
 * @param {{ database: import('node:sqlite').DatabaseSync }} repository
 * @param {{ sort?: string, limit?: number|string, offset?: number|string, query?: string, confidence?: string, at?: number }} [options]
 */
export function marketIndex(repository, options = {}) {
  const database = repository.database;
  const at = options.at ?? Date.now();
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
  const offset = Math.max(0, Number(options.offset) || 0);
  const needle = fold(options.query ?? '');
  const rows = database
    .prepare(
      `SELECT e.id AS editionId, e.title AS editionTitle, e.publisher, e.publication_year AS year,
         w.id AS workId, w.title AS workTitle, w.authors_json AS authors
       FROM editions e JOIN works w ON w.id=e.work_id
       WHERE e.is_unknown=0
         AND NOT EXISTS (SELECT 1 FROM catalog_work_merges cm WHERE cm.source_id=w.id)
         AND NOT EXISTS (SELECT 1 FROM removed_works rw WHERE rw.work_id=w.id)
         AND EXISTS (SELECT 1 FROM offer_matches m WHERE m.edition_id=e.id AND m.status='active')`,
    )
    .all()
    .filter(
      (row) =>
        !needle || fold(`${row.workTitle} ${row.editionTitle} ${row.authors}`).includes(needle),
    );
  const valuations = marketValuations(
    database,
    'edition',
    rows.map((row) => String(row.editionId)),
    at,
  );
  const model = liquidityModel(database, at);
  const wanted = options.confidence === 'medium' ? ['medium', 'high'] : null;
  const items = [];
  for (const row of rows) {
    const valuation = valuations.get(String(row.editionId));
    if (!valuation || valuation.estimate == null) continue;
    if (wanted && !wanted.includes(valuation.confidence)) continue;
    const liquidity = editionLiquidity(model, String(row.editionId));
    let authors = [];
    try {
      authors = JSON.parse(String(row.authors || '[]'));
    } catch {}
    items.push({
      editionId: String(row.editionId),
      workId: String(row.workId),
      title: String(row.workTitle),
      editionTitle: String(row.editionTitle),
      authors,
      publisher: row.publisher ?? null,
      year: row.year ?? null,
      value: valuation.estimate,
      low: valuation.low,
      high: valuation.high,
      confidence: valuation.confidence,
      confidenceLabel: valuation.confidenceLabel,
      sold: valuation.sold,
      liquidity,
      turnover: Math.round((valuation.estimate * liquidity.chance) / 100) * 100,
    });
  }
  items.sort(SORTS[String(options.sort)] ?? SORTS.turnover);
  const page = items.slice(offset, offset + limit);
  const covers = editionCovers(
    database,
    page.map((item) => item.editionId),
  );
  return {
    total: items.length,
    limit,
    offset,
    market: {
      listings: [...model.editions.values()].reduce((sum, item) => sum + item.listings, 0),
      sales: model.global.sales,
      chance: model.global.days
        ? Math.round(
            (1 - Math.exp((-HORIZON_DAYS * model.global.sales) / model.global.days)) * 1000,
          ) / 1000
        : null,
    },
    items: page.map((item) => ({ ...item, cover: covers.get(item.editionId) ?? null })),
  };
}

/** A search phrase for a work: its main title, with the author's surname when the title is one word. */
export function sniperPhrase(title, authors) {
  // The words a seller writes: the main title up to a subtitle, a cycle or a volume, at most four.
  const main = mainTitle(title)
    .split(/\s+(?:cykl|seria|tom|t\.|część|cz\.)\s+|\.\s|:|\s[-–—]\s|\(|,/i)[0]
    .replace(/["„”«»]/g, '')
    .replace(/[.\s]+$/, '')
    .split(/\s+/)
    .slice(0, 4)
    .join(' ')
    .trim();
  const words = fold(main).split(' ').filter(Boolean);
  if (!words.length) return '';
  const surname = firstSurname(authors);
  return words.length === 1 && surname && !words.includes(surname)
    ? `${main} ${surname[0].toUpperCase()}${surname.slice(1)}`
    : main;
}

/**
 * What the sniper watches: works whose best edition has a medium or high valuation of at least
 * `minValue` grosze, by expected turnover. One phrase per work.
 * @param {{ database: import('node:sqlite').DatabaseSync }} repository
 */
export function sniperTargets(repository, { limit = 40, minValue = 2500, at = Date.now() } = {}) {
  const { items } = marketIndex(repository, {
    sort: 'turnover',
    limit: 200,
    confidence: 'medium',
    at,
  });
  const seen = new Set();
  const targets = [];
  for (const item of items) {
    if (item.value < minValue || seen.has(item.workId)) continue;
    seen.add(item.workId);
    const phrase = sniperPhrase(item.title, item.authors);
    if (!phrase || targets.some((target) => fold(target.phrase) === fold(phrase))) continue;
    targets.push({
      workId: item.workId,
      title: item.title,
      phrase,
      value: item.value,
      chance: item.liquidity.chance,
    });
    if (targets.length >= limit) break;
  }
  return targets;
}
