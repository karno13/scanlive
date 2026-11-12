// @ts-check
// Four measures of "Dziś", each computed in SQL (no figure comes from the browser):
//  - recognition: offers recognised automatically (an active match that no human made) out of the
//    offers still in play (not rejected as "not a book" or excluded);
//  - oldestDecisionDays: age of the oldest decision waiting in the review queue;
//  - completeEditions: editions with publisher and year (without "Wydanie nieustalone");
//  - confirmedAvailability: offers whose availability a page or the shop's own code confirmed.
// A snapshot per day and measure (migration 132) gives the trend: the change against the oldest
// snapshot of the last seven days; none yet means no trend ("od jutra").
import { catalogGaps } from './catalog-insights.mjs';

const DAY_MS = 86_400_000;
const pct = (/** @type {number} */ part, /** @type {number} */ total) =>
  total ? Math.round((part / total) * 1000) / 10 : 0;

/** @param {{ database: any }} repository @param {Date} at */
export function measureValues(repository, at = new Date()) {
  const db = repository.database;
  const recognition = db
    .prepare(
      `SELECT count(*) AS offers,
         sum(CASE WHEN EXISTS (SELECT 1 FROM offer_matches m WHERE m.offer_id=o.id AND m.status='active'
               AND m.created_by<>'local_user' AND m.method NOT IN ('manual','legacy_manual')) THEN 1 ELSE 0 END) AS auto
       FROM offers o
       WHERE NOT EXISTS (SELECT 1 FROM review_decisions d WHERE d.offer_id=o.id AND d.action IN ('not_book','excluded'))`,
    )
    .get();
  // The operator's queue: what the review list counts (Empik jobs are reference enrichment).
  const oldest = db
    .prepare(
      `SELECT min(j.updated_at) AS since, count(*) AS jobs
       FROM identification_jobs j JOIN offers o ON o.id=j.offer_id
       WHERE j.status='review_required' AND o.source<>'Empik'`,
    )
    .get();
  const availability = db
    .prepare(
      `SELECT count(*) AS offers,
         sum(CASE WHEN availability NOT IN ('unconfirmed','not_seen') THEN 1 ELSE 0 END) AS confirmed
       FROM offers`,
    )
    .get();
  const gaps = catalogGaps(repository);
  const sinceMs = oldest.since ? Date.parse(oldest.since) : NaN;
  return {
    recognition: {
      value: pct(Number(recognition.auto || 0), Number(recognition.offers || 0)),
      part: Number(recognition.auto || 0),
      total: Number(recognition.offers || 0),
    },
    oldestDecisionDays: {
      value: Number.isFinite(sinceMs)
        ? Math.max(0, Math.floor((at.getTime() - sinceMs) / DAY_MS))
        : 0,
      since: oldest.since || null,
      total: Number(oldest.jobs || 0),
    },
    completeEditions: {
      value: gaps.completePct,
      part: gaps.completeEditions,
      total: gaps.editions,
    },
    confirmedAvailability: {
      value: pct(Number(availability.confirmed || 0), Number(availability.offers || 0)),
      part: Number(availability.confirmed || 0),
      total: Number(availability.offers || 0),
    },
  };
}

const KEYS = /** @type {const} */ ([
  'recognition',
  'oldestDecisionDays',
  'completeEditions',
  'confirmedAvailability',
]);

const dayOf = (/** @type {Date} */ at) => at.toISOString().slice(0, 10);

/**
 * The four measures with their trend; records today's snapshot first.
 * @param {{ database: any }} repository
 * @param {{ now?: () => Date }} [options]
 */
export function todayMeasures(repository, { now = () => new Date() } = {}) {
  const at = now();
  const values = measureValues(repository, at);
  const db = repository.database;
  const today = dayOf(at);
  const store = db.prepare(
    `INSERT INTO metric_snapshots (day, key, value, recorded_at) VALUES (?,?,?,?)
     ON CONFLICT(day, key) DO UPDATE SET value=excluded.value, recorded_at=excluded.recorded_at`,
  );
  for (const key of KEYS) store.run(today, key, values[key].value, at.toISOString());
  const from = dayOf(new Date(at.getTime() - 7 * DAY_MS));
  const past = db.prepare(
    'SELECT day, value FROM metric_snapshots WHERE key=? AND day>=? AND day<? ORDER BY day LIMIT 1',
  );
  return KEYS.map((key) => {
    const before = past.get(key, from, today);
    const delta = before ? Math.round((values[key].value - before.value) * 10) / 10 : null;
    return { id: key, ...values[key], trend: before ? { delta, since: before.day } : null };
  });
}
