// Review queue: identification jobs that wait for a decision, their buckets and groups, the
// "sure" plan and its application, ISBN matching and decisions, local candidates for a job.
// Read models for the catalogue lists stay in catalog-api.mjs.
import { normalizeISBN } from './isbn-normalization.mjs';
import { rejectRepeatsOfRejectedOffers } from './rejected-offers.mjs';
import { randomUUID } from 'node:crypto';
import { proxiedImage } from './offer-images.mjs';
import { authorTokens, scoreCandidate, titleTokens } from './title-proposals.mjs';
import { createCatalogBundleDetector, looksLikeBundle } from './bundle-detection.mjs';
import { chooseEditionForOffer, editionForWorkAssignment } from './edition-variants.mjs';
import {
  editionCovers,
  getCatalogEdition,
  json,
  likeLiteral,
  offer,
  page,
  stableId,
} from './catalog-api.mjs';

// Queue tabs of "Do weryfikacji". Disjoint: an offer without ISBN is "quick" (it is in the
// catalogue or has a sure title proposal) or "noisbn"; an offer with ISBN is "add" (no source
// knows the ISBN / it has several records), "bundle" or "other".
export const REVIEW_BUCKETS = ['quick', 'add', 'noisbn', 'bundle', 'games', 'other', 'reference'];
export const GAME_REASONS = ['game_rulebook', 'foreign_edition'];
export const ADD_REASONS = ['isbn_not_found_in_metadata_sources', 'multiple_metadata_records'];
const REASON_SQL =
  "json_extract(CASE WHEN json_valid(j.result_json) THEN j.result_json ELSE '{}' END,'$.reason[0]')";
// Review reasons that are about the ISBN itself: every offer with that ISBN follows one decision.
export const FOLLOWS_SAME_ISBN = [
  'isbn_not_found_in_metadata_sources',
  'multiple_metadata_records',
  'metadata_invalid_or_incomplete',
  'metadata_isbn_mismatch',
];

// The global manual queue counts decisions, including temporarily skipped offers.
// Empik jobs belong to reference enrichment, not to the operator's queue.
export function reviewQueueSummary(repository) {
  const row = repository.database
    .prepare(
      `SELECT count(*) AS offers,
    count(DISTINCT CASE WHEN coalesce(o.observed_isbn,'')<>'' AND ${REASON_SQL} IN (${FOLLOWS_SAME_ISBN.map((reason) => `'${reason}'`).join(',')})
      THEN 'isbn:'||replace(replace(upper(o.observed_isbn),'-',''),' ','') ELSE 'job:'||j.id END) AS decisions
    FROM identification_jobs j JOIN offers o ON o.id=j.offer_id
    WHERE j.status='review_required' AND o.source<>'Empik'`,
    )
    .get();
  return { decisions: Number(row.decisions), offers: Number(row.offers) };
}

// Offers the operator skipped ("Pomiń", key S): out of the review list until restored. Kept in the
// database, not the browser, so the list can be paged on the server (and the phone sees them too).
const SKIPPED_KEY = 'review_skipped';
const SKIPPED_LIMIT = 500;
/** @returns {string[]} */
export function reviewSkippedIds(repository) {
  const row = repository.database
    .prepare('SELECT value_json FROM app_preferences WHERE key=?')
    .get(SKIPPED_KEY);
  const ids = row ? json(row.value_json, []) : [];
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
}

/**
 * Adds skipped offers (review job ids) or clears the list. Ids no longer waiting for a decision are
 * dropped, and the list keeps the newest 500.
 */
export function updateReviewSkipped(
  repository,
  { add = [], clear = false } = {},
  { now = () => new Date() } = {},
) {
  const database = repository.database;
  const wanted = clear ? [] : [...reviewSkippedIds(repository), ...[].concat(add).map(String)];
  const pending = new Set(
    database
      .prepare(
        "SELECT id FROM identification_jobs WHERE status='review_required' AND id IN (SELECT value FROM json_each(?))",
      )
      .all(JSON.stringify(wanted))
      .map((row) => row.id),
  );
  const ids = [...new Set(wanted.filter((id) => pending.has(id)))].slice(-SKIPPED_LIMIT);
  database
    .prepare(
      'INSERT INTO app_preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at',
    )
    .run(SKIPPED_KEY, JSON.stringify(ids), now().toISOString());
  return { skippedCount: ids.length };
}
// One placeholder: the JSON list of "quick" job ids.
// Parameters: the bundle job ids, then the quick job ids (both JSON arrays from reviewGroups).
const BUCKET_SQL = `(CASE WHEN o.source='Empik' THEN 'reference' WHEN ${REASON_SQL} IN ('game_rulebook','foreign_edition') THEN 'games'
  WHEN j.id IN (SELECT value FROM json_each(?)) THEN 'bundle'
  WHEN coalesce(o.observed_isbn,'')='' THEN
    (CASE WHEN j.id IN (SELECT value FROM json_each(?)) THEN 'quick' ELSE 'noisbn' END)
  WHEN ${REASON_SQL} IN (${ADD_REASONS.map((reason) => `'${reason}'`).join(',')}) THEN 'add'
  WHEN ${REASON_SQL}='possible_bundle' THEN 'bundle' ELSE 'other' END)`;

