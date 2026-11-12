// Checks offers that recent scans no longer return. Vinted item pages say "Sprzedane" (sold) or
// "Zarezerwowane"; a page that is gone (404/410) means the listing was removed. The last observed
// price is kept: together with the date it is the best evidence of what a book sold for.
import { readSourceHtml } from './marketplaces.mjs';
import { CHECK_TIERS, detectRelists, recordOfferStatus } from './offer-status.mjs';

// Only sources with a status parser consume the periodic check budget. Allegro and OLX are not
// here (no legal access, source-blocks.mjs), nor is Dedalus (CAPTCHA): its listing already carries
// the shop's own availability code (confirmFromListingCodes).
// All marketplace scan adapters remain enabled and unchanged.
export const LIFECYCLE_SOURCES = new Set(['Vinted', 'Tezeusz.pl', 'Empik', 'Allegro Lokalnie']);

const AVAILABLE = /^(?:InStock|LimitedAvailability|OnlineOnly|PreOrder|PreSale|InStoreOnly)$/i;
const SOLD = /^SoldOut$/i;
const UNAVAILABLE = /^(?:OutOfStock|Discontinued)$/i;
const mapSchema = (value) =>
  AVAILABLE.test(value)
    ? 'available'
    : SOLD.test(value)
      ? 'sold'
      : UNAVAILABLE.test(value)
        ? 'unavailable'
        : null;

/**
 * 'available' | 'sold' | 'unavailable' | null from the product page of a shop: Empik's
 * `product:availability` meta, Allegro Lokalnie's schema.org microdata link, or the JSON-LD
 * `availability` of the product (Tezeusz, Dedalus). null when the page says nothing of the kind.
 */
export function parseStoreAvailability(html) {
  const text = String(html ?? '');
  const meta = text.match(/property="product:availability"\s+content="(true|false)"/i)?.[1];
  if (meta) return meta === 'true' ? 'available' : 'unavailable';
  const micro = text.match(/itemprop="availability"[^>]*?href="[^"]*\/(\w+)"/i)?.[1];
  if (micro) return mapSchema(micro);
  const ld = text.match(/"availability"\s*:\s*"[^"]*\/(\w+)"/i)?.[1];
  return ld ? mapSchema(ld) : null;
}

const LISTING_AVAILABLE =
  /^(?:IN_\d+_(?:H|DAYS)|IN_\d+(?:_\d+)?_DAYS|PRE_SALE|InStock|LimitedAvailability)$/;

/**
 * Offers whose shop listing carried an "available" code (Empik "IN_24_H", Dedalus "InStock") in
 * the latest sighting: availability 'available' as of that sighting, without a page request.
 * Offers that later leave the scans are checked like any other.
 */
export function confirmFromListingCodes(
  repository,
  { now = () => new Date(), maxAgeMs = 3 * 86_400_000 } = {},
) {
  const cutoff = new Date(now().getTime() - maxAgeMs).toISOString();
  const rows = repository.database
    .prepare(
      `SELECT id, source, normalized_url AS url, availability, current_price AS price, source_availability AS code, last_seen_at AS seenAt
       FROM offers WHERE availability='unconfirmed' AND source_availability IS NOT NULL AND last_seen_at>=?`,
    )
    .all(cutoff)
    .filter((row) => LISTING_AVAILABLE.test(row.code));
  for (const row of rows) save(repository, row, 'available', row.seenAt);
  return { confirmed: rows.length };
}

/**
 * Offers still in the scans, never checked on their own page: the most expensive first. Their
 * availability is "unconfirmed" until a page says more (it does not follow from being listed).
 */
export function pendingConfirmations(
  repository,
  { limit = 8, sources = [...LIFECYCLE_SOURCES] } = {},
) {
  const marks = sources.map(() => '?').join(',');
  return repository.database
    .prepare(
      `SELECT id, source, normalized_url AS url, availability, current_price AS price FROM offers
       WHERE source IN (${marks}) AND availability='unconfirmed' AND availability_checked_at IS NULL
       ORDER BY coalesce(current_price,0) DESC, last_seen_at DESC LIMIT ?`,
    )
    .all(...sources, Math.max(1, Math.min(100, limit)));
}

