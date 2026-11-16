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
 * One-time repair: until 16.11.2026 the promotional price shown to a signed-out visitor (0 zł) was
 * saved as the delivery price, so nearly every Vinted offer looked like free delivery and foreign
 * editions were let in. Each such offer gets the regular price kept in its page snapshot, or goes
 * back to the backfill queue. Foreign-language offers lose their automatic assignment and are
 * identified again (they end in „Gry / obce” or are rejected by "Tylko polskie wydania"); manual
 * assignments, sets and offers with a decision stay.
 * @param {{ database: import('node:sqlite').DatabaseSync, transaction: (job: () => void) => void }} repository
 * @param {{ now?: () => Date }} [options]
 */
export function repairPromotionalShippingCosts(repository, { now = () => new Date() } = {}) {
  const db = repository.database;
  const at = now().toISOString();
  const report = { corrected: 0, requeued: 0, foreign: 0 };
  const offers = /** @type {{ id: string, language: string | null, regular: number | null }[]} */ (
    db
      .prepare(
        `SELECT o.id, o.language,
           (SELECT json_extract(s.payload,'$.shipping.original') FROM offer_raw_snapshots s
             WHERE s.offer_id=o.id AND s.kind='detail' AND json_valid(s.payload)
             ORDER BY s.observed_at DESC, s.id DESC LIMIT 1) AS regular
         FROM offers o WHERE o.source='Vinted' AND o.shipping_cost=0`,
      )
      .all()
  );
  const setCost = db.prepare('UPDATE offers SET shipping_cost=? WHERE id=?');
  const forget = db.prepare(
    'UPDATE offers SET shipping_cost=NULL, shipping_checked_at=NULL WHERE id=?',
  );
  const untouchable = db.prepare(
    `SELECT 1 WHERE EXISTS (SELECT 1 FROM offer_matches WHERE offer_id=?1 AND status='active' AND method NOT IN ('structured_isbn','metadata'))
        OR EXISTS (SELECT 1 FROM offer_sets WHERE offer_id=?1)
        OR EXISTS (SELECT 1 FROM review_decisions WHERE offer_id=?1)`,
  );
  const supersede = db.prepare(
    "UPDATE offer_matches SET status='superseded', valid_to=? WHERE offer_id=? AND status='active'",
  );
  const requeue = db.prepare(
    `UPDATE identification_jobs SET status='queued', run_after=NULL, lease_token=NULL, lease_expires_at=NULL,
       last_error=NULL, result_json=NULL, attempt_count=0, updated_at=? WHERE offer_id=? AND status<>'running'`,
  );
  repository.transaction(() => {
    for (const offer of offers) {
      const regular = Number(offer.regular);
      if (Number.isSafeInteger(regular) && regular > 0) {
        setCost.run(regular, offer.id);
        report.corrected += 1;
      } else {
        forget.run(offer.id);
        report.requeued += 1;
      }
      const language = String(offer.language ?? '').trim();
      if (!language || /^(?:pl|pol|polish|polski|język polski)$/i.test(language)) continue;
      if (untouchable.get(offer.id)) continue;
      supersede.run(at, offer.id);
      requeue.run(at, offer.id);
      report.foreign += 1;
    }
  });
  return report;
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
