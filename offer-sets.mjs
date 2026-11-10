// A set is one marketplace offer containing several catalog editions.
// Price and inventory remain associated with the offer, not its members.
import { proxiedImage } from './offer-images.mjs';
import { localEditionCandidates } from './catalog-api.mjs';
import { fold } from './title-proposals.mjs';
import { NOT_A_CYCLE, BRAND_ONLY, catalogSeries, cycleKey } from './catalog-series.mjs';

export function listOfferSets(repository) {
  const db = repository.database;
  const rows = db.prepare(`SELECT s.offer_id AS offerId, o.original_title AS title, o.source,
    o.current_price AS currentPrice, o.currency, o.normalized_url AS url, o.image_url AS imageUrl,
    o.observed_isbn AS observedIsbn, o.availability, o.last_seen_at AS lastSeenAt,
    s.composition_confirmed AS compositionConfirmed, s.created_at AS createdAt,
    s.composed_from_description_at AS composedFromDescriptionAt
    FROM offer_sets s JOIN offers o ON o.id=s.offer_id ORDER BY s.updated_at DESC`).all();
  const editions = db.prepare(`SELECT se.offer_id AS offerId, se.edition_id AS editionId,
    e.title AS title, w.title AS workTitle, se.quantity,se.resale_price AS resalePrice,
    e.publisher,e.publication_year AS publicationYear,e.language,e.binding,
    (SELECT normalized_value FROM edition_identifiers WHERE edition_id=e.id AND scheme IN ('isbn13','isbn10') ORDER BY scheme DESC LIMIT 1) AS isbn
    FROM offer_set_editions se JOIN editions e ON e.id=se.edition_id
    JOIN works w ON w.id=e.work_id ORDER BY w.title,e.title`).all();
  const unknown= db.prepare('SELECT id,offer_id AS offerId,title,quantity FROM offer_set_unknown_items ORDER BY id').all();
  return rows.map(({ imageUrl, ...row }) => ({ ...row, image: imageUrl ? proxiedImage(imageUrl) : null, compositionConfirmed:Boolean(row.compositionConfirmed),
    editions: editions.filter(item => item.offerId === row.offerId), unknownItems:unknown.filter(item=>item.offerId===row.offerId) }));
}

export function markOfferAsSet(repository, offerId) {
  return repository.transaction(() => {
    const db = repository.database;
    if (!db.prepare('SELECT id FROM offers WHERE id=?').get(offerId))
      throw Object.assign(Error('OFFER_NOT_FOUND'), { statusCode: 404 });
    const busy = db.prepare("SELECT id FROM identification_jobs WHERE offer_id=? AND status='running'").get(offerId);
    if (busy) throw Object.assign(Error('IDENTIFICATION_IN_PROGRESS'), { statusCode: 409 });
    const now = new Date().toISOString();
    db.prepare('INSERT INTO offer_sets(offer_id,created_at,updated_at) VALUES(?,?,?) ON CONFLICT(offer_id) DO UPDATE SET updated_at=excluded.updated_at').run(offerId, now, now);
    db.prepare("UPDATE offer_matches SET status='superseded',valid_to=? WHERE offer_id=? AND status='active'").run(now, offerId);
    db.prepare("UPDATE identification_jobs SET status='completed',run_after=NULL,lease_token=NULL,lease_expires_at=NULL,result_json=?,updated_at=? WHERE offer_id=?").run(JSON.stringify({ decision:'manual_set', reason:['offer_is_set'] }), now, offerId);
    return { offerId, status: 'set' };
  });
}

