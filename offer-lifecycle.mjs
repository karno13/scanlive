// Checks offers that recent scans no longer return. Vinted item pages say "Sprzedane" (sold) or
// "Zarezerwowane"; a page that is gone (404/410) means the listing was removed. The last observed
// price is kept: together with the date it is the best evidence of what a book sold for.
import { readSourceHtml } from './marketplaces.mjs';
import { CHECK_TIERS, detectRelists, recordOfferStatus } from './offer-status.mjs';

export const LIFECYCLE_SOURCES = new Set([
  'Vinted',
  'Allegro Lokalnie',
  'Tezeusz.pl',
  'Dedalus.pl',
  'Empik',
]);

/** 'sold' | 'reserved' | 'hidden' | 'available' | null (cannot tell) from a Vinted item page. */
export function parseVintedStatus(html, itemId) {
  const text = String(html ?? '').replace(/\\"/g, '"');
  const id = String(itemId ?? '').replace(/D/g, '');
  if (!id) return null;
  // Sidebar plugins: {"data":{...},"exposures":[],"name":"buyer_item_status"} — read the data object
  // that precedes the plugin name, and only when it belongs to this item.
  const plugin = (name) => {
    for (
      let index = text.indexOf('"name":"' + name + '"');
      index > 0;
      index = text.indexOf('"name":"' + name + '"', index + 1)
    ) {
      const before = text.slice(Math.max(0, index - 600), index);
      const start = before.lastIndexOf('{"data":');
      const data = start >= 0 ? before.slice(start) : '';
      if (data.includes('"item_id":"' + id + '"')) return data;
    }
    return null;
  };
  const status = plugin('buyer_item_status');
  if (status) {
    const title = status.match(/"title":"([^"]{1,60})"/)?.[1] ?? '';
    if (/sprzedan|sold/i.test(title)) return 'sold';
    if (/zarezerw|reserved/i.test(title)) return 'reserved';
    return 'hidden';
  }
  const seller = plugin('ask_seller');
  if (!seller) return null;
  if (/"is_reserved":true/.test(seller)) return 'reserved';
  if (/"is_hidden":true/.test(seller)) return 'hidden';
  return /"can_buy":true/.test(seller) ? 'available' : null;
}

const vintedId = (url) => String(url).match(/\/items\/(\d+)/)?.[1] ?? null;

export function pendingLifecycleChecks(
  repository,
  { limit = 8, now = () => new Date(), sources = [...LIFECYCLE_SOURCES] } = {},
) {
  const at = now().getTime();
  const marks = sources.map(() => '?').join(',');
  // Price tiers (CHECK_TIERS): expensive listings are checked sooner after they leave the scans and
  // again more often; within the due ones the most expensive go first, never-checked before rechecks.
  const tier = () =>
    'CASE ' +
    CHECK_TIERS.slice(0, -1)
      .map((t) => `WHEN coalesce(current_price,0)>=${t.minPrice} THEN ?`)
      .join(' ') +
    ' ELSE ? END';
  const cutoffs = (field) => CHECK_TIERS.map((t) => new Date(at - t[field]).toISOString());
  return repository.database
    .prepare(
      `SELECT id, source, normalized_url AS url, availability, current_price AS price FROM offers
       WHERE source IN (${marks}) AND availability IN ('unconfirmed','not_seen','available','reserved','hidden')
         AND last_seen_at < ${tier()} AND (availability_checked_at IS NULL OR availability_checked_at < ${tier()})
       ORDER BY coalesce(current_price,0) DESC, availability_checked_at IS NOT NULL, availability_checked_at, last_seen_at LIMIT ?`,
    )
    .all(
      ...sources,
      ...cutoffs('notSeenMs'),
      ...cutoffs('recheckMs'),
      Math.max(1, Math.min(100, limit)),
    );
}

function save(repository, offer, availability, at) {
  const changed = availability && availability !== offer.availability;
  // Every check is kept, also "still on sale": it narrows the moment of a later sale.
  recordOfferStatus(repository.database, offer.id, availability || 'unknown', at, 'check');
  repository.database
    .prepare(
      `UPDATE offers SET availability=coalesce(?,availability), availability_checked_at=?,
         availability_changed_at=CASE WHEN ? THEN ? ELSE availability_changed_at END WHERE id=?`,
    )
    .run(availability, at, changed ? 1 : 0, at, offer.id);
  return changed;
}

export async function checkOfferLifecycle(
  repository,
  {
    fetchHtml = (url, source) => readSourceHtml(url, { source }),
    limit = 8,
    now = () => new Date(),
    signal = null,
  } = {},
) {
  const report = {
    checked: 0,
    sold: 0,
    reserved: 0,
    removed: 0,
    available: 0,
    unknown: 0,
    errors: 0,
    stopped: null,
  };
  const blocked = new Set();
  for (const offer of pendingLifecycleChecks(repository, { limit, now })) {
    if (signal?.aborted) break;
    if (blocked.has(offer.source)) continue;
    const at = now().toISOString();
    let html;
    try {
      html = await fetchHtml(offer.url, offer.source);
    } catch (error) {
      if (error?.status === 404 || error?.status === 410) {
        report.checked += 1;
        report.removed += 1;
        save(repository, offer, 'unavailable', at);
        continue;
      }
      report.errors += 1;
      // A challenge or rate limit applies to the whole source: leave it alone this round.
      if (error?.blocked || error?.status === 429 || error?.status === 403) {
        blocked.add(offer.source);
        report.stopped = String(error.message);
      }
      continue;
    }
    report.checked += 1;
    const status = offer.source === 'Vinted' ? parseVintedStatus(html, vintedId(offer.url)) : null;
    if (status === 'sold') report.sold += 1;
    else if (status === 'reserved') report.reserved += 1;
    else if (status === 'hidden') report.removed += 1;
    else if (status === 'available') report.available += 1;
    else report.unknown += 1;
    save(repository, offer, status === 'hidden' ? 'unavailable' : status, at);
  }
  // A listing found gone may have been put up again by its seller.
  if (report.removed) report.relisted = detectRelists(repository, { now }).linked;
  return report;
}

/** Sold / gone offers of an edition: the market evidence of what a copy sold for. */
export function lifecycleSummary(offers = []) {
  const sold = offers.filter((offer) => offer.availability === 'sold' && offer.currentPrice > 0);
  const prices = sold.map((offer) => offer.currentPrice).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor((prices.length - 1) / 2)] : null;
  return { sold: sold.length, medianSoldPrice: median };
}
