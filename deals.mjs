// @ts-check
// "Okazje": offers that can be bought now for clearly less than their edition is worth. The worth
// is the market valuation (market-valuation.mjs) of the edition counted WITHOUT the offer itself —
// otherwise a cheap listing would pull its own reference down — and brought to the offer's
// condition. The list is computed from the current offers; only the owner's verdict on an entry
// ("was it a real deal?", deal_verdicts) is stored, to measure how often the list is right.
import {
  CONDITION_FACTOR,
  estimateValue,
  marketObservations,
  valuationOptions,
} from './market-valuation.mjs';
import { proxiedImage } from './offer-images.mjs';

/** An offer is a deal from this share below its worth, and at least this many grosze. */
export const DEAL_MIN_DISCOUNT = 0.2;
export const DEAL_MIN_SAVING = 500;
/** This far below the worth is more often a wrong assignment than a bargain. */
export const DEAL_SUSPICIOUS_DISCOUNT = 0.7;
const BUYABLE = ['available', 'unconfirmed'];
/**
 * Demand for an edition: the median favourite count of its other Vinted listings, from this many.
 * On saved data (2026-11-20) a listing sold 3.4% of the time when the other listings of its edition
 * had a median of 0–1 favourites, 5.1% at 4–7 and 8.6% at 8 or more.
 */
export const DEMAND_MIN_OFFERS = 2;
export const DEMAND_LEVELS = { high: 8, medium: 4 };

/** @param {number[]} counts */
export function editionDemand(counts) {
  if (counts.length < DEMAND_MIN_OFFERS) return null;
  const sorted = [...counts].sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  const level =
    median >= DEMAND_LEVELS.high ? 'high' : median >= DEMAND_LEVELS.medium ? 'medium' : 'low';
  return { median, offers: counts.length, level };
}

/** Owner's verdicts on a deal: real, wrong book or edition, other condition or a set, worth too high. */
export const DEAL_VERDICTS = ['good', 'wrong_match', 'condition', 'overvalued'];

/**
 * @param {{ database: import('node:sqlite').DatabaseSync }} repository
 * @param {{ at?: number }} [options]
 */
