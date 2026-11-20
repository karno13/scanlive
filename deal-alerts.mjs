// @ts-check
// "Nowe okazje": a deal (deals.mjs) on an offer first seen in the last two days is announced once,
// as soon as the offer is identified (after every identification pass, background-jobs.mjs). The
// page hears of it through the live channel (/api/events, probe "deals") and shows it at the top of
// „Okazje”, with a notification. Deals on a low-confidence valuation are not announced: they are
// as often a wrong assignment as a bargain.
import { listDeals } from './deals.mjs';

const HOUR = 3_600_000;
/** Only offers first seen this recently are news. */
export const ALERT_MAX_AGE_HOURS = 48;

/**
 * Records the deals not announced yet; returns them.
 * @param {{ database: import('node:sqlite').DatabaseSync }} repository
 */
export function recordDealAlerts(repository, { at = Date.now() } = {}) {
  const database = repository.database;
  const known = new Set(
    database
      .prepare('SELECT offer_id FROM deal_alerts')
      .all()
      .map((row) => String(row.offer_id)),
  );
  const fresh = listDeals(repository, { at }).items.filter(
    (item) =>
      !known.has(item.offerId) &&
      item.confidence !== 'low' &&
      !item.verdict &&
      at - Date.parse(String(item.firstSeenAt || '')) <= ALERT_MAX_AGE_HOURS * HOUR,
  );
  if (!fresh.length) return [];
  const insert = database.prepare(
    `INSERT OR IGNORE INTO deal_alerts(offer_id, price, worth, saving, chance, alerted_at)
     VALUES (?,?,?,?,?,?)`,
  );
  const when = new Date(at).toISOString();
  for (const item of fresh)
    insert.run(item.offerId, item.price, item.worth, item.saving, item.liquidity.chance, when);
  return fresh;
}

/**
 * Announced deals, newest first, with the offer as it is now.
 * @param {{ database: import('node:sqlite').DatabaseSync }} repository
 */
export function listDealAlerts(repository, { limit = 20 } = {}) {
  const database = repository.database;
  const rows = database
    .prepare(
      `SELECT a.offer_id AS offerId, a.price, a.worth, a.saving, a.chance, a.alerted_at AS alertedAt,
         a.seen_at AS seenAt, o.original_title AS title, o.source, o.normalized_url AS url,
         o.current_price AS currentPrice, o.availability
       FROM deal_alerts a JOIN offers o ON o.id=a.offer_id
       ORDER BY a.alerted_at DESC, a.saving DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.min(100, Number(limit) || 20)));
  return {
    unseen: unseenDealAlerts(repository),
    items: rows.map((row) => ({
      offerId: String(row.offerId),
      title: String(row.title),
      source: String(row.source),
      url: String(row.url),
      price: Number(row.price),
      worth: Number(row.worth),
      saving: Number(row.saving),
      chance: row.chance == null ? null : Number(row.chance),
      alertedAt: String(row.alertedAt),
      seen: row.seenAt != null,
      // Gone or repriced since the alert: the owner should know before clicking through.
      gone: ['sold', 'unavailable', 'reserved'].includes(String(row.availability)),
      currentPrice: row.currentPrice == null ? null : Number(row.currentPrice),
    })),
  };
}

/** @param {{ database: import('node:sqlite').DatabaseSync }} repository */
export function unseenDealAlerts(repository) {
  return Number(
    repository.database.prepare('SELECT count(*) AS n FROM deal_alerts WHERE seen_at IS NULL').get()
      ?.n ?? 0,
  );
}

/** @param {{ database: import('node:sqlite').DatabaseSync }} repository */
export function markDealAlertsSeen(repository, { at = Date.now() } = {}) {
  repository.database
    .prepare('UPDATE deal_alerts SET seen_at=? WHERE seen_at IS NULL')
    .run(new Date(at).toISOString());
  return listDealAlerts(repository);
}
