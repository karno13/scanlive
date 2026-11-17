// Read models for the catalogue lists: works, editions, offers and offer groups. The review queue
// (identification jobs and decisions) is in review-queue.mjs.
import { offerStatusHistory, relistLinks, saleWindow } from './offer-status.mjs';
import { createHash } from 'node:crypto';
import { proxiedImage } from './offer-images.mjs';
import { marketValuations } from './market-valuation.mjs';
import { variantsOfWork } from './edition-variants.mjs';

export const json = (value, fallback = null) => {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
};
const number = (value, fallback, min, max) =>
  Number.isInteger(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
export const likeLiteral = (value) =>
  `%${String(value).replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`;
export const stableId = (prefix, ...values) =>
  `${prefix}_${createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)}`;
export const page = (options = {}) => ({
  limit: number(options.limit, 100, 1, 250),
  offset: number(options.offset, 0, 0, 1_000_000),
  query: String(options.query ?? '')
    .trim()
    .normalize('NFC')
    .toLocaleLowerCase('pl'),
});

function identifierMap(database, editionIds) {
  const result = new Map();
  if (!editionIds.length) return result;
  const rows = database
    .prepare(
      `SELECT edition_id,scheme,normalized_value,source,verification_status FROM edition_identifiers
    WHERE edition_id IN (${editionIds.map(() => '?').join(',')}) ORDER BY scheme,normalized_value`,
    )
    .all(...editionIds);
  for (const row of rows) {
    if (!result.has(row.edition_id)) result.set(row.edition_id, []);
    result.get(row.edition_id).push({
      scheme: row.scheme,
      value: row.normalized_value,
      source: row.source,
      verificationStatus: row.verification_status,
    });
  }
  return result;
}

export function offer(row) {
  return (
    row && {
      id: row.id,
      legacyId: row.legacy_id,
      source: row.source,
      externalOfferId: row.external_offer_id,
      url: row.normalized_url,
      title: row.original_title,
      currentPrice: row.current_price,
      currency: row.currency,
      availability: row.availability,
      availabilityChangedAt: row.availability_changed_at ?? null,
      language: row.language,
      observedIsbn: row.observed_isbn,
      matchedQueries: json(row.matched_queries_json, []),
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      seenCount: row.seen_count,
      image: row.image_url ? proxiedImage(row.image_url) : null,
      // What the source said about the copy and the listing (migration 124); null when it said nothing.
      condition: row.condition_text ?? null,
      conditionClass: row.condition_class ?? null,
      buyerFee: row.buyer_fee ?? null,
      shippingCost: row.shipping_cost ?? null,
      sellerId: row.seller_id ?? null,
      sellerName: row.seller_name ?? null,
      sellerBusiness: row.seller_business == null ? null : row.seller_business === 1,
      photoCount: row.photo_count ?? null,
      listedAt: row.listed_at ?? null,
      listedAtText: row.listed_at_text ?? null,
      favouriteCount: row.favourite_count ?? null,
      viewCount: row.view_count ?? null,
      sourceAvailability: row.source_availability ?? null,
    }
  );
}

// Cover of an edition = photo of a matched offer. Bookstore photos are clean covers, so they win
// over marketplace photos (which may show a stack of books or a used copy).
export function editionCovers(database, editionIds) {
  const result = new Map();
  if (!editionIds.length) return result;
  const rows = database
    .prepare(
      `SELECT m.edition_id, o.image_url FROM offer_matches m JOIN offers o ON o.id=m.offer_id
       WHERE m.status='active' AND o.image_url IS NOT NULL AND m.edition_id IN (${editionIds.map(() => '?').join(',')})
       ORDER BY CASE o.source WHEN 'Empik' THEN 0 WHEN 'Tezeusz.pl' THEN 1 WHEN 'Dedalus.pl' THEN 2 ELSE 3 END, o.last_seen_at DESC`,
    )
    .all(...editionIds);
  for (const row of rows)
    if (!result.has(row.edition_id)) result.set(row.edition_id, proxiedImage(row.image_url));
  return result;
}

// Bibliographic details from migration 112 (BN MARC): people with roles, series, original title.
function hasBibliography(database) {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edition_series'")
      .get(),
  );
}
function editionBibliography(database, row) {
  if (!hasBibliography(database)) return {};
  return {
    subtitle: row.subtitle ?? null,
    originalTitle: row.original_title ?? null,
    originalLanguage: row.original_language ?? null,
    pageCount: row.page_count ?? null,
    heightCm: row.height_cm ?? null,
    placeOfPublication: row.place_of_publication ?? null,
    genres: json(row.genres_json, []),
    contributors: database
      .prepare(
        'SELECT p.id, p.name, c.role FROM edition_contributors c JOIN persons p ON p.id=c.person_id WHERE c.edition_id=? ORDER BY c.position, p.name',
      )
      .all(row.id)
      .map((item) => ({ id: item.id, name: item.name, role: item.role })),
    series: database
      .prepare(
        'SELECT name, kind, volume, source FROM edition_series WHERE edition_id=? ORDER BY position, name',
      )
      .all(row.id)
      .map((item) => ({
        name: item.name,
        kind: item.kind,
        volume: item.volume,
        source: item.source,
      })),
  };
}