export function listDeals(repository, { at = Date.now() } = {}) {
  const database = repository.database;
  const rows = database
    .prepare(
      `SELECT o.id, o.source, o.original_title AS title, o.normalized_url AS url, o.image_url AS image,
         o.current_price AS price, coalesce(o.condition_class,'unknown') AS condition,
         o.favourite_count AS favourites,
         o.first_seen_at AS firstSeenAt, m.edition_id AS editionId, e.title AS editionTitle,
         e.work_id AS workId, w.title AS workTitle
       FROM offer_matches m JOIN offers o ON o.id=m.offer_id
         JOIN editions e ON e.id=m.edition_id JOIN works w ON w.id=e.work_id
       WHERE m.status='active' AND e.is_unknown=0 AND o.currency='PLN' AND o.current_price>0
         AND o.availability IN (${BUYABLE.map((value) => `'${value}'`).join(',')})
         AND NOT EXISTS (SELECT 1 FROM offer_sets s WHERE s.offer_id=o.id AND s.dismissed_at IS NULL)`,
    )
    .all();
  const observations = marketObservations(database, 'edition', [
    ...new Set(rows.map((row) => String(row.editionId))),
  ]);
  const options = valuationOptions(database);
  /** @type {Map<string, { offerId: string, favourites: number }[]>} */
  const favourites = new Map();
  for (const row of database
    .prepare(
      `SELECT m.edition_id AS editionId, o.id AS offerId, o.favourite_count AS favourites
       FROM offer_matches m JOIN offers o ON o.id=m.offer_id
       WHERE m.status='active' AND o.source='Vinted' AND o.favourite_count IS NOT NULL
         AND m.edition_id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify([...observations.keys()]))) {
    const key = String(row.editionId);
    (favourites.get(key) ?? favourites.set(key, []).get(key))?.push({
      offerId: String(row.offerId),
      favourites: Number(row.favourites),
    });
  }
  const verdicts = new Map(
    database
      .prepare('SELECT offer_id, verdict FROM deal_verdicts')
      .all()
      .map((row) => [String(row.offer_id), String(row.verdict)]),
  );
  const items = [];
  for (const row of rows) {
    const others = (observations.get(String(row.editionId)) ?? []).filter(
      (item) => item.offerId !== row.id,
    );
    // New books in shops alone say what a new copy costs, not what a used one resells for.
    if (!others.some((item) => item.kind !== 'new_shop' && item.state !== 'gone')) continue;
    const value = estimateValue(others, at, options);
    if (value.estimate == null || value.sold + value.live < 2) continue;
    const factor = CONDITION_FACTOR[String(row.condition)] ?? 1;
    const worth = Math.round(value.estimate / factor / 100) * 100;
    const price = Number(row.price);
    const saving = worth - price;
    const discount = saving / worth;
    if (discount < DEAL_MIN_DISCOUNT || saving < DEAL_MIN_SAVING || price >= value.low / factor)
      continue;
    items.push({
      offerId: String(row.id),
      title: String(row.title),
      source: String(row.source),
      url: String(row.url),
      image: row.image ? proxiedImage(String(row.image)) : null,
      price,
      condition: String(row.condition),
      firstSeenAt: row.firstSeenAt,
      editionId: String(row.editionId),
      editionTitle: String(row.editionTitle),
      workId: String(row.workId),
      workTitle: String(row.workTitle),
      worth,
      worthLow: Math.round(value.low / factor / 100) * 100,
      worthHigh: Math.round(value.high / factor / 100) * 100,
      saving,
      discount: Math.round(discount * 100),
      suspicious: discount >= DEAL_SUSPICIOUS_DISCOUNT,
      confidence: value.confidence,
      confidenceLabel: value.confidenceLabel,
      sold: value.sold,
      live: value.live,
      reasons: value.reasons,
      favourites: row.favourites == null ? null : Number(row.favourites),
      demand: editionDemand(
        (favourites.get(String(row.editionId)) ?? [])
          .filter((item) => item.offerId !== row.id)
          .map((item) => item.favourites),
      ),
      verdict: verdicts.get(String(row.id)) ?? null,
    });
  }
  items.sort((a, b) => b.saving - a.saving);
  return { items, verdicts: dealVerdictSummary(repository) };
}

/**
 * All verdicts so far, also on offers that are no longer deals: counts per verdict and, per
 * valuation confidence at the time of the verdict, how many were real deals.
 * @param {{ database: import('node:sqlite').DatabaseSync }} repository
 */
export function dealVerdictSummary(repository) {
  const rows = repository.database
    .prepare(
      `SELECT verdict, coalesce(confidence,'none') AS confidence, count(*) AS n
       FROM deal_verdicts GROUP BY 1, 2`,
    )
    .all();
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(DEAL_VERDICTS.map((verdict) => [verdict, 0]));
  /** @type {Record<string, { total: number, good: number }>} */
  const byConfidence = {};
  let total = 0;
  for (const row of rows) {
    const n = Number(row.n);
    total += n;
    counts[String(row.verdict)] += n;
    const bucket = (byConfidence[String(row.confidence)] ??= { total: 0, good: 0 });
    bucket.total += n;
    if (row.verdict === 'good') bucket.good += n;
  }
  return { total, counts, byConfidence };
}

/**
 * Stores the owner's verdict on a deal, with the deal's price, worth and confidence as listed now
 * (null when the offer is no longer on the list). A new verdict replaces the previous one.
 * @param {{ database: import('node:sqlite').DatabaseSync }} repository
 * @param {string} offerId
 * @param {unknown} verdict
 */
export function saveDealVerdict(repository, offerId, verdict, { at = Date.now() } = {}) {
  if (typeof verdict !== 'string' || !DEAL_VERDICTS.includes(verdict))
    throw Object.assign(Error('INVALID_DEAL_VERDICT'), { statusCode: 400 });
  const database = repository.database;
  if (!database.prepare('SELECT 1 FROM offers WHERE id=?').get(offerId))
    throw Object.assign(Error('OFFER_NOT_FOUND'), { statusCode: 404 });
  const deal = listDeals(repository, { at }).items.find((item) => item.offerId === offerId);
  database
    .prepare(
      `INSERT INTO deal_verdicts(offer_id, verdict, price, worth, confidence, created_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(offer_id) DO UPDATE SET verdict=excluded.verdict, price=excluded.price,
         worth=excluded.worth, confidence=excluded.confidence, created_at=excluded.created_at`,
    )
    .run(
      offerId,
      verdict,
      deal?.price ?? null,
      deal?.worth ?? null,
      deal?.confidence ?? null,
      new Date(at).toISOString(),
    );
  return { verdict, verdicts: dealVerdictSummary(repository) };
}

/** Takes a verdict back. @param {{ database: import('node:sqlite').DatabaseSync }} repository */
export function removeDealVerdict(repository, offerId) {
  repository.database.prepare('DELETE FROM deal_verdicts WHERE offer_id=?').run(offerId);
  return { verdict: null, verdicts: dealVerdictSummary(repository) };
}