/**
 * Review jobs without ISBN that match the catalogue by title, those with a sure proposal, and
 * listings that look like several books (set words, or two catalogue titles), with or without ISBN.
 */
function reviewGroups(repository, matcher) {
  const rows = repository.database
    .prepare(
      `SELECT j.id, o.original_title, p.confidence FROM identification_jobs j JOIN offers o ON o.id=j.offer_id
       LEFT JOIN title_proposals p ON p.job_id=j.id
       WHERE j.status='review_required' AND coalesce(o.observed_isbn,'')=''
         AND coalesce(json_extract(CASE WHEN json_valid(j.result_json) THEN j.result_json ELSE '{}' END,'$.reason[0]'),'') NOT IN ('game_rulebook','foreign_edition')`,
    )
    .all();
  const catalog = [];
  const quick = [];
  for (const row of rows) {
    const inCatalog = matcher()(row.original_title, { limit: 1 }).length > 0;
    if (inCatalog) catalog.push(row.id);
    if (inCatalog || row.confidence === 'high') quick.push(row.id);
  }
  const detect = createCatalogBundleDetector(repository);
  const bundle = repository.database
    .prepare(
      `SELECT j.id, o.original_title FROM identification_jobs j JOIN offers o ON o.id=j.offer_id
       WHERE j.status='review_required'
         AND coalesce(json_extract(CASE WHEN json_valid(j.result_json) THEN j.result_json ELSE '{}' END,'$.reason[0]'),'') NOT IN ('game_rulebook','foreign_edition')`,
    )
    .all()
    .filter((row) => looksLikeBundle(row.original_title) || detect(row.original_title).length >= 2)
    .map((row) => row.id);
  return { catalog, quick, bundle };
}

/**
 * The decisions a "sure" tab can take at once, for the operator to look through before applying:
 * - the title matches exactly one work of the catalogue very well (score >= 0.9): its preferred edition;
 * - otherwise a sure (high) title proposal from BN / Open Library: its ISBN.
 * Anything ambiguous is left out and stays for a one-by-one decision.
 */
export function sureReviewPlan(repository, { jobIds = null } = {}) {
  const matcher = createLocalWorkMatcher(repository);
  const rows = repository.database
    .prepare(
      `SELECT j.id, j.offer_id, o.original_title, o.source, o.current_price, p.confidence, p.candidates_json
       FROM identification_jobs j JOIN offers o ON o.id=j.offer_id LEFT JOIN title_proposals p ON p.job_id=j.id
       WHERE j.status='review_required' AND coalesce(o.observed_isbn,'')=''
         AND coalesce(${REASON_SQL},'') NOT IN ('game_rulebook','foreign_edition')`,
    )
    .all()
    .filter((row) => !jobIds || jobIds.includes(row.id));
  const items = [];
  let skipped = 0;
  for (const row of rows) {
    // 0.9: a weaker title match ("Mroczne Imperium" vs the trilogy's third book) is not sure.
    const local = localEditionCandidates(repository, row.original_title, {
      limit: 6,
      minScore: 0.9,
      matcher,
    });
    const works = new Set(local.map((item) => item.workId));
    if (local.length && works.size === 1) {
      // The edition only when the listing points at it; otherwise the book with an unknown edition.
      const choice = chooseEditionForOffer(repository, local[0].workId, row.offer_id);
      const best = local.find((item) => item.editionId === choice.editionId) || null;
      const shown = best || local[0];
      items.push({
        jobId: row.id,
        offerTitle: row.original_title,
        source: row.source,
        kind: 'edition',
        editionId: best?.editionId ?? null,
        workId: shown.workId,
        editionReason: choice.reason,
        title: shown.title,
        authors: shown.authors,
        publisher: best?.publisher ?? '',
        year: best?.publicationYear ?? null,
        isbn: best?.isbn ?? '',
        score: shown.score,
        editions: local.length,
      });
      continue;
    }
    const candidate = row.confidence === 'high' ? json(row.candidates_json, [])[0] : null;
    // A catalogue work that resembles the title (even weakly) makes a new ISBN a real choice.
    if (!local.length && candidate?.isbn && !matcher(row.original_title, { limit: 1 }).length) {
      items.push({
        jobId: row.id,
        offerTitle: row.original_title,
        source: row.source,
        kind: 'isbn',
        isbn: candidate.isbn,
        title: candidate.title,
        authors: candidate.authors?.length
          ? candidate.authors
          : [candidate.authorText].filter(Boolean),
        publisher: candidate.publisher ?? '',
        year: candidate.publicationYear ?? null,
        score: candidate.score ?? null,
      });
      continue;
    }
    if (works.size || candidate) skipped += 1;
  }
  return { items, skipped };
}