/**
 * Works with a gap, by the "gap" filter of the works list and the counts of "Braki w katalogu":
 * a real edition (not "Wydanie nieustalone") without publisher or year, or an unsettled edition.
 */
export const WORK_GAP_SQL = {
  publisher:
    "EXISTS (SELECT 1 FROM editions ge WHERE ge.work_id=w.id AND ge.is_unknown=0 AND coalesce(trim(ge.publisher),'')='')",
  year: 'EXISTS (SELECT 1 FROM editions ge WHERE ge.work_id=w.id AND ge.is_unknown=0 AND ge.publication_year IS NULL)',
  unknown: 'EXISTS (SELECT 1 FROM editions ge WHERE ge.work_id=w.id AND ge.is_unknown=1)',
};

export function listCatalogWorks(repository, options = {}) {
  const { database } = repository,
    { limit, offset, query } = page(options),
    like = likeLiteral(query);
  const conditions = [
    'NOT EXISTS (SELECT 1 FROM catalog_work_merges cm WHERE cm.source_id=w.id) AND NOT EXISTS (SELECT 1 FROM removed_works rw WHERE rw.work_id=w.id)',
  ];
  const params = [];
  if (query) {
    // Also finds translators and original titles ("Cholewa", "Light fantastic").
    const extra = hasBibliography(database)
      ? " OR EXISTS (SELECT 1 FROM editions pe JOIN edition_contributors pc ON pc.edition_id=pe.id JOIN persons pp ON pp.id=pc.person_id WHERE pe.work_id=w.id AND bookflip_fold(pp.name) LIKE ? ESCAPE '!') OR EXISTS (SELECT 1 FROM editions oe WHERE oe.work_id=w.id AND bookflip_fold(oe.original_title) LIKE ? ESCAPE '!')"
      : '';
    conditions.push(
      "(bookflip_fold(w.title) LIKE ? ESCAPE '!' OR bookflip_fold(w.authors_json) LIKE ? ESCAPE '!' OR EXISTS (SELECT 1 FROM editions se JOIN edition_identifiers si ON si.edition_id=se.id WHERE se.work_id=w.id AND bookflip_fold(si.normalized_value) LIKE ? ESCAPE '!')" +
        extra +
        ')',
    );
    params.push(like, like, like);
    if (extra) params.push(like, like);
  }
  if (options.person && hasBibliography(database)) {
    conditions.push(
      'EXISTS (SELECT 1 FROM editions xe JOIN edition_contributors xc ON xc.edition_id=xe.id WHERE xe.work_id=w.id AND xc.person_id=?)',
    );
    params.push(String(options.person));
  }
  if (options.gap && WORK_GAP_SQL[options.gap]) conditions.push(WORK_GAP_SQL[options.gap]);
  const editionFilters = [];
  for (const [key, column] of [
    ['language', 'language'],
    ['publisher', 'publisher'],
    ['binding', 'binding'],
  ]) {
    if (options[key]) {
      editionFilters.push('bookflip_fold(fe.' + column + ')=bookflip_fold(?)');
      params.push(String(options[key]));
    }
  }
  if (options.year) {
    editionFilters.push('fe.publication_year=?');
    params.push(Number(options.year));
  }
  if (editionFilters.length)
    conditions.push(
      'EXISTS (SELECT 1 FROM editions fe WHERE fe.work_id=w.id AND ' +
        editionFilters.join(' AND ') +
        ')',
    );
  const where = 'WHERE ' + conditions.join(' AND ');
  const total = Number(
    database.prepare(`SELECT count(*) AS count FROM works w ${where}`).get(...params).count,
  );
  const works = database
    .prepare(
      `SELECT w.*,
    (SELECT count(*) FROM editions e WHERE e.work_id=w.id AND e.is_unknown=0) AS edition_count,
    (SELECT count(*) FROM offer_matches m JOIN editions e ON e.id=m.edition_id WHERE e.work_id=w.id AND m.status='active') AS offer_count
    FROM works w ${where} ORDER BY ${options.sort === 'offers' ? 'offer_count DESC,bookflip_fold(w.title),w.id' : options.sort === 'recent' ? 'w.updated_at DESC,w.id' : 'bookflip_fold(w.title),w.id'} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const editionRows = works.length
    ? database
        .prepare(
          `SELECT * FROM editions WHERE is_unknown=0 AND work_id IN (${works.map(() => '?').join(',')}) ORDER BY publication_year,title`,
        )
        .all(...works.map((row) => row.id))
    : [];
  const identifiers = identifierMap(
      database,
      editionRows.map((row) => row.id),
    ),
    covers = editionCovers(
      database,
      editionRows.map((row) => row.id),
    ),
    byWork = new Map(),
    valuations = marketValuations(
      database,
      'work',
      works.map((row) => row.id),
    );
  for (const row of editionRows) {
    if (!byWork.has(row.work_id)) byWork.set(row.work_id, []);
    byWork.get(row.work_id).push({
      id: row.id,
      title: row.title,
      publisher: row.publisher,
      publicationYear: row.publication_year,
      language: row.language,
      binding: row.binding,
      verificationStatus: row.verification_status,
      identifiers: identifiers.get(row.id) ?? [],
      cover: covers.get(row.id) ?? null,
      ...editionBibliography(database, row),
    });
  }
  return {
    total,
    limit,
    offset,
    items: works.map((row) => ({
      id: row.id,
      legacyId: row.legacy_id,
      title: row.title,
      authors: json(row.authors_json, []),
      verificationStatus: row.verification_status,
      editionCount: Number(row.edition_count),
      offerCount: Number(row.offer_count),
      editions: byWork.get(row.id) ?? [],
      cover: (byWork.get(row.id) ?? []).find((edition) => edition.cover)?.cover ?? null,
      valuation: valuations.get(row.id) ?? null,
    })),
  };
}

export function getCatalogWork(repository, workId) {
  const alias = repository.database
    .prepare('SELECT target_id FROM catalog_work_merges WHERE source_id=?')
    .get(String(workId));
  if (alias) return getCatalogWork(repository, alias.target_id);
  const { database } = repository,
    row = database.prepare('SELECT * FROM works WHERE id=?').get(String(workId));
  if (!row) return null;
  const allEditions = database
    .prepare('SELECT * FROM editions WHERE work_id=? ORDER BY publication_year,title')
    .all(row.id);
  const editions = allEditions.filter((item) => item.is_unknown !== 1);
  const unknownIds = allEditions.filter((item) => item.is_unknown === 1).map((item) => item.id);
  const { variants } = variantsOfWork(repository, row.id);
  const variantOf = new Map(
    variants.flatMap((variant) => variant.editionIds.map((id) => [id, variant.key])),
  );
  const identifiers = identifierMap(
    database,
    editions.map((item) => item.id),
  );
  const covers = editionCovers(
    database,
    editions.map((item) => item.id),
  );
  const external = database
    .prepare(
      `SELECT DISTINCT r.provider,r.external_id,r.record_type,r.status,r.fetched_at,r.payload_hash
    FROM external_records r LEFT JOIN external_record_links l ON l.external_record_id=r.id
    WHERE COALESCE(r.work_id,l.work_id)=? ORDER BY r.fetched_at DESC`,
    )
    .all(row.id);
  return {
    id: row.id,
    legacyId: row.legacy_id,
    title: row.title,
    authors: json(row.authors_json, []),
    verificationStatus: row.verification_status,
    editions: editions.map((item) => ({
      id: item.id,
      title: item.title,
      publisher: item.publisher,
      publicationYear: item.publication_year,
      language: item.language,
      binding: item.binding,
      verificationStatus: item.verification_status,
      identifiers: identifiers.get(item.id) ?? [],
      cover: covers.get(item.id) ?? null,
      ...editionBibliography(database, item),
      variantKey: variantOf.get(item.id) ?? null,
      activeOfferCount: Number(
        database
          .prepare(
            "SELECT count(*) AS count FROM offer_matches WHERE edition_id=? AND status='active'",
          )
          .get(item.id).count,
      ),
    })),
    variants: variants.map(({ key, label, manual, editionIds, years }) => ({
      key,
      label,
      manual,
      editionIds,
      years,
    })),
    // Offers assigned to the book without a named edition.
    unknownEdition: unknownIds.length
      ? {
          id: unknownIds[0],
          editionIds: unknownIds,
          activeOfferCount: Number(
            database
              .prepare(
                `SELECT count(*) AS count FROM offer_matches WHERE status='active' AND edition_id IN (${unknownIds.map(() => '?').join(',')})`,
              )
              .get(...unknownIds).count,
          ),
        }
      : null,
    externalRecords: external.map((item) => ({
      provider: item.provider,
      externalId: item.external_id,
      recordType: item.record_type,
      status: item.status,
      fetchedAt: item.fetched_at,
      payloadHash: item.payload_hash,
    })),
  };
}

export function getCatalogEdition(repository, editionId) {
  const { database } = repository,
    row = database
      .prepare(
        `SELECT e.*,w.title AS work_title,w.authors_json FROM editions e JOIN works w ON w.id=e.work_id WHERE e.id=?`,
      )
      .get(String(editionId));
  if (!row) return null;
  const offers = database
    .prepare(
      `SELECT o.*,m.method,m.valid_from FROM offer_matches m JOIN offers o ON o.id=m.offer_id WHERE m.edition_id=? AND m.status='active' ORDER BY o.last_seen_at DESC`,
    )
    .all(row.id);
  const records = database
    .prepare(
      `SELECT DISTINCT r.provider,r.external_id,r.record_type,r.status,r.fetched_at,r.payload_hash
    FROM external_records r LEFT JOIN external_record_links l ON l.external_record_id=r.id WHERE COALESCE(r.edition_id,l.edition_id)=? ORDER BY r.fetched_at DESC`,
    )
    .all(row.id);
  return {
    id: row.id,
    workId: row.work_id,
    workTitle: row.work_title,
    authors: json(row.authors_json, []),
    title: row.title,
    publisher: row.publisher,
    publicationYear: row.publication_year,
    language: row.language,
    binding: row.binding,
    isUnknown: row.is_unknown === 1,
    verificationStatus: row.verification_status,
    identifiers: identifierMap(database, [row.id]).get(row.id) ?? [],
    cover: editionCovers(database, [row.id]).get(row.id) ?? null,
    ...editionBibliography(database, row),
    offers: offers.map((item) => ({
      ...offer(item),
      method: item.method,
      matchedAt: item.valid_from,
    })),
    externalRecords: records.map((item) => ({
      provider: item.provider,
      externalId: item.external_id,
      recordType: item.record_type,
      status: item.status,
      fetchedAt: item.fetched_at,
      payloadHash: item.payload_hash,
    })),
  };
}

/** FROM and WHERE of the offer list, shared by the list and the by-edition grouping. */
function offerQueryParts(options) {
  const { query } = page(options),
    conditions = [],
    params = [],
    status = String(options.status ?? ''),
    source = String(options.source ?? '');
  if (options.edition) {
    conditions.push('m.edition_id=?');
    params.push(String(options.edition));
  }
  if (query) {
    conditions.push(
      "(bookflip_fold(o.original_title) LIKE ? ESCAPE '!' OR bookflip_fold(o.observed_isbn) LIKE ? ESCAPE '!' OR bookflip_fold(o.source) LIKE ? ESCAPE '!')",
    );
    params.push(likeLiteral(query), likeLiteral(query), likeLiteral(query));
  }
  if (source) {
    conditions.push('o.source=?');
    params.push(source);
  }
  // Rejected in review (by hand or as a copy of a rejected offer): out of every list unless asked for.
  const rejectedSql =
    "(j.status='completed' AND json_valid(j.result_json) AND json_extract(j.result_json,'$.manualDecision') IN ('excluded','not_book'))";
  if (status === 'rejected') conditions.push(rejectedSql);
  else if (status !== 'all') conditions.push(`NOT coalesce(${rejectedSql},0)`);
  // Listing state (offers.availability): active = found by a scan or confirmed on its page,
  // sold = Vinted's reference prices, unseen = missing from the last scan or removed.
  const availabilityGroups = {
    active: ['available', 'unconfirmed'],
    sold: ['sold'],
    unseen: ['not_seen', 'unavailable'],
  };
  const availabilityValues = availabilityGroups[String(options.availability ?? '')];
  if (availabilityValues) {
    conditions.push(`o.availability IN (${availabilityValues.map(() => '?').join(',')})`);
    params.push(...availabilityValues);
  }
  // Delivery price read from the listing page (Vinted): free = 0 zł, unknown = not read.
  const shipping = {
    free: 'o.shipping_cost=0',
    paid: 'o.shipping_cost>0',
    unknown: 'o.shipping_cost IS NULL',
  }[String(options.shipping ?? '')];
  if (shipping) conditions.push(shipping);
  if (status === 'matched') conditions.push('m.id IS NOT NULL');
  if (status === 'review')
    conditions.push("j.status IN ('queued','running','retry_wait','review_required','failed')");
  // Listings first seen after a moment (e.g. the operator's previous visit).
  if (options.since && !Number.isNaN(Date.parse(String(options.since)))) {
    conditions.push('o.first_seen_at>?');
    params.push(new Date(String(options.since)).toISOString());
  }
  // Offers of every edition of one book (the book page). Merged works resolve to their target.
  if (options.workId) {
    conditions.push('w.id=?');
    params.push(String(options.workId));
  }
  // Listings whose price changed in a scan after a moment (the "Dziś" view links here).
  if (options.priceChangedSince && !Number.isNaN(Date.parse(String(options.priceChangedSince)))) {
    conditions.push(
      'EXISTS (SELECT 1 FROM scan_offer_results sr WHERE sr.offer_id=o.id AND sr.price_changed=1 AND sr.scanned_at>?)',
    );
    params.push(new Date(String(options.priceChangedSince)).toISOString());
  }
  if (options.watched === '1') conditions.push('ow.watched=1');
  if (options.target === '1')
    conditions.push(
      "ow.watched=1 AND ow.target_price IS NOT NULL AND o.currency='PLN' AND o.current_price<=round(ow.target_price*100)",
    );
  if (options.purchaseStatus) {
    conditions.push('ow.purchase_status=?');
    params.push(String(options.purchaseStatus));
  }
  if (options.scan) {
    conditions.push(
      'EXISTS (SELECT 1 FROM scan_offer_results sr WHERE sr.offer_id=o.id AND sr.scanned_at=?' +
        (options.scanChange === 'new'
          ? ' AND sr.is_new=1'
          : options.scanChange === 'price'
            ? ' AND sr.price_changed=1'
            : '') +
        ')',
    );
    params.push(String(options.scan));
  }
  for (const [key, operator] of [
    ['minPrice', '>='],
    ['maxPrice', '<='],
  ]) {
    if (options[key] !== undefined && options[key] !== '') {
      const value = Number(options[key]);
      if (!Number.isFinite(value) || value < 0 || value > 100000000)
        throw Object.assign(Error('INVALID_PRICE_FILTER'), { statusCode: 400 });
      conditions.push("o.currency='PLN' AND o.current_price" + operator + '?');
      params.push(Math.round(value * 100));
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const from = `FROM offers o LEFT JOIN offer_workspace ow ON ow.offer_id=o.id LEFT JOIN offer_scenarios scenario ON scenario.offer_id=o.id LEFT JOIN offer_matches m ON m.offer_id=o.id AND m.status='active'
    LEFT JOIN editions e ON e.id=m.edition_id LEFT JOIN works w ON w.id=e.work_id
    LEFT JOIN identification_jobs j ON j.id = (
      SELECT j2.id FROM identification_jobs j2
      WHERE j2.offer_id=o.id AND j2.job_type='identify_edition'
      ORDER BY j2.created_at DESC,j2.id DESC LIMIT 1
    )`;
  return { from, where, params, conditions };
}

/** How many offers the Oferty list shows for these filters (same conditions, no rows). */
export function countCatalogOffers(repository, options = {}) {
  const { from, where, params } = offerQueryParts(options);
  return Number(
    repository.database
      .prepare(`SELECT count(DISTINCT o.id) AS count ${from} ${where}`)
      .get(...params).count,
  );
}

export function listCatalogOffers(repository, options = {}) {
  const { database } = repository,
    { limit, offset } = page(options),
    { from, where, params } = offerQueryParts(options);
  const total = Number(
    database.prepare(`SELECT count(DISTINCT o.id) AS count ${from} ${where}`).get(...params).count,
  );
  const offerSort = {
    // Newest = first discovered: after a scan every listing shares last_seen_at.
    newest: 'COALESCE(o.first_seen_at,o.last_seen_at) DESC,o.last_seen_at DESC,o.id',
    oldest: 'COALESCE(o.first_seen_at,o.last_seen_at) ASC,o.id',
    title: 'bookflip_fold(o.original_title) ASC,o.id',
    'title-desc': 'bookflip_fold(o.original_title) DESC,o.id',
    source: 'bookflip_fold(o.source) ASC,o.id',
    'source-desc': 'bookflip_fold(o.source) DESC,o.id',
    'price-asc': 'o.current_price IS NULL,o.current_price ASC,o.id',
    'price-desc': 'o.current_price IS NULL,o.current_price DESC,o.id',
  };
  const orderBy = offerSort[String(options.sort || 'newest')] || offerSort.newest;
  const rows = database
    .prepare(
      `SELECT o.*,ow.purchase_status,ow.watched,ow.target_price,scenario.actual_purchase,m.id AS match_id,m.method,e.id AS edition_id,e.title AS edition_title,w.title AS work_title,w.id AS match_work_id,j.id AS job_id,j.status AS job_status,
      CASE WHEN j.status='completed' AND json_valid(j.result_json) THEN json_extract(j.result_json,'$.manualDecision') END AS manual_decision
    ${from} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  return {
    total,
    limit,
    offset,
    items: rows.map((row) => ({
      ...offer(row),
      purchaseStatus: row.purchase_status || null,
      watched: Boolean(row.watched),
      targetPrice: row.target_price ?? null,
      actualPurchase: row.actual_purchase ?? null,
      targetReached: Boolean(
        row.watched &&
        row.target_price !== null &&
        row.currency === 'PLN' &&
        row.current_price !== null &&
        row.current_price <= Math.round(row.target_price * 100),
      ),
      match: row.match_id
        ? {
            id: row.match_id,
            method: row.method,
            editionId: row.edition_id,
            editionTitle: row.edition_title,
            workTitle: row.work_title,
            workId: row.match_work_id,
          }
        : null,
      identification: row.job_id ? { jobId: row.job_id, status: row.job_status } : null,
      rejected: ['excluded', 'not_book'].includes(row.manual_decision),
    })),
  };
}

/**
 * Offers grouped by the edition they are assigned to (same filters as the list): one row per
 * edition with the number of listings, the price range and the sources. Unassigned offers are
 * counted, not grouped — they have no edition yet.
 */
export function listCatalogOfferGroups(repository, options = {}) {
  const { database } = repository,
    { limit, offset } = page(options),
    { from, where, params } = offerQueryParts(options);
  const grouped = `${where ? where + ' AND' : 'WHERE'} m.id IS NOT NULL`;
  const total = Number(
    database
      .prepare(`SELECT count(DISTINCT m.edition_id) AS count ${from} ${grouped}`)
      .get(...params).count,
  );
  const unassigned = Number(
    database
      .prepare(
        `SELECT count(DISTINCT o.id) AS count ${from} ${where ? where + ' AND' : 'WHERE'} m.id IS NULL`,
      )
      .get(...params).count,
  );
  const order =
    {
      newest: 'newest DESC',
      oldest: 'newest ASC',
      'price-asc': 'min_price IS NULL, min_price ASC',
      'price-desc': 'max_price IS NULL, max_price DESC',
      title: 'bookflip_fold(w.title) ASC',
      'title-desc': 'bookflip_fold(w.title) DESC',
      offers: 'offers DESC',
    }[String(options.sort || 'offers')] || 'offers DESC';
  const rows = database
    .prepare(
      `SELECT e.id AS edition_id, w.id AS work_id, w.title AS work_title, w.authors_json, e.title AS edition_title,
         e.publisher, e.publication_year, count(DISTINCT o.id) AS offers,
         (SELECT normalized_value FROM edition_identifiers i WHERE i.edition_id=e.id AND i.scheme IN ('isbn13','isbn10') ORDER BY i.scheme DESC LIMIT 1) AS isbn,
         min(CASE WHEN o.currency='PLN' THEN o.current_price END) AS min_price,
         max(CASE WHEN o.currency='PLN' THEN o.current_price END) AS max_price,
         group_concat(DISTINCT o.source) AS sources, max(COALESCE(o.first_seen_at,o.last_seen_at)) AS newest
       ${from} ${grouped} GROUP BY e.id ORDER BY ${order}, e.id LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  const covers = editionCovers(
    database,
    rows.map((row) => row.edition_id),
  );
  const valuations = marketValuations(
    database,
    'edition',
    rows.map((row) => row.edition_id),
  );
  return {
    total,
    unassigned,
    limit,
    offset,
    items: rows.map((row) => ({
      editionId: row.edition_id,
      workId: row.work_id,
      workTitle: row.work_title,
      authors: json(row.authors_json, []),
      editionTitle: row.edition_title,
      publisher: row.publisher || '',
      publicationYear: row.publication_year || null,
      isbn: row.isbn || '',
      offers: Number(row.offers),
      minPrice: row.min_price ?? null,
      maxPrice: row.max_price ?? null,
      sources: String(row.sources || '')
        .split(',')
        .filter(Boolean),
      newest: row.newest,
      cover: covers.get(row.edition_id) || null,
      valuation: valuations.get(row.edition_id) ?? null,
    })),
  };
}

export function getCatalogOffer(repository, offerId) {
  const { database } = repository,
    row = database.prepare('SELECT * FROM offers WHERE id=?').get(String(offerId));
  if (!row) return null;
  const evidence = database
    .prepare('SELECT * FROM metadata_evidence WHERE offer_id=? ORDER BY observed_at,id')
    .all(row.id);
  const matches = database
    .prepare(
      `SELECT m.*,e.title AS edition_title,w.title AS work_title,w.id AS work_id FROM offer_matches m JOIN editions e ON e.id=m.edition_id JOIN works w ON w.id=e.work_id WHERE m.offer_id=? ORDER BY m.valid_from,m.id`,
    )
    .all(row.id);
  const job =
    database
      .prepare("SELECT * FROM identification_jobs WHERE offer_id=? AND job_type='identify_edition'")
      .get(row.id) ?? null;
  const decisions = database
    .prepare('SELECT * FROM review_decisions WHERE offer_id=? ORDER BY created_at,id')
    .all(row.id);
  return {
    ...offer(row),
    // When it was seen, missed, checked; a sale's interval; earlier and later copies of the listing.
    statusHistory: offerStatusHistory(database, row.id),
    saleWindow: saleWindow(database, row.id),
    relists: relistLinks(database, row.id),
    priceHistory: database
      .prepare(
        'SELECT price,observed_at FROM offer_price_history WHERE offer_id=? ORDER BY observed_at',
      )
      .all(row.id)
      .map((item) => ({ price: item.price, observedAt: item.observed_at })),
    evidence: evidence.map((item) => ({
      id: item.id,
      fieldName: item.field_name,
      value: json(item.value_json),
      classification: item.classification,
      sourceType: item.source_type,
      verificationStatus: item.verification_status,
      observedAt: item.observed_at,
    })),
    matches: matches.map((item) => ({
      id: item.id,
      editionId: item.edition_id,
      editionTitle: item.edition_title,
      workTitle: item.work_title,
      workId: item.work_id,
      method: item.method,
      status: item.status,
      reason: json(item.reason, item.reason),
      createdBy: item.created_by,
      validFrom: item.valid_from,
      validTo: item.valid_to,
    })),
    identificationJob: job
      ? {
          id: job.id,
          status: job.status,
          attemptCount: job.attempt_count,
          lastError: job.last_error,
          result: json(job.result_json),
          updatedAt: job.updated_at,
        }
      : null,
    decisions: decisions.map((item) => ({
      id: item.id,
      action: item.action,
      editionId: item.edition_id,
      reason: item.reason,
      createdBy: item.created_by,
      createdAt: item.created_at,
    })),
  };
}
