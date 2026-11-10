import { randomUUID } from 'node:crypto';
import { isbnKeys } from './isbn-normalization.mjs';
import { markUnseenOffers } from './offer-availability.mjs';
import { normalizedIsbn } from './offer-history.mjs';
import { sourceOfferId, offerExternalId } from './offer-identity.mjs';
import { sqliteHistoryModel } from './sqlite-history-read.mjs';
import { detectRelists } from './offer-status.mjs';

export function storageMode(env = process.env) {
  const mode = String(env.BOOKFLIP_STORAGE || 'sqlite').toLowerCase();
  if (mode !== 'sqlite') throw Error('SQLITE_ONLY_STORAGE_MODE');
  return mode;
}

function bad(code, statusCode = 400) {
  throw Object.assign(Error(code), { statusCode });
}
function bookFromProjection(catalog, bookId) {
  const row = catalog.repository.database
    .prepare(
      `SELECT e.id, e.title, e.created_at, e.updated_at, w.verification_status,
         (SELECT normalized_value FROM edition_identifiers i WHERE i.edition_id=e.id AND i.scheme IN ('isbn13','isbn10')
          ORDER BY CASE i.scheme WHEN 'isbn13' THEN 0 ELSE 1 END, i.id LIMIT 1) AS isbn
       FROM editions e JOIN works w ON w.id=e.work_id WHERE COALESCE(e.legacy_id,w.legacy_id,'edition:' || e.id)=? ORDER BY e.created_at LIMIT 1`,
    )
    .get(bookId);
  return row
    ? { id: bookId, title: row.title, isbn: row.isbn ?? null, origin: row.verification_status === 'manual' ? 'manual' : 'detected', firstSeenAt: row.created_at, lastSeenAt: row.updated_at }
    : null;
}
export function createSqliteBook(catalog, { title, isbn = null } = {}) {
  const clean = String(title || '').trim(),
    rawIsbn = String(isbn || '').trim(),
    cleanIsbn = normalizedIsbn(rawIsbn);
  if (!clean || clean.length > 500) bad('INVALID_BOOK_TITLE');
  if (rawIsbn && !cleanIsbn) bad('INVALID_BOOK_ISBN');
  const repo = catalog.repository,
    at = new Date().toISOString();
  let bookId, editionId,
    created = false;
  repo.transaction(() => {
    if (cleanIsbn) {
      const existing = repo.database
        .prepare(
          "SELECT e.legacy_id,e.id FROM edition_identifiers i JOIN editions e ON e.id=i.edition_id WHERE i.scheme IN ('isbn10','isbn13') AND i.normalized_value IN (SELECT value FROM json_each(?)) LIMIT 1",
        )
        .get(JSON.stringify(isbnKeys(cleanIsbn).length ? isbnKeys(cleanIsbn) : [cleanIsbn]));
      if (existing) {
        editionId = existing.id;
        bookId = existing.legacy_id || 'edition:' + existing.id;
        return;
      }
    }
    bookId = 'book:' + randomUUID();
    const work = repo.createWork({
      legacyId: bookId,
      title: clean,
      verificationStatus: 'manual',
      at,
    });
    const edition = repo.createEdition({
      legacyId: bookId,
      workId: work.id,
      title: clean,
      verificationStatus: 'manual',
      at,
    });
    editionId = edition.id;
    // Both ISBN forms, so offers listed with the other form find this edition too.
    if (cleanIsbn)
      for (const key of isbnKeys(cleanIsbn).length ? isbnKeys(cleanIsbn) : [cleanIsbn])
        repo.attachIdentifier(edition.id, key.length === 10 ? 'isbn10' : 'isbn13', key, {
          source: 'local_manual',
          verificationStatus: 'manual',
          at,
        });
    created = true;
  });
  return { book: bookFromProjection(catalog, bookId), editionId, created };
}