export function updateSetEdition(repository, offerId, editionId, include) {
  return repository.transaction(() => {
    const db = repository.database;
    if (!db.prepare('SELECT offer_id FROM offer_sets WHERE offer_id=?').get(offerId))
      throw Object.assign(Error('SET_NOT_FOUND'), { statusCode: 404 });
    if (!db.prepare('SELECT id FROM editions WHERE id=?').get(editionId))
      throw Object.assign(Error('EDITION_NOT_FOUND'), { statusCode: 404 });
    if (include)
      db.prepare('INSERT OR IGNORE INTO offer_set_editions(offer_id,edition_id,added_at) VALUES(?,?,?)').run(offerId, editionId, new Date().toISOString());
    else
      db.prepare('DELETE FROM offer_set_editions WHERE offer_id=? AND edition_id=?').run(offerId, editionId);
    db.prepare('UPDATE offer_sets SET updated_at=? WHERE offer_id=?').run(new Date().toISOString(), offerId);
    db.prepare('UPDATE offer_sets SET composition_confirmed=0 WHERE offer_id=?').run(offerId);
    return { offerId, editionId, included: include };
  });
}

export function unmarkOfferSet(repository, offerId) {
  return repository.transaction(() => {
    const db = repository.database;
    const result = db.prepare('DELETE FROM offer_sets WHERE offer_id=?').run(offerId);
    if (!result.changes) throw Object.assign(Error('SET_NOT_FOUND'), { statusCode: 404 });
    db.prepare("UPDATE identification_jobs SET status='queued',run_after=NULL,result_json=NULL,updated_at=? WHERE offer_id=?").run(new Date().toISOString(), offerId);
    return { offerId, status: 'queued' };
  });
}

/**
 * Catalogue editions the set's listing names: every work whose own title appears in the listing
 * ("Kroniki Malusa: Klątwa demona, Spaczony miecz…"), and the edition of the ISBN the listing shows.
 * Suggestions only; the operator adds each one.
 */
