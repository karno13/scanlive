// Price statistics in SQL, in grosze (integers). Offers are compared only with comparable offers:
// per kind of offer (new in a shop / antiquarian / private copy) and per condition class, with the
// copies sold on Vinted as a value of their own — the resale price the owner cares about.
import { offerKindSql } from './offer-kinds.mjs';

// live: still offered (or not yet checked); sold: a check found it sold. Removed and reserved
// listings say nothing reliable about the price and are left out of both.
const STATE_SQL = `CASE WHEN o.availability='sold' THEN 'sold' WHEN o.availability IN ('unavailable','reserved') THEN 'gone' ELSE 'live' END`;

/**
 * Statistics of the offers `offerSql` selects (an SQL query returning `offer_id`, optionally `grp`),
 * grouped by `dimension` ('all' | 'kind' | 'condition' | 'grp'). Returns
 * { [key]: { offers, live, median, min, max, sold, soldMedian, soldMin, soldMax } }.
 */
export function groupedPriceStats(database, offerSql, params = [], dimension = 'all') {
  const key = {
    all: "'all'",
    kind: offerKindSql('o'),
    condition: "coalesce(o.condition_class,'unknown')",
    grp: 's.grp',
  }[dimension];
  if (!key) throw Error('INVALID_PRICE_DIMENSION');
  const rows = database
    .prepare(
      `WITH selected AS (${offerSql}),
       base AS (
         SELECT ${key} AS k, ${STATE_SQL} AS state, o.current_price AS price
         FROM selected s JOIN offers o ON o.id=s.offer_id
         WHERE o.currency='PLN' AND o.current_price>0
       ),
       ranked AS (
         SELECT k, state, price,
           row_number() OVER (PARTITION BY k, state ORDER BY price) AS rn,
           count(*) OVER (PARTITION BY k, state) AS cnt
         FROM base
       )
       SELECT k, state, count(*) AS n, min(price) AS lo, max(price) AS hi,
         CAST(round(avg(CASE WHEN rn IN ((cnt+1)/2, (cnt+2)/2) THEN price END)) AS INTEGER) AS median
       FROM ranked GROUP BY k, state`,
    )
    .all(...params);
  const totals = database
    .prepare(`WITH selected AS (${offerSql}) SELECT ${key} AS k, count(*) AS n FROM selected s JOIN offers o ON o.id=s.offer_id GROUP BY k`)
    .all(...params);
  const out = {};
  const empty = () => ({ offers: 0, live: 0, median: null, min: null, max: null, sold: 0, soldMedian: null, soldMin: null, soldMax: null });
  for (const row of totals) (out[row.k] ||= empty()).offers = Number(row.n);
  for (const row of rows) {
    const entry = (out[row.k] ||= empty());
    if (row.state === 'live') Object.assign(entry, { live: Number(row.n), median: row.median, min: row.lo, max: row.hi });
    if (row.state === 'sold') Object.assign(entry, { sold: Number(row.n), soldMedian: row.median, soldMin: row.lo, soldMax: row.hi });
  }
  return out;
}

/** Copies sold on Vinted among the selected offers: the resale reference. */
export function vintedSoldStats(database, offerSql, params = []) {
  const stats = groupedPriceStats(
    database,
    `SELECT s.offer_id FROM (${offerSql}) s JOIN offers v ON v.id=s.offer_id WHERE v.source='Vinted' AND v.availability='sold'`,
    params,
    'all',
  ).all;
  return { count: stats?.sold ?? 0, median: stats?.soldMedian ?? null, min: stats?.soldMin ?? null, max: stats?.soldMax ?? null };
}