export function linkSqliteOffer(catalog, { offerId, bookId } = {}, { returnHistory = true } = {}) {
  const repo = catalog.repository,
    db = repo.database;
  const offer = db
    .prepare('SELECT id FROM offers WHERE id=? OR legacy_id=? LIMIT 1')
    .get(String(offerId || ''), String(offerId || ''));
  if (!offer) bad('OFFER_NOT_FOUND', 404);
  const key = String(bookId || ''),
    edition = key.startsWith('edition:')
      ? db.prepare('SELECT id FROM editions WHERE id=?').get(key.slice(8))
      : db.prepare('SELECT id FROM editions WHERE legacy_id=?').get(key);
  if (!edition) bad('BOOK_NOT_FOUND', 404);
  repo.transaction(() => {
    const current = db
      .prepare(
        "SELECT edition_id,method FROM offer_matches WHERE offer_id=? AND status='active' LIMIT 1",
      )
      .get(offer.id);
    if (current?.edition_id === edition.id && ['manual', 'legacy_manual'].includes(current.method))
      return;
    repo.assignOfferToEdition(offer.id, edition.id, {
      method: 'manual',
      status: 'active',
      createdBy: 'local_user',
    });
  });
  return returnHistory ? sqliteHistoryModel(repo) : { offerId: offer.id, bookId };
}

/**
 * State of one running scan: what each offer looked like before the scan (for "new" and "price
 * changed") and every phrase that found it. Shared by the per-task saves and the final save, so an
 * offer saved during the scan is not counted twice and keeps all its phrases.
 */
export function createScanState() {
  return { baseline: new Map(), queries: new Map() };
}

function prepareScanOffers(db, offers, state) {
  if (!state) return offers;
  const read = db.prepare('SELECT current_price, seen_count FROM offers WHERE id=?');
  return offers.map((offer) => {
    let id;
    try {
      id = sourceOfferId(offer.source, offer.url, offerExternalId(offer));
    } catch {
      return offer;
    }
    if (!state.baseline.has(id)) {
      const row = read.get(id);
      state.baseline.set(id, row ? { current_price: row.current_price, seen_count: Number(row.seen_count || 0) } : null);
    }
    if (!state.queries.has(id)) state.queries.set(id, new Set());
    for (const query of offer.matchedQueries ?? []) state.queries.get(id).add(query);
    return { ...offer, matchedQueries: [...state.queries.get(id)], seenCount: (state.baseline.get(id)?.seen_count ?? 0) + 1 };
  });
}

/** Saves the offers of one finished source+query while the scan continues. */
export function persistSqliteScanBatch(catalog, { offers, scanAt, state }) {
  const db = catalog.repository.database;
  const valid = offers.filter((offer) => offer?.source && offer?.url && Number.isSafeInteger(offer.price) && offer.price > 0);
  const prepared = prepareScanOffers(db, valid, state);
  const report = catalog.ingestOffers(prepared, String(scanAt));
  let newOffers = 0;
  for (const offer of prepared) {
    try {
      if (state?.baseline.get(sourceOfferId(offer.source, offer.url, offerExternalId(offer))) === null) newOffers++;
    } catch {}
  }
  return { saved: report.offers, newOffers };
}