export function setCandidates(repository, offerId, { text = '' } = {}) {
  const offer = repository.database.prepare('SELECT original_title, observed_isbn FROM offers WHERE id=?').get(offerId);
  if (!offer) throw Object.assign(Error('OFFER_NOT_FOUND'), { statusCode: 404 });
  // Pasted listing description: every line / list item is looked up on its own, strictly, since a
  // description names one book per entry ("1. Kolor magii", "Mort, Straż! Straż!").
  if (String(text).trim()) {
    const found = [];
    const seen = new Set();
    for (const part of descriptionParts(text)) {
      const hit = localEditionCandidates(repository, part, { limit: 1, minScore: 0.85 })[0];
      if (hit && !seen.has(hit.workId)) {
        seen.add(hit.workId);
        found.push({ ...hit, fromText: part });
      }
    }
    return { items: found.slice(0, 40) };
  }
  const items = localEditionCandidates(repository, offer.original_title, { limit: 12, minScore: 0.6 });
  if (offer.observed_isbn) {
    let edition = null;
    try {
      edition = repository.findEditionByISBN(offer.observed_isbn);
    } catch {}
    if (edition && !items.some((item) => item.editionId === edition.id))
      items.unshift({ editionId: edition.id, workId: edition.work_id, title: edition.work_title || edition.title, authors: [],
        publisher: edition.publisher || '', publicationYear: edition.publication_year || null, language: edition.language || '',
        isbn: offer.observed_isbn, offers: 0, cover: null, score: 1, fromIsbn: true });
  }
  // One edition per book (the listing's ISBN first, then the edition used most): "add all" must
  // not put three editions of "Mort" in one set.
  const seenWorks = new Set();
  const unique = items.filter((item) => !seenWorks.has(item.workId) && seenWorks.add(item.workId));
  items.splice(0, items.length, ...unique);
  // A set is usually a whole cycle: its other volumes, and cycles the listing names
  // ("Trylogia Sigmara", "Kroniki Malusa"), in volume order.
  const db = repository.database;
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edition_series'").get()) {
    const listing = ' ' + fold(offer.original_title) + ' ';
    const named = db
      .prepare("SELECT DISTINCT normalized_name, name FROM edition_series WHERE kind='cycle' AND length(normalized_name) >= 6")
      .all()
      // A one-word name ("Kroniki") is too common to tell one universe's cycle from another's.
      // "Świat Dysku" filed as a cycle is the universe: it would pull in arbitrary volumes.
      .filter((row) => fold(row.name).includes(' ') && !BRAND_ONLY.test(fold(row.name)) && listing.includes(' ' + fold(row.name) + ' '));
    const fromMembers = items.length
      ? db.prepare(`SELECT DISTINCT s.normalized_name, s.name FROM edition_series s WHERE s.kind='cycle'
          AND s.edition_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(items.map((item) => item.editionId)))
      : [];
    const cycles = [...new Map([...named, ...fromMembers].map((row) => [row.normalized_name, row])).values()]
      .filter((row) => !NOT_A_CYCLE.test(String(row.name).trim()))
      .slice(0, 3);
    const known = new Set(items.map((item) => item.workId));
    for (const cycle of cycles) {
      const rows = db
        .prepare(`SELECT e.id AS editionId, e.work_id AS workId, w.title, w.authors_json, e.publisher, e.publication_year, e.language, s.volume,
            (SELECT normalized_value FROM edition_identifiers i WHERE i.edition_id=e.id AND i.scheme IN ('isbn13','isbn10') ORDER BY i.scheme DESC LIMIT 1) AS isbn,
            (SELECT count(*) FROM offer_matches m WHERE m.edition_id=e.id AND m.status='active') AS offers
          FROM edition_series s JOIN editions e ON e.id=s.edition_id JOIN works w ON w.id=e.work_id
          WHERE s.normalized_name=? AND s.kind='cycle' ORDER BY s.volume IS NULL, s.volume, offers DESC`)
        .all(cycle.normalized_name);
      for (const row of rows) {
        if (known.has(row.workId) || items.length >= 24) continue;
        known.add(row.workId);
        let authors = [];
        try {
          authors = JSON.parse(row.authors_json || '[]');
        } catch {}
        items.push({ editionId: row.editionId, workId: row.workId, title: row.title, authors, publisher: row.publisher || '',
          publicationYear: row.publication_year || null, language: row.language || '', isbn: row.isbn || '', offers: Number(row.offers || 0),
          cover: null, score: null, cycle: cycle.name, volume: row.volume ?? null });
      }
    }
  }
  return { items };
}

/** A pasted description split into the entries that may each name one book. */
export function descriptionParts(text) {
  return String(text ?? '')
    .split(/\r?\n|[;•●▪|]|,(?=\s)|\s\+\s|\s[–—-]\s/)
    .map((part) => part.replace(/^\s*(?:\d{1,3}\s*[.)]|tom\s*\d{1,3}\s*[.:)-]?|[-*•])\s*/i, '').replace(/\s+/g, ' ').trim())
    .filter((part) => part.length >= 3 && part.length <= 160)
    .slice(0, 120);
}

/**
 * Editions for volumes `from`…`to` of a cycle, by the series view's numbering (BN records, the
 * operator's annotations and volume lists); the most used edition of each work.
 */
export function cycleVolumeEditions(repository, cycleName, from, to) {
  const key = cycleKey(cycleName);
  const low = Number(from);
  const high = Number(to);
  if (!key || !Number.isInteger(low) || !Number.isInteger(high) || low < 1 || high < low || high - low > 100)
    throw Object.assign(Error('INVALID_VOLUME_RANGE'), { statusCode: 400 });
  const works = catalogSeries(repository)
    .flatMap((universe) => universe.cycles)
    .filter((cycle) => cycle.name && cycleKey(cycle.name) === key)
    .flatMap((cycle) => cycle.works)
    .filter((work) => Number.isInteger(work.volume) && work.volume >= low && work.volume <= high);
  const edition = repository.database.prepare(
    `SELECT e.id, e.title FROM editions e WHERE e.work_id=?
     ORDER BY (SELECT count(*) FROM offer_matches m WHERE m.edition_id=e.id AND m.status='active') DESC, e.created_at LIMIT 1`,
  );
  const items = [];
  for (const work of works.sort((a, b) => a.volume - b.volume)) {
    const row = edition.get(work.id);
    if (row) items.push({ editionId: row.id, workId: work.id, title: work.title, volume: work.volume });
  }
  const found = new Set(items.map((item) => item.volume));
  const missing = [];
  for (let volume = low; volume <= high; volume++) if (!found.has(volume)) missing.push(volume);
  return { items, missing };
}