/** 'sold' | 'reserved' | 'hidden' | 'available' | null (cannot tell) from a Vinted item page. */
export function parseVintedStatus(html, itemId) {
  const text = String(html ?? '').replace(/\\"/g, '"');
  const id = String(itemId ?? '');
  if (!/^\d+$/.test(id)) return null;
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
    return /ukryt|hidden/i.test(title) ? 'hidden' : null;
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
  // Price tiers (CHECK_TIERS) only decide whether an offer is due yet (expensive listings sooner and
  // more often). Among the due ones the order is fair: never checked first, then the longest
  // unchecked; price merely breaks ties. Otherwise a small daily budget would never reach cheap books.
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
       ORDER BY availability_checked_at IS NOT NULL, availability_checked_at, coalesce(current_price,0) DESC, last_seen_at LIMIT ?`,
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
    // Sources left alone this round (they refused recently); the caller keeps the pause.
    skipSources = [],
  } = {},
) {
  const report = {
    blockedSources: [],
    checked: 0,
    sold: 0,
    reserved: 0,
    removed: 0,
    available: 0,
    unknown: 0,
    errors: 0,
    stopped: null,
    unresolved: { unrecognizedPage: 0, blocked: 0, redirect: 0, transport: 0 },
  };
  // The shop's own availability code on the listing (Empik, Dedalus) confirms without a request.
  report.listingConfirmed = confirmFromListingCodes(repository, { now }).confirmed;
  const blocked = new Set();
  const sources = [...LIFECYCLE_SOURCES].filter((source) => !skipSources.includes(source));
  const gone = sources.length ? pendingLifecycleChecks(repository, { limit, now, sources }) : [];
  // Left over budget goes to offers that are still listed but were never checked on their page.
  const goneIds = new Set(gone.map((offer) => offer.id));
  const due = [
    ...gone,
    // The same offer can be in both lists (left the scans and never checked): once is enough.
    ...(gone.length < limit && sources.length
      ? pendingConfirmations(repository, { limit: limit + gone.length, sources })
          .filter((offer) => !goneIds.has(offer.id))
          .slice(0, limit - gone.length)
      : []),
  ];
  for (const offer of due) {
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
      if (error?.blocked || [403, 429].includes(error?.status)) report.unresolved.blocked++;
      else if (/REDIRECT/.test(String(error?.message))) report.unresolved.redirect++;
      else report.unresolved.transport++;
      // A challenge or rate limit applies to the whole source: leave it alone this round.
      if (error?.blocked || error?.status === 429 || error?.status === 403) {
        blocked.add(offer.source);
        report.blockedSources.push(offer.source);
        report.stopped = String(error.message);
      }
      continue;
    }
    report.checked += 1;
    const status =
      offer.source === 'Vinted'
        ? parseVintedStatus(html, vintedId(offer.url))
        : parseStoreAvailability(html);
    if (status === 'sold') report.sold += 1;
    else if (status === 'reserved') report.reserved += 1;
    else if (status === 'hidden' || status === 'unavailable') report.removed += 1;
    else if (status === 'available') report.available += 1;
    else {
      report.unknown += 1;
      report.unresolved.unrecognizedPage++;
    }
    save(repository, offer, status === 'hidden' ? 'unavailable' : status, at);
  }
  // A listing found gone may have been put up again by its seller.
  if (report.removed) report.relisted = detectRelists(repository, { now }).linked;
  // Offers of this queue still due (sources that just refused are left out: they stay paused).
  // The caller may start the next round sooner to catch up; the per-round limit is unchanged.
  const open = sources.filter((source) => !blocked.has(source));
  report.backlog = open.length
    ? pendingLifecycleChecks(repository, { limit: 1, now, sources: open }).length > 0
    : false;
  return report;
}

/** Sold / gone offers of an edition: the market evidence of what a copy sold for. */
export function lifecycleSummary(offers = []) {
  const sold = offers.filter((offer) => offer.availability === 'sold' && offer.currentPrice > 0);
  const prices = sold.map((offer) => offer.currentPrice).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor((prices.length - 1) / 2)] : null;
  return { sold: sold.length, medianSoldPrice: median };
}