export function persistSqliteScan(catalog, { offers, searchedAt, errors = [], scanContext = null, scanState = null, rejected = null }) {
  const at = String(searchedAt);
  const db = catalog.repository.database;
  // During the scan offers are already saved: compare with the state from before the scan.
  const previous = scanState
    ? { get: (id) => (scanState.baseline.has(id) ? scanState.baseline.get(id) : db.prepare('SELECT current_price FROM offers WHERE id=?').get(id)) }
    : db.prepare('SELECT current_price FROM offers WHERE id=?');
  const scanOffers = prepareScanOffers(db, offers.filter(
    offer => offer?.source && offer?.url && Number.isSafeInteger(offer.price) && offer.price > 0,
  ), scanState);
  const ids = [];
  let newOffers = 0, priceChanges = 0;
  const seen = new Set();
  const outcomes = [];
  for (const offer of scanOffers) {
    try {
      const id = sourceOfferId(offer.source, offer.url, offerExternalId(offer));
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      const old = previous.get(id);
      outcomes.push({ id, isNew: !old, changed: Boolean(old && old.current_price !== offer.price) });
      if (!old) newOffers++;
      else if (old.current_price !== offer.price) priceChanges++;
    } catch {}
  }
  // rejected: listings left out before saving, by reason ({language, language_unknown, topic, product}).
  const lastScan = { at, found: offers.length, newOffers, priceChanges, errors,
    ...(rejected && Object.keys(rejected).length ? { rejected } : {}),
    ...(scanContext ? {context:scanContext} : {}) };
  const ingest = catalog.repository.transaction(() => {
    const report = catalog.ingestOffers(scanOffers, at, { scanSummary: lastScan });
    const membership = db.prepare('INSERT OR REPLACE INTO scan_offer_results VALUES(?,?,?,?)');
    for (const row of outcomes) if (db.prepare('SELECT id FROM offers WHERE id=?').get(row.id))
      membership.run(at,row.id,Number(row.isNew),Number(row.changed));
    // Offers absent from a complete scan of their phrase are most likely sold or withdrawn.
    if (scanContext) markUnseenOffers(db, scanContext.results || [], at);
    // A listing that left the results while the same seller's copy appeared is a relist, not a sale.
    if (scanContext) detectRelists(catalog.repository, { now: () => new Date(at) });
    if (scanContext) {
      const grouped = new Map();
      for(const result of scanContext.results || []) {
        if(!grouped.has(result.source)) grouped.set(result.source,[]);
        grouped.get(result.source).push(result);
      }
      for (const [source,results] of grouped) {
        // ok: every phrase answered; partial: some did (the source works, a few queries failed);
        // failed: nothing answered, so the source is effectively down for this scan.
        const ok=results.every(result=>result.status==='ok');
        const someOk=results.some(result=>result.status==='ok'||result.status==='partial');
        // limited: nothing answered, but only because of HTTP 429 — the source works at a slower pace.
        const limited=!someOk&&results.every(result=>result.status==='ok'||result.diagnostic?.code==='SOURCE_HTTP_429');
        const code=[...new Set(results.filter(result=>result.status!=='ok').map(result=>result.diagnostic?.code||'SOURCE_REQUEST_FAILED'))].join(', ');
        db.prepare(`INSERT INTO source_health(source,last_checked_at,last_success_at,last_error_at,last_error,status) VALUES(?,?,?,?,?,?)
          ON CONFLICT(source) DO UPDATE SET last_checked_at=excluded.last_checked_at,
          last_success_at=COALESCE(excluded.last_success_at,source_health.last_success_at),
          last_error_at=COALESCE(excluded.last_error_at,source_health.last_error_at),
          last_error=COALESCE(excluded.last_error,source_health.last_error),status=excluded.status`).run(source,at,someOk?at:null,ok?null:at,ok?null:code,ok?'ok':someOk?'partial':limited?'limited':'failed');
      }
    }
    return report;
  });

  // The scanned offers as saved, read in one query. Price judgements are not made here any more:
  // statistics are computed in SQL where they are shown (price-stats.mjs).
  const rows = ids.length
    ? db.prepare(`SELECT o.id, o.source, o.normalized_url AS url, o.original_title AS title, o.current_price AS price,
         o.availability, o.first_seen_at AS firstSeenAt, o.last_seen_at AS lastSeenAt, o.observed_isbn AS isbn,
         o.language, o.seen_count AS seenCount, o.matched_queries_json,
         (SELECT COALESCE(e.legacy_id,w.legacy_id,'edition:' || e.id) FROM offer_matches m JOIN editions e ON e.id=m.edition_id
            JOIN works w ON w.id=e.work_id WHERE m.offer_id=o.id AND m.status='active' LIMIT 1) AS bookId
       FROM offers o JOIN json_each(?) j ON j.value=o.id ORDER BY j.key`).all(JSON.stringify(ids))
    : [];
  const analyzed = rows.map(({ matched_queries_json: queries, ...row }) => {
    let matchedQueries = [];
    try { matchedQueries = JSON.parse(queries || '[]'); } catch {}
    return { ...row, originalTitle: row.title, currentPrice: row.price, matchedQueries: Array.isArray(matchedQueries) ? matchedQueries : [] };
  });
  return {
    ingest, offers:analyzed, lastScan,
    summary:{newOffers,priceChanges},
    history:{saved:db.prepare('SELECT count(*) AS total FROM offers').get().total,
      new:newOffers,priceChanges},
  };
}
