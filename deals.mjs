// @ts-check
// "Okazje": offers that can be bought now for clearly less than their edition is worth. The worth
// is the market valuation (market-valuation.mjs) of the edition counted WITHOUT the offer itself —
// otherwise a cheap listing would pull its own reference down — and brought to the offer's
// condition. Read-only: nothing is stored, the list is computed from the current offers.
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
 * @param {{ database: import('node:sqlite').DatabaseSync }} repository
 * @param {{ at?: number }} [options]
 */
export function listDeals(repository, { at = Date.now() } = {}) {
  const database = repository.database;
  const rows = database
    .prepare(
      `SELECT o.id, o.source, o.original_title AS title, o.normalized_url AS url, o.image_url AS image,
         o.current_price AS price, coalesce(o.condition_class,'unknown') AS condition,
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
    });
  }
  items.sort((a, b) => b.saving - a.saving);
  return { items };
}