/**
 * "This book, edition not settled" for a title proposal that names the book by an ISBN (often
 * several editions differ only by year): the book is found in the catalogue by that ISBN, or its
 * edition is created from BN / Open Library first, and the offer goes to the book's unknown edition
 * (or the edition the listing itself points at) — one decision in the history, like choosing a
 * catalogue book without an edition.
 */
export async function approveJobAsBook(catalog, jobId, { isbn, reason } = {}) {
  const repository = catalog.repository;
  const clean = normalizeISBN(String(isbn ?? ''));
  if (!clean) throw Object.assign(Error('INVALID_ISBN'), { statusCode: 400 });
  const job = repository.database
    .prepare('SELECT status FROM identification_jobs WHERE id=?')
    .get(String(jobId));
  if (!job) throw Object.assign(Error('IDENTIFICATION_JOB_NOT_FOUND'), { statusCode: 404 });
  if (job.status !== 'review_required')
    throw Object.assign(Error('REVIEW_JOB_NOT_PENDING'), { statusCode: 409 });
  let edition = repository.findEditionByISBN(clean);
  if (!edition) {
    const result = await catalog.resolveIsbn(clean);
    if (
      !['created_edition', 'created_work_and_edition', 'matched_existing'].includes(result.decision)
    )
      throw Object.assign(Error('ISBN_NOT_RESOLVED'), { statusCode: 409 });
    edition = repository.findEditionByISBN(clean);
  }
  if (!edition) throw Object.assign(Error('EDITION_NOT_FOUND'), { statusCode: 404 });
  return decideIdentificationJob(repository, jobId, {
    action: 'approved',
    workId: edition.work_id,
    reason: reason ?? 'Ta książka, wydanie nieustalone (z propozycji po tytule).',
  });
}

/** Applies the items the operator kept from sureReviewPlan, one offer at a time. */
export async function applySureReviewPlan(catalog, items = []) {
  const results = [];
  for (const item of items.slice(0, 500)) {
    const jobId = String(item?.jobId ?? '');
    try {
      if (item?.editionId || item?.workId) {
        decideIdentificationJob(catalog.repository, jobId, {
          action: 'approved',
          ...(item.editionId
            ? { editionId: String(item.editionId) }
            : { workId: String(item.workId) }),
          reason: 'Zatwierdzono hurtowo: tytuł jednoznacznie pasuje do dzieła z katalogu.',
        });
        results.push({ jobId, ok: true });
      } else if (item?.isbn) {
        const result = await matchIdentificationJobByIsbn(catalog, jobId, {
          isbn: String(item.isbn),
          confirm: true,
        });
        results.push(
          result.matched
            ? { jobId, ok: true }
            : { jobId, ok: false, error: [].concat(result.reason ?? ['NOT_MATCHED'])[0] },
        );
      } else results.push({ jobId, ok: false, error: 'INVALID_ITEM' });
    } catch (error) {
      results.push({
        jobId,
        ok: false,
        error: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'DECISION_FAILED',
      });
    }
  }
  return { results, approved: results.filter((row) => row.ok).length };
}

