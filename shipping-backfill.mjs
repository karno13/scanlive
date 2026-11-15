// @ts-check
// Vinted offers saved before the delivery price was read: their listing page is read again, a few
// per round through the marketplace gate, and the price block fills `offers.shipping_cost`.
// Only listings still for sale; each page is tried once (shipping_checked_at), a gone page is left.
import { readSourceHtml } from './marketplaces.mjs';
import { parseVintedDetail } from './vinted-detail.mjs';

/**
 * @param {{ database: import('node:sqlite').DatabaseSync }} repository
 * @param {{ limit?: number }} [options]
 */
export function pendingShippingChecks(repository, { limit = 6 } = {}) {
  return /** @type {{ id: string, url: string }[]} */ (
    repository.database
      .prepare(
        `SELECT id, normalized_url AS url FROM offers
         WHERE source='Vinted' AND shipping_cost IS NULL AND shipping_checked_at IS NULL
           AND availability IN ('unconfirmed','available','reserved')
         ORDER BY coalesce(current_price,0) DESC, last_seen_at DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(50, limit)))
  );
}

/** Saves a delivery price read from a listing page (also used by the availability check). */
export function saveShippingCost(repository, offerId, cost, at) {
  repository.database
    .prepare(
      `UPDATE offers SET shipping_checked_at=?, shipping_cost=coalesce(?, shipping_cost) WHERE id=?`,
    )
    .run(at, Number.isSafeInteger(cost) && cost >= 0 ? cost : null, offerId);
}

/**
 * @param {{ database: import('node:sqlite').DatabaseSync }} repository
 * @param {{ limit?: number, fetchHtml?: (url: string) => Promise<string>, now?: () => Date }} [options]
 */
export async function fillShippingCosts(
  repository,
  {
    limit = 6,
    fetchHtml = (url) => readSourceHtml(url, /** @type {any} */ ({ source: 'Vinted' })),
    now = () => new Date(),
  } = {},
) {
  const report = { checked: 0, found: 0, free: 0, missing: 0, removed: 0, paused: false };
  for (const offer of pendingShippingChecks(repository, { limit })) {
    const at = now().toISOString();
    let html;
    try {
      html = await fetchHtml(offer.url);
    } catch (error) {
      const e = /** @type {{ status?: number, blocked?: boolean }} */ (error);
      if (e?.status === 404 || e?.status === 410) {
        report.removed += 1;
        saveShippingCost(repository, offer.id, null, at);
        continue;
      }
      // A challenge or rate limit applies to the whole source: stop and let the caller pause.
      if (e?.blocked || e?.status === 403 || e?.status === 429) {
        report.paused = true;
        break;
      }
      continue;
    }
    report.checked += 1;
    const detail = /** @type {{ shippingCost?: number }} */ (parseVintedDetail(html, offer.url));
    const cost = detail.shippingCost;
    if (cost == null) report.missing += 1;
    else {
      report.found += 1;
      if (cost === 0) report.free += 1;
    }
    saveShippingCost(repository, offer.id, cost ?? null, at);
  }
  return report;
}
