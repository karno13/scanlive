// @ts-check
// The sale signal. Each observed state of an offer is kept with its moment (offer_status_history),
// so a sale has an interval: after the last time the listing was seen on sale, before the check
// that found it sold. A listing the seller took down and put up again (Vinted gives it a new
// number) is linked to its earlier copy, so the earlier one is not mistaken for a sold book.

const STATUSES = new Set([
  'seen',
  'not_seen',
  'available',
  'reserved',
  'sold',
  'unavailable',
  'unknown',
]);

export function recordOfferStatus(database, offerId, status, observedAt, via = 'scan') {
  if (!STATUSES.has(status) || !observedAt) return false;
  return (
    Number(
      database
        .prepare(
          'INSERT OR IGNORE INTO offer_status_history(offer_id,status,via,observed_at) VALUES(?,?,?,?)',
        )
        .run(offerId, status, via, String(observedAt)).changes,
    ) === 1
  );
}

export function offerStatusHistory(database, offerId) {
  return database
    .prepare(
      'SELECT status, via, observed_at AS observedAt FROM offer_status_history WHERE offer_id=? ORDER BY observed_at, id',
    )
    .all(offerId)
    .map((row) => ({ ...row }));
}

/**
 * When a sold offer was sold: not before the later of its last sighting in a scan and the last
 * check that found it on sale; not after the first check that found it sold. Null if not sold.
 */
export function saleWindow(database, offerId) {
  const row = database
    .prepare(
      `SELECT o.last_seen_at AS lastSeen,
         (SELECT min(observed_at) FROM offer_status_history h WHERE h.offer_id=o.id AND h.status='sold') AS soldSeen
       FROM offers o WHERE o.id=? AND o.availability='sold'`,
    )
    .get(offerId);
  if (!row?.soldSeen) return null;
  const available = database
    .prepare(
      "SELECT max(observed_at) AS at FROM offer_status_history WHERE offer_id=? AND status IN ('available','seen') AND observed_at<?",
    )
    .get(offerId, row.soldSeen)?.at;
  const from = [row.lastSeen, available].filter(Boolean).sort().at(-1) || null;
  return { from: from && from < row.soldSeen ? from : null, to: row.soldSeen };
}

const titleKey = (title) =>
  String(title ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const isbnKey = (value) =>
  String(value ?? '')
    .replace(/[^0-9X]/gi, '')
    .toUpperCase();

/**
 * Links new listings to the same seller's earlier listing of the same title or ISBN that
 * disappeared before the new one appeared. Pairs the operator separated are never linked again.
 */
export function detectRelists(repository, { now = () => new Date() } = {}) {
  const db = repository.database;
  const pairs = db
    .prepare(
      `SELECT n.id AS offerId, n.original_title AS title, n.observed_isbn AS isbn,
         p.id AS previousId, p.original_title AS previousTitle, p.observed_isbn AS previousIsbn, p.last_seen_at AS previousSeen
       FROM offers n JOIN offers p ON p.source=n.source AND p.seller_id=n.seller_id AND p.id<>n.id
       WHERE n.seller_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM offer_relists r WHERE r.offer_id=n.id)
         AND p.availability IN ('not_seen','unavailable')
         AND p.last_seen_at < n.first_seen_at
         AND NOT EXISTS (SELECT 1 FROM offer_relists r WHERE r.previous_offer_id=p.id AND r.status='active')
       ORDER BY n.id, p.last_seen_at DESC`,
    )
    .all();
  const chosen = new Map();
  const usedPrevious = new Set();
  for (const pair of pairs) {
    if (chosen.has(pair.offerId) || usedPrevious.has(pair.previousId)) continue;
    const isbn = isbnKey(pair.isbn);
    const reason =
      isbn.length >= 10 && isbn === isbnKey(pair.previousIsbn)
        ? 'same_seller_isbn'
        : titleKey(pair.title).length >= 3 && titleKey(pair.title) === titleKey(pair.previousTitle)
          ? 'same_seller_title'
          : null;
    if (!reason) continue;
    chosen.set(pair.offerId, { previousId: pair.previousId, reason });
    usedPrevious.add(pair.previousId);
  }
  const at = now().toISOString();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO offer_relists(offer_id,previous_offer_id,reason,status,created_by,created_at,updated_at)
     VALUES(?,?,?,'active','relist_detection',?,?)`,
  );
  let linked = 0;
  repository.transaction(() => {
    for (const [offerId, { previousId, reason }] of chosen)
      linked += Number(insert.run(offerId, previousId, reason, at, at).changes);
  });
  return { linked };
}

/** The operator says these are two different listings: the link stays in history as undone. */
export function undoRelist(repository, offerId, { now = () => new Date() } = {}) {
  const result = repository.database
    .prepare(
      "UPDATE offer_relists SET status='undone', updated_at=? WHERE offer_id=? AND status='active'",
    )
    .run(now().toISOString(), String(offerId));
  if (!Number(result.changes)) throw Object.assign(Error('RELIST_NOT_FOUND'), { statusCode: 404 });
  return { offerId: String(offerId), status: 'undone' };
}

/** Earlier and later copies of a listing, for the offer drawer. */
export function relistLinks(database, offerId) {
  const read = (sql) =>
    database
      .prepare(sql)
      .all(offerId)
      .map((row) => ({ ...row }));
  return {
    previous: read(
      `SELECT r.previous_offer_id AS offerId, r.reason, r.status, r.created_at AS createdAt, o.original_title AS title,
         o.current_price AS price, o.first_seen_at AS firstSeenAt, o.last_seen_at AS lastSeenAt, o.normalized_url AS url
       FROM offer_relists r JOIN offers o ON o.id=r.previous_offer_id WHERE r.offer_id=?`,
    ),
    next: read(
      `SELECT r.offer_id AS offerId, r.reason, r.status, r.created_at AS createdAt, o.original_title AS title,
         o.current_price AS price, o.first_seen_at AS firstSeenAt, o.normalized_url AS url
       FROM offer_relists r JOIN offers o ON o.id=r.offer_id WHERE r.previous_offer_id=?`,
    ),
  };
}

/** Automatic relist links for "Ostatnie decyzje". */
export function recentRelistDecisions(database, limit = 30) {
  return database
    .prepare(
      `SELECT 'relist:' || r.offer_id AS id, CASE WHEN r.status='active' THEN 'relist_linked' ELSE 'relist_undone' END AS action,
         r.reason, r.created_at AS createdAt, r.offer_id AS offerId, o.original_title AS title, NULL AS editionId,
         CASE WHEN r.status='undone' THEN r.updated_at END AS revisionId, r.created_by AS createdBy
       FROM offer_relists r JOIN offers o ON o.id=r.offer_id ORDER BY r.created_at DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({ ...row }));
}

const HOUR = 3_600_000;
/**
 * When to check a listing that scans stopped returning, by price: an expensive book is the
 * evidence that matters, and it sells sooner. Prices in grosze.
 */
export const CHECK_TIERS = [
  { minPrice: 10_000, notSeenMs: 12 * HOUR, recheckMs: 24 * HOUR },
  { minPrice: 4_000, notSeenMs: 24 * HOUR, recheckMs: 48 * HOUR },
  { minPrice: 0, notSeenMs: 48 * HOUR, recheckMs: 96 * HOUR },
];