export function listIdentificationJobs(repository, options = {}) {
  const { database } = repository,
    { limit, offset, query } = page(options),
    conditions = [],
    params = [],
    status = String(options.status ?? ''),
    source = String(options.source ?? '');
  conditions.push(
    status
      ? 'j.status=?'
      : "j.status IN ('queued','running','retry_wait','review_required','failed')",
  );
  if (status) params.push(status);
  if (options.offerId) {
    conditions.push('o.id=?');
    params.push(String(options.offerId));
  }
  if (source) {
    conditions.push('o.source=?');
    params.push(source);
  }
  const isbn = String(options.isbn || '');
  if (isbn === 'present') conditions.push("o.observed_isbn IS NOT NULL AND o.observed_isbn<>''");
  if (isbn === 'missing') conditions.push("(o.observed_isbn IS NULL OR o.observed_isbn='')");
  if (query) {
    conditions.push(
      "(bookflip_fold(o.original_title) LIKE ? ESCAPE '!' OR bookflip_fold(o.observed_isbn) LIKE ? ESCAPE '!' OR bookflip_fold(o.source) LIKE ? ESCAPE '!')",
    );
    params.push(likeLiteral(query), likeLiteral(query), likeLiteral(query));
  }
  if (options.scan) {
    conditions.push(
      'EXISTS (SELECT 1 FROM scan_offer_results sr WHERE sr.offer_id=o.id AND sr.scanned_at=?)',
    );
    params.push(String(options.scan));
  }
  // The title matcher reads every work: built at most once per request.
  let matcherInstance = null;
  const lazyMatcher = () => (matcherInstance ||= createLocalWorkMatcher(repository));
  const groups = status === 'review_required' ? reviewGroups(repository, lazyMatcher) : null;
  // List view of "Do weryfikacji" (view=list): offers the operator skipped stay out of the list
  // and of the tab counts; pages count decisions (offers with one ISBN are one row, see below).
  const listView = options.view === 'list';
  const skippedIds = listView ? reviewSkippedIds(repository) : [];
  if (skippedIds.length) {
    conditions.push('j.id NOT IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(skippedIds));
  }
  // "Pasuje do katalogu" is decided on the server, so it covers the whole queue, not the loaded page.
  if (isbn === 'catalog') {
    conditions.push('j.id IN (SELECT value FROM json_each(?))');
    params.push(JSON.stringify(groups?.catalog ?? []));
  }
  // Queue tabs: their counts follow every other filter, the list follows the chosen tab.
  let buckets = null;
  if (groups) {
    buckets = { quick: 0, add: 0, noisbn: 0, bundle: 0, games: 0, other: 0, reference: 0 };
    for (const row of database
      .prepare(
        `SELECT ${BUCKET_SQL} AS bucket, count(*) AS count FROM identification_jobs j JOIN offers o ON o.id=j.offer_id WHERE ${conditions.join(' AND ')} GROUP BY bucket`,
      )
      .all(JSON.stringify(groups.bundle), JSON.stringify(groups.quick), ...params))
      buckets[row.bucket] = Number(row.count);
    if (REVIEW_BUCKETS.includes(String(options.bucket || ''))) {
      conditions.push(`${BUCKET_SQL}=?`);
      params.push(
        JSON.stringify(groups.bundle),
        JSON.stringify(groups.quick),
        String(options.bucket),
      );
    }
  }
  if (groups && !options.bucket) conditions.push("o.source<>'Empik'");
  const where = `WHERE ${conditions.join(' AND ')}`;
  const total = Number(
    database
      .prepare(
        `SELECT count(*) AS count FROM identification_jobs j JOIN offers o ON o.id=j.offer_id ${where}`,
      )
      .get(...params).count,
  );
  // Quickest decisions first: a catalogue title match, then sure, possible, weak title proposals.
  const confidenceRank =
    "CASE p.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END";
  const rank = groups
    ? `CASE WHEN j.id IN (SELECT value FROM json_each(?)) THEN -1 ELSE ${confidenceRank} END`
    : confidenceRank;
  const rankParams = groups ? [JSON.stringify(groups.catalog)] : [];
  const [orderBy, orderParams] =
    // By the offer's price, either way; offers without a price last.
    options.sort === 'price'
      ? ['o.current_price IS NULL,o.current_price ASC,j.id', []]
      : options.sort === 'price-desc'
        ? ['o.current_price IS NULL,o.current_price DESC,j.id', []]
        : options.sort === 'group'
          ? [
              `bookflip_fold(COALESCE(json_extract(o.matched_queries_json,'$[0]'),'~')),${rank},bookflip_fold(o.original_title),j.id`,
              rankParams,
            ]
          : options.sort === 'proposal'
            ? [`${rank},p.best_score DESC,j.id`, rankParams]
            : options.sort === 'newest'
              ? ['coalesce(o.first_seen_at,o.last_seen_at) DESC,j.id', []]
              : [
                  "CASE j.status WHEN 'review_required' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,j.updated_at DESC,j.id",
                  [],
                ];
  const columns = `j.*,o.source,o.original_title,o.current_price,o.currency,o.normalized_url,o.observed_isbn,o.last_seen_at,o.availability,o.image_url,o.matched_queries_json,o.first_seen_at,
      p.confidence AS proposal_confidence,p.best_isbn AS proposal_isbn,p.best_score AS proposal_score`;
  const from =
    'FROM identification_jobs j JOIN offers o ON o.id=j.offer_id LEFT JOIN title_proposals p ON p.job_id=j.id';
  let rows;
  let decisions = total;
  let groupSizes = null;
  if (listView) {
    // Offers with one ISBN whose decision is about the ISBN (no source knows it, several records)
    // follow one decision: one row, the first in the chosen order, with sameIsbnCount.
    const ranked = `WITH base AS (
      SELECT ${columns},
        CASE WHEN coalesce(o.observed_isbn,'')<>'' AND ${REASON_SQL} IN (${FOLLOWS_SAME_ISBN.map((reason) => `'${reason}'`).join(',')})
          THEN 'isbn:'||replace(replace(upper(o.observed_isbn),'-',''),' ','') ELSE 'job:'||j.id END AS decision_key,
        ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS ord
      ${from} ${where}
    ), ranked AS (
      SELECT base.*, ROW_NUMBER() OVER (PARTITION BY decision_key ORDER BY ord) AS rn,
        count(*) OVER (PARTITION BY decision_key) AS same_isbn_count
      FROM base
    )`;
    const rankedParams = [...orderParams, ...params];
    rows = database
      .prepare(`${ranked} SELECT * FROM ranked WHERE rn=1 ORDER BY ord LIMIT ? OFFSET ?`)
      .all(...rankedParams, limit, offset);
    // Decisions per scan phrase (group headers of the list), and in total.
    const perPhrase = database
      .prepare(
        `${ranked} SELECT json_extract(matched_queries_json,'$[0]') AS phrase, count(*) AS count FROM ranked WHERE rn=1 GROUP BY phrase`,
      )
      .all(...rankedParams);
    decisions = perPhrase.reduce((sum, row) => sum + Number(row.count), 0);
    if (options.sort === 'group')
      groupSizes = perPhrase.map((row) => [row.phrase ?? '', Number(row.count)]);
  } else
    rows = database
      .prepare(`SELECT ${columns} ${from} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...orderParams, ...params, limit, offset);
  const matcher = rows.some((row) => !row.observed_isbn) ? lazyMatcher() : null;
  // The whole queue, whatever tab, search or source filter is on: for the menu and page counters.
  const queueTotal = Number(
    database
      .prepare(
        `SELECT count(*) AS count FROM identification_jobs j JOIN offers o ON o.id=j.offer_id WHERE o.source<>'Empik' AND ${
          status
            ? 'j.status=?'
            : "j.status IN ('queued','running','retry_wait','review_required','failed')"
        }`,
      )
      .get(...(status ? [status] : [])).count,
  );
  return {
    // In the list view: decisions (rows); offersTotal counts the offers they cover.
    total: decisions,
    ...(listView
      ? {
          offersTotal: total,
          groupSizes,
          skippedCount: skippedIds.length
            ? Number(
                database
                  .prepare(
                    "SELECT count(*) AS count FROM identification_jobs WHERE status='review_required' AND id IN (SELECT value FROM json_each(?))",
                  )
                  .get(JSON.stringify(skippedIds)).count,
              )
            : 0,
        }
      : {}),
    queueTotal,
    queueDecisions: reviewQueueSummary(repository).decisions,
    limit,
    offset,
    ...(buckets ? { buckets } : {}),
    items: rows.map((row) => ({
      id: row.id,
      offerId: row.offer_id,
      ...(listView ? { sameIsbnCount: Number(row.same_isbn_count) } : {}),
      catalogMatch: (() => {
        if (row.observed_isbn || row.status !== 'review_required' || !matcher) return null;
        const best = matcher(row.original_title, { limit: 1 })[0];
        return best ? { workId: best.work.id, title: best.work.title, score: best.score } : null;
      })(),
      status: row.status,
      attemptCount: row.attempt_count,
      lastError: row.last_error,
      result: json(row.result_json),
      updatedAt: row.updated_at,
      proposal: row.proposal_confidence
        ? {
            confidence: row.proposal_confidence,
            isbn: row.proposal_isbn,
            score: row.proposal_score,
          }
        : null,
      offer: {
        id: row.offer_id,
        source: row.source,
        title: row.original_title,
        currentPrice: row.current_price,
        currency: row.currency,
        url: row.normalized_url,
        observedIsbn: row.observed_isbn,
        lastSeenAt: row.last_seen_at,
        availability: row.availability,
        image: row.image_url ? proxiedImage(row.image_url) : null,
        matchedQueries: json(row.matched_queries_json, []),
        firstSeenAt: row.first_seen_at,
      },
    })),
  };
}

/**
 * Resolve a reviewed ISBN against the local catalog and metadata providers,
 * with the original offer context. Unlike catalog-only lookup this can attach
 * the offer, but never silently overrides a manual assignment.
 */
export async function matchIdentificationJobByIsbn(
  catalog,
  jobId,
  input = {},
  { now = () => new Date() } = {},
) {
  const repository = catalog.repository;
  const job = repository.database
    .prepare('SELECT id,offer_id,status FROM identification_jobs WHERE id=?')
    .get(String(jobId));
  if (!job) throw Object.assign(Error('IDENTIFICATION_JOB_NOT_FOUND'), { statusCode: 404 });
  if (job.status !== 'review_required')
    throw Object.assign(Error('REVIEW_JOB_NOT_PENDING'), { statusCode: 409 });
  const offer = repository.database
    .prepare('SELECT observed_isbn FROM offers WHERE id=?')
    .get(job.offer_id);
  const raw = String(input.isbn ?? offer?.observed_isbn ?? '').trim();
  if (!raw) throw Object.assign(Error('ISBN_REQUIRED'), { statusCode: 400 });
  const isbn = normalizeISBN(raw);
  if (!isbn) throw Object.assign(Error('INVALID_ISBN'), { statusCode: 400 });
  if (input.preview === true) {
    const existing = repository.findEditionByISBN(isbn);
    if (existing)
      return {
        isbn,
        preview: true,
        matched: false,
        canConfirm: true,
        source: 'catalog',
        editionId: existing.id,
        candidate: getCatalogEdition(repository, existing.id),
      };
  }
  // A typed ISBN is an explicit operator assertion, not evidence extracted
  // from an unrelated advertisement. Matching uses ISBN alone.
  const recordId =
    typeof input.recordId === 'string' && input.recordId.length <= 200 ? input.recordId : null;
  const result = await catalog.resolver.resolve({
    offerId: job.offer_id,
    dryRun: input.preview === true,
    recordId,
    evidence: {
      status: 'valid',
      values: [isbn],
      isbn,
      candidateIsbn: isbn,
      classification: 'structured',
      autoAssignable: true,
      reviewRequired: false,
      observations: [{ value: isbn, classification: 'structured', source: 'review:operator' }],
    },
  });
  const matched = ['matched_existing', 'created_edition', 'created_work_and_edition'].includes(
    result.decision,
  );
  if (input.preview === true) {
    const existing = repository.findEditionByISBN(isbn);
    return {
      ...result,
      isbn,
      preview: true,
      canConfirm: matched,
      matched: false,
      source: existing ? 'catalog' : 'api',
      candidate: existing ? getCatalogEdition(repository, existing.id) : (result.candidate ?? null),
    };
  }
  if (input.confirm === true && matched) {
    decideIdentificationJob(repository, job.id, {
      action: 'approved',
      editionId: result.editionId,
      reason: 'Zatwierdzono po podglądzie dopasowania ISBN.',
    });
    return { ...result, isbn, matched: true, status: 'completed' };
  }
  const at = now().toISOString();
  // Do not mark the job completed for temporary API errors, missing metadata,
  // or mismatched bibliographic information.
  const saved = repository.database
    .prepare(
      "UPDATE identification_jobs SET status=?,result_json=?,updated_at=?,last_error=NULL WHERE id=? AND status='review_required'",
    )
    .run(matched ? 'completed' : 'review_required', JSON.stringify(result), at, job.id);
  if (Number(saved.changes) !== 1)
    throw Object.assign(Error('REVIEW_JOB_CHANGED'), { statusCode: 409 });
  return { ...result, isbn, matched, status: matched ? 'completed' : 'review_required' };
}

export function decideIdentificationJob(
  repository,
  jobId,
  input = {},
  { now = () => new Date(), idFactory = randomUUID } = {},
) {
  const action = String(input.action ?? '');
  if (!['approved', 'proposal_rejected', 'not_book', 'excluded', 'requeued'].includes(action))
    throw Object.assign(Error('INVALID_REVIEW_ACTION'), { statusCode: 400 });
  return repository.transaction(() => {
    const job = repository.database
      .prepare('SELECT * FROM identification_jobs WHERE id=?')
      .get(String(jobId));
    if (!job) throw Object.assign(Error('IDENTIFICATION_JOB_NOT_FOUND'), { statusCode: 404 });
    const at = now().toISOString();
    let editionId = input.editionId ? String(input.editionId) : null;
    // Approved as a book only: the edition the listing points at, or the book's unknown edition.
    let editionChoice = null;
    if (action === 'approved' && !editionId && input.workId) {
      editionChoice = editionForWorkAssignment(repository, String(input.workId), job.offer_id, {
        now,
      });
      editionId = editionChoice.editionId;
    }
    const active = repository.database
      .prepare("SELECT * FROM offer_matches WHERE offer_id=? AND status='active'")
      .get(job.offer_id);
    if (
      active &&
      ['manual', 'legacy_manual'].includes(active.method) &&
      (action !== 'approved' || active.edition_id !== editionId)
    )
      throw Object.assign(Error('MANUAL_ASSIGNMENT_PROTECTED'), { statusCode: 409 });
    if (['not_book', 'excluded'].includes(action) && active)
      repository.database
        .prepare(
          "UPDATE offer_matches SET status='superseded',valid_to=? WHERE offer_id=? AND status='active'",
        )
        .run(at, job.offer_id);
    if (action === 'approved') {
      if (
        !editionId ||
        !repository.database.prepare('SELECT id FROM editions WHERE id=?').get(editionId)
      )
        throw Object.assign(Error('EDITION_NOT_FOUND'), { statusCode: 404 });
      if (
        !active ||
        active.edition_id !== editionId ||
        !['manual', 'legacy_manual'].includes(active.method)
      )
        repository.assignOfferToEdition(job.offer_id, editionId, {
          id: stableId('manual_match', job.offer_id, editionId, at),
          method: 'manual',
          status: 'active',
          reason: String(input.reason ?? 'Zatwierdzone ręcznie w lokalnym interfejsie.'),
          createdBy: 'local_user',
          at,
        });
    }
    if (action === 'proposal_rejected' && editionId)
      repository.assignOfferToEdition(job.offer_id, editionId, {
        id: stableId('rejected_match', job.offer_id, editionId, at),
        method: 'metadata',
        status: 'rejected',
        reason: String(input.reason ?? 'Propozycja odrzucona ręcznie.'),
        createdBy: 'local_user',
        at,
      });
    const decisionId = String(input.id ?? idFactory());
    repository.database
      .prepare(
        'INSERT INTO review_decisions(id,job_id,offer_id,edition_id,action,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        decisionId,
        job.id,
        job.offer_id,
        editionId,
        action,
        input.reason ? String(input.reason) : null,
        'local_user',
        at,
      );
    const status = ['approved', 'not_book', 'excluded'].includes(action)
      ? 'completed'
      : action === 'requeued'
        ? 'queued'
        : 'review_required';
    const result = {
      manualDecision: action,
      editionId,
      reason: input.reason ?? null,
      decidedAt: at,
    };
    repository.database
      .prepare(
        'UPDATE identification_jobs SET status=?,run_after=NULL,lease_token=NULL,lease_expires_at=NULL,last_error=NULL,attempt_count=CASE WHEN ?=1 THEN 0 ELSE attempt_count END,result_json=?,updated_at=? WHERE id=?',
      )
      .run(status, action === 'requeued' ? 1 : 0, JSON.stringify(result), at, job.id);
    // Copies of a just-rejected offer already waiting in review are rejected now (reversibly, see
    // rejected-offers.mjs) instead of at the next start of the app.
    if (['not_book', 'excluded'].includes(action))
      rejectRepeatsOfRejectedOffers(repository, { now });
    return {
      decision: {
        id: decisionId,
        action,
        editionId,
        createdAt: at,
        ...(editionChoice
          ? { editionReason: editionChoice.reason, unknownEdition: Boolean(editionChoice.unknown) }
          : {}),
      },
      job: {
        ...repository.database.prepare('SELECT * FROM identification_jobs WHERE id=?').get(job.id),
        result,
      },
    };
  });
}

/**
 * Editions already in the catalogue whose work title matches an offer title. Offline and instant,
 * so offers without ISBN that are reprints of known books get a one-key proposal even when BN is
 * slow. Advice only: the operator still approves the chosen edition.
 */
/**
 * Title matcher over the live (not merged) works, built once per request. Universe names
 * ("World of Warcraft", "Warhammer") are on every cover, so the work's own words must match;
 * an inverted index keeps it fast when the catalogue grows.
 */
export function createLocalWorkMatcher(repository) {
  const works = repository.database
    .prepare(
      'SELECT id, title, authors_json FROM works w WHERE NOT EXISTS (SELECT 1 FROM catalog_work_merges x WHERE x.source_id=w.id) AND NOT EXISTS (SELECT 1 FROM removed_works rw WHERE rw.work_id=w.id)',
    )
    .all()
    .map((work) => ({
      work,
      authors: json(work.authors_json, []),
      own: titleTokens(String(work.title).split(' / ')[0], { dropBrand: true }),
    }))
    .filter((item) => item.own.length);
  // Every catalogue author: a listing naming one of them is not another author's book.
  const knownAuthors = new Set(works.flatMap((item) => authorTokens(item)));
  const index = new Map();
  for (const item of works)
    for (const word of item.own) {
      if (!index.has(word)) index.set(word, []);
      index.get(word).push(item);
    }
  return (offerTitle, { limit = 4, minScore = 0.6 } = {}) => {
    const offerWords = new Set(titleTokens(offerTitle, { dropBrand: true }));
    const pool = new Set([...offerWords].flatMap((word) => index.get(word) || []));
    return [...pool]
      .filter(
        (item) => item.own.filter((word) => offerWords.has(word)).length / item.own.length >= 0.6,
      )
      .map((item) => ({
        work: item.work,
        authors: item.authors,
        score: scoreCandidate(
          offerTitle,
          { title: item.work.title, authors: item.authors },
          { knownAuthors },
        ),
      }))
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  };
}

export function localEditionCandidates(
  repository,
  offerTitle,
  { limit = 4, minScore = 0.6, matcher } = {},
) {
  const { database } = repository;
  const scored = (matcher || createLocalWorkMatcher(repository))(offerTitle, { limit, minScore });
  if (!scored.length) return [];
  const editions = database
    .prepare(
      `SELECT e.id, e.work_id, e.title, e.publisher, e.publication_year, e.language,
              (SELECT normalized_value FROM edition_identifiers i WHERE i.edition_id=e.id AND i.scheme IN ('isbn13','isbn10') ORDER BY i.scheme DESC LIMIT 1) AS isbn,
              (SELECT count(*) FROM offer_matches m WHERE m.edition_id=e.id AND m.status='active') AS offers
       FROM editions e WHERE e.is_unknown=0 AND e.work_id IN (${scored.map(() => '?').join(',')})`,
    )
    .all(...scored.map((item) => item.work.id));
  const covers = editionCovers(
    database,
    editions.map((row) => row.id),
  );
  const rank = new Map(scored.map((item, index) => [item.work.id, index]));
  return (
    editions
      .map((row) => {
        const { work, authors, score } = scored[rank.get(row.work_id)];
        return {
          editionId: row.id,
          workId: work.id,
          title: work.title,
          authors,
          publisher: row.publisher || '',
          publicationYear: row.publication_year || null,
          language: row.language || '',
          isbn: row.isbn || '',
          offers: Number(row.offers || 0),
          cover: covers.get(row.id) || null,
          score,
        };
      })
      // Among good matches the edition the operator already uses most (and Polish ones) goes first.
      .sort(
        (a, b) =>
          (b.score >= 0.8) - (a.score >= 0.8) ||
          !/^(?:pol|pl|polski)?$/i.test(a.language) - !/^(?:pol|pl|polski)?$/i.test(b.language) ||
          b.offers - a.offers ||
          b.score - a.score ||
          (b.publicationYear || 0) - (a.publicationYear || 0),
      )
      .slice(0, limit)
  );
}

/**
 * Books (works) of the catalogue matching an offer title, one item per book. The edition is
 * named only when the listing makes it clear (ISBN, the only edition, year/binding/publisher
 * from the listing); otherwise `editionId` is null and approving assigns the book with an
 * unknown edition, which the operator can name later.
 */
export function localWorkCandidates(
  repository,
  offerTitle,
  { offerId = null, limit = 4, minScore = 0.6, matcher } = {},
) {
  const editions = localEditionCandidates(repository, offerTitle, { limit: 60, minScore, matcher });
  const byWork = new Map();
  for (const item of editions) {
    if (!byWork.has(item.workId)) byWork.set(item.workId, []);
    byWork.get(item.workId).push(item);
  }
  return [...byWork.values()]
    .sort((a, b) => b[0].score - a[0].score)
    .slice(0, limit)
    .map((items) => {
      const [first] = items;
      const choice = offerId
        ? chooseEditionForOffer(repository, first.workId, offerId)
        : {
            editionId: items.length === 1 ? first.editionId : null,
            reason: items.length === 1 ? 'only_edition' : 'ambiguous',
          };
      const chosen = items.find((item) => item.editionId === choice.editionId) || null;
      const shown = chosen || first;
      return {
        workId: first.workId,
        editionId: chosen?.editionId ?? null,
        editionReason: choice.reason,
        editionCount: items.length,
        title: first.title,
        authors: first.authors,
        publisher: chosen ? chosen.publisher : '',
        publicationYear: chosen ? chosen.publicationYear : null,
        language: shown.language,
        isbn: chosen ? chosen.isbn : '',
        offers: items.reduce((sum, item) => sum + item.offers, 0),
        cover: shown.cover || items.find((item) => item.cover)?.cover || null,
        score: first.score,
      };
    });
}
