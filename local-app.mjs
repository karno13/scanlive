import { tailscaleAccessFromEnv, validateBookflipRequest } from './tailscale-access.mjs';
import { tradingRoutes } from './trading-api.mjs';
import { createRouter } from './router.mjs';
import { listScanProfiles, putScanProfile, deleteScanProfile } from './scan-profiles-api.mjs';
import { createSqliteVintedDetailCache } from './vinted-detail-sqlite-cache.mjs';
import { publicAssetPath } from './static-asset-path.mjs';
import { retryIdentificationJobs } from './identification-retry.mjs';
import { enrichOffers } from './offer-enrichment.mjs';
import { DETAIL_SOURCES } from './source-details.mjs';
import { checkOfferLifecycle } from './offer-lifecycle.mjs';
import { fillSetsFromDescriptions } from './set-descriptions.mjs';
import { lookupUnknownIsbns } from './isbn-lookups.mjs';
import { getPolishOnly, rejectForeignEditions } from './language-policy.mjs';
import { blockedSources } from './source-blocks.mjs';
import { reassignOffer, unassignOffer } from './offer-assignment.mjs';
import { editionForWorkAssignment, mergeVariants, setEditionVariant, workPriceOverview } from './edition-variants.mjs';
import { createAutoBackupScheduler } from './auto-backup.mjs';
import { createScanScheduler, localScanRunner } from './scan-schedule.mjs';
import { computeProposal, loadProposal, refreshProposals, rescoreStoredProposals } from './title-proposals.mjs';
import { repairCatalogTitles } from './title-repair.mjs';
import { historyBookLabels } from './history-brief.mjs';
import { scanCancelled, awaitScan } from './scan-cancellation.mjs';
import { createVintedDetailCache } from './vinted-detail-cache.mjs';
import { listOfferWorkspace, setOfferWorkspace, importOfferWorkspace } from './offer-workspace-api.mjs';
import { listWorkSeries, updateWorkSeries } from './work-series-api.mjs';
import { createScanDiagnostics, addScanEvent, scanProgress, scanTelemetry } from './scan-diagnostics.mjs';
import { listOfferSets, markOfferAsSet, updateSetEdition, unmarkOfferSet, setCandidates, cycleVolumeEditions } from './offer-sets.mjs';
import { defaultCatalogPath } from './catalog-data-location.mjs';
import { normalizeISBN } from './isbn-normalization.mjs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, appendFile, writeFile, mkdir, rename, stat, rm, realpath } from 'node:fs/promises';
import { extname, join, dirname, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NEWEST_ORDER_SOURCES, scanMarketplace } from './marketplaces.mjs';
import { localSourceHosts } from './local-scan.mjs';
import { readVintedLanguage } from './vinted-detail.mjs';
import { listedAtFromAge } from './offer-observations.mjs';
import { createProductionCatalog, productionCatalogEnabled } from './catalog-production.mjs';
import {
  decideIdentificationJob,
  getCatalogEdition,
  getCatalogOffer,
  getCatalogWork,
  listCatalogOffers,
  listCatalogOfferGroups,
  listCatalogWorks,
  listIdentificationJobs,
  matchIdentificationJobByIsbn,
  localWorkCandidates,
  sureReviewPlan,
  applySureReviewPlan,
} from './catalog-api.mjs';
import { offerEditionDraft, createEditionFromOffer, recheckOfferEditions } from './offer-editions.mjs';
import { inferListingSeries } from './edition-series.mjs';
import { analyzedOffers, bookHistory, allBookStatistics } from './price-analysis.mjs';
import { sqliteHistoryModel } from './sqlite-history-read.mjs';
import {
  storageMode,
  createSqliteBook,
  linkSqliteOffer,
  persistSqliteScan,
  createScanState,
  persistSqliteScanBatch,
} from './sqlite-single-store.mjs';
import { createIdentificationScheduler } from './identification-scheduler.mjs';
import { createBuybackService } from './buyback-quotes.mjs';
import { createSkupksiazekClient } from './buyback-skupksiazek.mjs';
import { createImageBackfill, fetchCachedImage, offerImageUrl, proxiedImage } from './offer-images.mjs';
import { catalogInsights } from './catalog-insights.mjs';
import { catalogSeries, setWorkUniverse, getSeriesDefinition, saveSeriesDefinition } from './catalog-series.mjs';
import { catalogPersons, personWorks } from './catalog-bibliography.mjs';

let imageBackfill = null;
let buyback = null;
// One buyback service per process: the catalogue's quote cache plus the automatic background check.
function getBuyback() {
  const catalog = getProductionCatalog();
  if (!catalog) return null;
  buyback ||= createBuybackService(catalog.repository, createSkupksiazekClient());
  return buyback;
}
const appDirectory = fileURLToPath(new URL('./app/', import.meta.url));
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export function validateSearchInput(input) {
  const queries = [
    ...new Set(
      (Array.isArray(input?.queries) ? input.queries : [])
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
  const sources = [...new Set((Array.isArray(input?.sources) ? input.sources : []).map(String))];
  if (!queries.length || queries.length > 10 || queries.some((query) => query.length > 120))
    throw Object.assign(Error('INVALID_QUERIES'), { statusCode: 400 });
  if (
    !sources.length ||
    sources.length > Object.keys(localSourceHosts).length ||
    sources.some((source) => !localSourceHosts[source])
  )
    throw Object.assign(Error('INVALID_SOURCES'), { statusCode: 400 });
  if (input?.tasks !== undefined) {
    if (!Array.isArray(input.tasks) || !input.tasks.length || input.tasks.length>70 ||
        input.tasks.some(task=>!queries.includes(task?.query)||!sources.includes(task?.source)))
      throw Object.assign(Error('INVALID_SCAN_TASKS'),{statusCode:400});
    const tasks=[...new Map(input.tasks.map(task=>[JSON.stringify([task.source,task.query]),{source:task.source,query:task.query}])).values()];
    return {queries,sources,tasks,...newestMode(input, sources)};
  }
  return { queries, sources, ...newestMode(input, sources) };
}
// Quick scan: the first page of the newest listings per phrase, only where a source can sort by
// date. It never concludes that an offer disappeared (see persistSqliteScan).
function newestMode(input, sources) {
  if (input?.mode !== 'newest') return {};
  if (!sources.some((source) => NEWEST_ORDER_SOURCES.has(source)))
    throw Object.assign(Error('NEWEST_SCAN_NEEDS_SORTABLE_SOURCE'), { statusCode: 400 });
  return { mode: 'newest' };
}

const retryLimit = 3;
function safeCode(error) {
  return /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'SOURCE_REQUEST_FAILED';
}
function errorDiagnostic(error) {
  return {
    code: safeCode(error),
    httpStatus: Number.isInteger(error?.status) ? error.status : null,
    blocked: error?.blocked === true,
    retryable: isRetryable(error),
  };
}
function isRetryable(error) {
  if (error?.blocked === true) return false;
  if (error?.retryable === true) return true;
  if ([408, 425, 429].includes(error?.status) || error?.status >= 500) return true;
  if (['AbortError', 'TimeoutError'].includes(error?.name)) return true;
  return /(?:SOURCE_REQUEST_FAILED|fetch failed|socket|timeout|timed out|ECONNRESET|ETIMEDOUT)/i.test(
    String(error?.message || ''),
  );
}
export function retryDelay(error, attempt) {
  const retryAfter = error?.retryAfter;
  const suggested = retryAfter === null || retryAfter === undefined ? NaN : Number(retryAfter) * 1000;
  if (Number.isFinite(suggested) && suggested >= 0)
    return Math.min(24 * 60 * 60 * 1000, Math.max(1000, suggested));
  // A rate limit without Retry-After clears in tens of seconds, not in one or two.
  if (error?.status === 429) return 30000 * attempt;
  return Math.min(30000, Math.max(1000, 1000 * 2 ** (attempt - 1)));
}
async function retryRead(read, { onProgress = () => {}, waiter = wait, context = {}, signal = null } = {}) {
  for (let attempt = 1; attempt <= retryLimit; attempt++)
    try {
      return { value: await awaitScan(read(), signal), error: null };
    } catch (error) {
      scanCancelled(signal);
      if (attempt === retryLimit || !isRetryable(error)) return { value: null, error };
      const delayMs = retryDelay(error, attempt);
      onProgress({
        type: 'retry',
        ...context,
        attempt: attempt + 1,
        maxAttempts: retryLimit,
        delayMs,
        code: safeCode(error),
      });
      await awaitScan(waiter(delayMs), signal);
    }
  return { value: null, error: Error('SOURCE_REQUEST_FAILED') };
}

export async function searchOffers(
  input,
  {
    scanner = scanMarketplace,
    languageReader = readVintedLanguage,
    now = () => new Date(),
    onProgress = () => {},
    detailCache = new Map(),
    retryWait = wait,
    signal = null,
    // Called after each source+query with its accepted offers, so they can be saved during the scan.
    onOffers = null,
  } = {},
) {
  const { queries, sources, tasks, mode } = validateSearchInput(input),
    newest = mode === 'newest',
    results = [],
    languageCache = detailCache;
  await Promise.all(
    sources.map(async (source) => {
      // A source that blocked automated requests (CAPTCHA, 403) blocks the rest of this scan too:
      // its remaining phrases are reported at once instead of being asked and retried one by one.
      let blockedBy = null;
      for (const query of queries) {
        if(tasks && !tasks.some(task=>task.source===source && task.query===query)) continue;
        if (newest && !NEWEST_ORDER_SOURCES.has(source)) continue;
        scanCancelled(signal);
        if (blockedBy) {
          onProgress({ type: 'source-error', source, query, code: blockedBy.code, partial: 0 });
          results.push({ source, query, status: 'unavailable', offers: [], diagnostic: { ...blockedBy, skipped: true } });
          onProgress({ type: 'source-done', source, query, offers: 0, pages: 0, status: 'unavailable' });
          continue;
        }
        const task = {
          source,
          host: localSourceHosts[source],
          mode: 'discovery',
          title: query,
          category: query,
          // null: foreign editions are kept ("Tylko polskie wydania" switched off).
          language: input?.polishOnly === false ? null : 'pl',
          searchQuery: query,
          page: 1,
          paginationVersion: 1,
          ...(newest ? { order: 'newest' } : {}),
        };
        onProgress({ type: 'source-start', source, query });
        try {
          const scan = await scanAllPages(
            task,
            scanner,
            (event) => onProgress({ ...event, source, query }),
            retryWait,
            signal,
            newest ? 1 : 50,
          );
          let offers = scan.offers,
            diagnostic = scan.diagnostic;
          const rejected = { ...scan.rejected };
          if (source === 'Vinted' && task.language === 'pl' && offers.length) {
            onProgress({ type: 'language-start', source, query, count: offers.length });
            const filtered = await filterVintedPolishOffers(
              offers,
              languageReader,
              (event) => onProgress({ ...event, source, query }),
              languageCache,
              retryWait,
              signal,
              now,
            );
            offers = filtered.offers;
            diagnostic = diagnostic || filtered.diagnostic;
            for (const [reason, count] of Object.entries(filtered.rejected)) rejected[reason] = (rejected[reason] || 0) + count;
          }
          const status = diagnostic ? (offers.length ? 'partial' : 'unavailable') : 'ok';
          if (diagnostic?.blocked && !offers.length) blockedBy = diagnostic;
          if (diagnostic)
            onProgress({
              type: 'source-error',
              source,
              query,
              code: diagnostic.code,
              partial: offers.length,
            });
          results.push({
            source,
            query,
            status,
            offers,
            pagination: scan.pagination,
            pages: scan.pages,
            ...(Object.keys(rejected).length ? { rejected } : {}),
            ...(diagnostic ? { diagnostic } : {}),
          });
          if (onOffers && offers.length) {
            scanCancelled(signal);
            await onOffers({ source, query, offers: offers.map((offer) => ({ ...offer, source, matchedQueries: [query] })) });
          }
          onProgress({
            type: 'source-done',
            source,
            query,
            offers: offers.length,
            pages: scan.pages.length,
            status,
          });
        } catch (error) {
          scanCancelled(signal);
          const diagnostic = errorDiagnostic(error);
          if (diagnostic.blocked) blockedBy = diagnostic;
          onProgress({ type: 'source-error', source, query, code: diagnostic.code, partial: 0 });
          results.push({ source, query, status: 'unavailable', offers: [], diagnostic });
          onProgress({type:'source-done',source,query,offers:0,pages:0,status:'unavailable'});
        }
      }
    }),
  );
  scanCancelled(signal);
  const offersByUrl = new Map();
  for (const row of results) {
    for (const offer of row.offers) {
      const existing = offersByUrl.get(offer.url);
      if (existing) {
        if (!existing.matchedQueries.includes(row.query)) existing.matchedQueries.push(row.query);
        continue;
      }
      offersByUrl.set(offer.url, { ...offer, source: row.source, matchedQueries: [row.query] });
    }
  }
  const offers = [...offersByUrl.values()].sort(
    (a, b) => a.price - b.price || a.title.localeCompare(b.title, 'pl'),
  );
  // Listings left out before saving, by reason (language, topic, product; Vinted: unknown language).
  const rejected = {};
  for (const row of results)
    for (const [reason, count] of Object.entries(row.rejected || {})) rejected[reason] = (rejected[reason] || 0) + count;
  return {
    searchedAt: now().toISOString(),
    category: 'books',
    language: 'pl',
    queries,
    sources,
    ...(newest ? { mode: 'newest' } : {}),
    summary: {
      offers: offers.length,
      successful: results.filter((row) => row.status === 'ok').length,
      partial: results.filter((row) => row.status === 'partial').length,
      unavailable: results.filter((row) => row.status === 'unavailable').length,
      rejected,
    },
    offers,
    results: results.map(({ offers, ...row }) => ({ ...row, count: offers.length })),
  };
}
async function scanAllPages(task, scanner, onProgress = () => {}, waiter = wait, signal = null, maxPages = 50) {
  const offers = [],
    seenPages = new Set(),
    pages = [],
    rejected = {};
  let current = { ...task },
    diagnostic = null;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    scanCancelled(signal);
    if (seenPages.has(current.page)) {
      diagnostic = errorDiagnostic(Error('PAGINATION_LOOP'));
      break;
    }
    seenPages.add(current.page);
    onProgress({ type: 'page-start', page: current.page });
    const read = await retryRead(() => scanner(current, {signal}), {
      onProgress,
      waiter,
      signal,
      context: { scope: 'page', page: current.page },
    });
    if (read.error) {
      diagnostic = errorDiagnostic(read.error);
      break;
    }
    const scan = read.value;
    offers.push(...scan.offers);
    for (const [reason, count] of Object.entries(scan.rejected || {})) rejected[reason] = (rejected[reason] || 0) + count;
    pages.push({
      page: current.page,
      count: scan.offers.length,
      state: scan.pagination?.state || 'unknown',
    });
    onProgress({
      type: 'page-done',
      page: current.page,
      count: scan.offers.length,
      state: scan.pagination?.state || 'unknown',
      total: offers.length,
    });
    const next = scan.pagination?.nextPage;
    if (scan.pagination?.state !== 'more' || !Number.isInteger(next) || next <= current.page) break;
    current = { ...current, page: next };
  }
  return {
    offers,
    pagination: diagnostic
      ? { state: 'partial', nextPage: current.page }
      : pages.at(-1)?.state === 'more'
        ? { state: 'limit', nextPage: current.page }
        : pages.at(-1),
    pages,
    rejected,
    diagnostic,
  };
}
async function filterVintedPolishOffers(
  offers,
  languageReader,
  onProgress = () => {},
  cache = new Map(),
  waiter = wait,
  signal = null,
  now = () => new Date(),
) {
  offers = [...new Map(offers.map((offer) => [offer.url, offer])).values()];
  // At most two requests in flight, with one new Vinted request per second.
  // Cache hits require no network request and do not consume rate-limit slots.
  const accepted = new Array(offers.length);
  let next = 0, checked = 0, unknown = 0, cached = 0, foreign = 0;
  let diagnostic = null, stopped = false, lastRequestAt = 0;
  let startGate = Promise.resolve();

  async function startDetailRead(url, index) {
    let release;
    const previous = startGate;
    startGate = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      if (stopped) return { stopped: true };
      scanCancelled(signal);
      const delay = Math.max(0, lastRequestAt + 1000 - Date.now());
      if (delay) await awaitScan(waiter(delay), signal);
      if (stopped) return { stopped: true };
      scanCancelled(signal);
      lastRequestAt = Date.now();
      // Release start gate before waiting for the network response.
    } finally {
      release();
    }
    const read = await retryRead(() => languageReader(url, {signal}), {
      onProgress,
      waiter,
      signal,
      context: { scope: 'vinted-language', item: index + 1, total: offers.length },
    });
    return read;
  }

  async function worker() {
    while (!stopped) {
      scanCancelled(signal);
      const index = next++;
      if (index >= offers.length) return;
      const offer = offers[index];
      let detail = cache.get(offer.url);
      if (detail) cached++;
      else {
        const read = await startDetailRead(offer.url, index);
        if (read.stopped) return;
        if (read.error) {
          diagnostic ||= errorDiagnostic(read.error);
          stopped = true;
          return;
        }
        scanCancelled(signal);
        detail = read.value;
        cache.set(offer.url, detail);
      }
      checked++;
      if (/^(?:pl|pol|polish|polski|język polski)$/i.test(String(detail.language || '')))
        accepted[index] = {
          ...offer,
          language: 'Polski',
          ...(detail.isbn ? { isbn: detail.isbn, isbnEvidence: 'Vinted — szczegóły oferty' } : {}),
          ...vintedDetailFields(detail, now()),
        };
      else if (!detail.language) unknown++;
      else foreign++;
      onProgress({
        type: 'language-progress',
        checked,
        total: offers.length,
        accepted: accepted.filter(Boolean).length,
        unknown,
        cached,
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, offers.length) }, () => worker()));
  scanCancelled(signal);
  const rejected = {};
  if (foreign) rejected.language = foreign;
  if (unknown) rejected.language_unknown = unknown;
  return { offers: accepted.filter(Boolean), diagnostic, rejected };
}
// The listing page is read anyway for the language: keep what it says about the copy (description,
// condition, photos, age) instead of reading it again later. Cached decisions carry none of these.
function vintedDetailFields(detail, now = new Date()) {
  const out = {};
  if (typeof detail.description === 'string' && detail.description) out.listingDescription = detail.description.slice(0, 8000);
  for (const field of ['conditionText', 'listedAtText', 'photoCount', 'favouriteCount', 'sellerId'])
    if (detail[field] != null) out[field] = detail[field];
  if (detail.listedAtText) {
    const listedAt = listedAtFromAge(detail.listedAtText, now);
    if (listedAt) out.listedAt = listedAt;
  }
  if (detail.rawDetail) out.rawDetail = detail.rawDetail;
  return out;
}

export async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32768) throw Object.assign(Error('REQUEST_TOO_LARGE'), { statusCode: 413 });
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(Error('INVALID_JSON'), { statusCode: 400 });
  }
}
function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https://covers.openlibrary.org; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}
const runtimeDataDirectory = dirname(defaultCatalogPath());
const logPath = join(runtimeDataDirectory, 'local-app.log');
const scanStatusPath = join(runtimeDataDirectory, 'scan-status.json');
async function persistScanStatus(status) {
  await mkdir(runtimeDataDirectory, { recursive: true });
  const tempPath = scanStatusPath + '.' + process.pid + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(tempPath, JSON.stringify(status));
    await rename(tempPath, scanStatusPath);
  } finally {
    await rm(tempPath, { force: true });
  }
}
async function readScanStatus() {
  try {
    const value = JSON.parse(await readFile(scanStatusPath, 'utf8'));
    return value.status === 'running' ? { ...value, status: 'interrupted' } : value;
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'idle' };
    return { status: 'unknown' };
  }
}
let productionCatalog = null;
function getProductionCatalog() {
  if (!productionCatalogEnabled()) return null;
  if (!productionCatalog) productionCatalog = createProductionCatalog();
  return productionCatalog;
}
// Incremental compatibility bridge: manual JSON operations must not replay the
// entire historical snapshot into a live SQLite catalog.
let logWriteQueue = Promise.resolve();
const maxLogBytes = 5 * 1024 * 1024;
function recordProgress(event) {
  const safe = { at: new Date().toISOString(), ...event };
  logWriteQueue = logWriteQueue.then(async () => {
    await mkdir(runtimeDataDirectory, { recursive: true });
    const bytes = Buffer.byteLength(JSON.stringify(safe) + '\n');
    const size = await stat(logPath).then(file => file.size).catch(error => {
      if (error.code === 'ENOENT') return 0;
      throw error;
    });
    if (size + bytes > maxLogBytes) {
      await rm(logPath + '.1', { force: true });
      if (size) await rename(logPath, logPath + '.1');
    }
    await appendFile(logPath, JSON.stringify(safe) + '\n');
  }).catch(() => {});
  return safe;
}
function streamHeaders(response, type = 'application/x-ndjson; charset=utf-8') {
  response.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https://covers.openlibrary.org; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
}
export async function readHistoryForUi({ catalog = getProductionCatalog() } = {}) {
  if (!catalog) throw Error('SQLITE_HISTORY_REQUIRES_CATALOG');
  return sqliteHistoryModel(catalog.repository);
}
function historySnapshot(history) {
  return {
    updatedAt: history.updatedAt,
    lastScan: history.lastScan,
    books: allBookStatistics(history)
      .sort((a, b) => String(b.book.lastSeenAt).localeCompare(String(a.book.lastSeenAt))),
    offers: analyzedOffers(history).sort((a, b) =>
      String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)),
    ),
  };
}

// Keep the legacy full-snapshot response without loading every historical
// price observation. SQL reduces history to one minimum per offer first.
export function catalogHistorySnapshot(repository) {
  const history = sqliteHistoryModel(repository, { includePriceHistory: false });
  const snapshot = historySnapshot(history);
  const books = new Map(snapshot.books.map(row => [row.book.id, row]));
  for (const point of repository.database.prepare(
    'SELECT offer_id, min(price) AS price FROM offer_price_history GROUP BY offer_id',
  ).all()) {
    const book = books.get(history.offers[point.offer_id]?.bookId);
    if (book) book.historicalMinimum = book.historicalMinimum === null
      ? point.price : Math.min(book.historicalMinimum, point.price);
  }
  return snapshot;
}
let historyWriteTail = Promise.resolve();
export async function withHistoryWriteLock(work) {
  let release;
  const previous = historyWriteTail;
  historyWriteTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

// Reads detail pages of shops that publish the ISBN in structured data, in small paced batches,
// before the resolver runs so that new evidence is used in the same pass.
// A source that answered HTTP 429 or a challenge is left alone for half an hour. Without this the
// five-second scheduler kept it throttled and every poll used up another offer's attempt.
const enrichmentPausedUntil = new Map();
const ENRICHMENT_PAUSE_MS = 30 * 60_000;
async function enrichPendingOffers(catalogStore) {
  if (String(process.env.BOOKFLIP_DETAIL_ENRICHMENT ?? '1') === '0' || !catalogStore.repository?.database) return null;
  try {
    const now = Date.now();
    const sources = [...DETAIL_SOURCES].filter((source) => !(enrichmentPausedUntil.get(source) > now));
    if (!sources.length) return null;
    const report = await enrichOffers(catalogStore.repository, { limit: 10, sources });
    for (const source of report.paused ?? []) enrichmentPausedUntil.set(source, Date.now() + ENRICHMENT_PAUSE_MS);
    if (report.checked) recordProgress({ type: 'detail_enrichment', ...report });
    return report;
  } catch (error) {
    recordProgress({ type: 'detail_enrichment_error', code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'ENRICHMENT_ERROR' });
    return null;
  }
}

// Title proposals call the national catalogue (rate limited), so they run beside the resolver
// in small batches and never delay it.
let runningProposals = null;
let proposalsPausedUntil = 0;
function scheduleProposalRefresh(catalogStore) {
  if (runningProposals || String(process.env.BOOKFLIP_DETAIL_ENRICHMENT ?? '1') === '0') return;
  if (Date.now() < proposalsPausedUntil) return;
  if (typeof catalogStore.findIsbnsByTitle !== 'function' || !catalogStore.repository?.database) return;
  runningProposals = refreshProposals(catalogStore, { limit: 4 })
    .then((report) => {
      if (report.computed) recordProgress({ type: 'title_proposals', ...report });
      // The national catalogue is down or throttling: do not retry every few seconds.
      if (report.unavailable) proposalsPausedUntil = Date.now() + 10 * 60_000;
    })
    .catch((error) =>
      recordProgress({ type: 'title_proposals_error', code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'PROPOSAL_ERROR' }),
    )
    .finally(() => {
      runningProposals = null;
    });
}

// Offers that scans stopped returning: their own page says sold / reserved / gone. A few per
// ten minutes, through the shared per-source pacing gate.
let runningLifecycle = null;
let lifecycleNextAt = 0;
// ISBNs that BN, Open Library and e-ISBN do not know: searched by title on lubimyczytac.pl (two
// per two minutes, paced); a page with the same ISBN fills the "create edition" draft.
let runningIsbnLookups = null;
let isbnLookupsNextAt = 0;
function scheduleIsbnLookups(catalogStore) {
  if (runningIsbnLookups || Date.now() < isbnLookupsNextAt || String(process.env.BOOKFLIP_DETAIL_ENRICHMENT ?? '1') === '0') return;
  if (!catalogStore.repository?.database) return;
  isbnLookupsNextAt = Date.now() + 2 * 60_000;
  const repository = catalogStore.repository;
  runningIsbnLookups = lookupUnknownIsbns(repository, { draftOf: (jobId) => offerEditionDraft(repository, jobId), limit: 2 })
    .then((report) => {
      if (report.paused) isbnLookupsNextAt = Date.now() + 30 * 60_000;
      if (report.checked) recordProgress({ type: 'isbn_lookups', ...report });
    })
    .catch((error) =>
      recordProgress({ type: 'isbn_lookups_error', code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'ISBN_LOOKUP_ERROR' }),
    )
    .finally(() => {
      runningIsbnLookups = null;
    });
}

// Set listings: their description is read (a few every three minutes, paced per source) and an
// empty set gets the books it names. A throttled or blocked source is left alone for half an hour.
let runningSetDescriptions = null;
let setDescriptionsNextAt = 0;
function scheduleSetDescriptions(catalogStore) {
  if (runningSetDescriptions || Date.now() < setDescriptionsNextAt || String(process.env.BOOKFLIP_DETAIL_ENRICHMENT ?? '1') === '0') return;
  if (!catalogStore.repository?.database) return;
  setDescriptionsNextAt = Date.now() + 3 * 60_000;
  runningSetDescriptions = fillSetsFromDescriptions(catalogStore.repository, { limit: 4 })
    .then((report) => {
      if (report.paused) setDescriptionsNextAt = Date.now() + 30 * 60_000;
      if (report.checked) recordProgress({ type: 'set_descriptions', ...report });
    })
    .catch((error) =>
      recordProgress({ type: 'set_descriptions_error', code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'SET_DESCRIPTION_ERROR' }),
    )
    .finally(() => {
      runningSetDescriptions = null;
    });
}

function scheduleLifecycleCheck(catalogStore) {
  if (runningLifecycle || Date.now() < lifecycleNextAt || String(process.env.BOOKFLIP_OFFER_LIFECYCLE ?? '1') === '0') return;
  if (!catalogStore.repository?.database) return;
  lifecycleNextAt = Date.now() + 10 * 60_000;
  runningLifecycle = checkOfferLifecycle(catalogStore.repository, { limit: 8 })
    .then((report) => {
      if (report.checked || report.errors) recordProgress({ type: 'offer_lifecycle', ...report });
    })
    .catch((error) =>
      recordProgress({ type: 'offer_lifecycle_error', code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'LIFECYCLE_ERROR' }),
    )
    .finally(() => {
      runningLifecycle = null;
    });
}

// Cycle and volume read from listing titles, recomputed every ten minutes (local SQL only).
let listingSeriesNextAt = 0;
function scheduleListingSeries(catalogStore) {
  if (Date.now() < listingSeriesNextAt || !catalogStore.repository?.database) return;
  listingSeriesNextAt = Date.now() + 10 * 60_000;
  try {
    const report = inferListingSeries(catalogStore.repository);
    if (report.works) recordProgress({ type: 'listing_series', ...report });
  } catch (error) {
    recordProgress({ type: 'listing_series_error', code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'LISTING_SERIES_ERROR' });
  }
}

// Editions created from listings: BN is asked again about once a week (a few per hour).
let runningOfferEditions = null;
let offerEditionsNextAt = 0;
function scheduleOfferEditionRecheck(catalogStore) {
  if (runningOfferEditions || Date.now() < offerEditionsNextAt || typeof catalogStore.lookupIsbn !== 'function') return;
  if (!catalogStore.repository?.database) return;
  offerEditionsNextAt = Date.now() + 60 * 60_000;
  runningOfferEditions = recheckOfferEditions(catalogStore, { limit: 5 })
    .then((report) => {
      if (report.checked) recordProgress({ type: 'offer_editions_recheck', ...report });
    })
    .catch((error) =>
      recordProgress({ type: 'offer_editions_recheck_error', code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'RECHECK_ERROR' }),
    )
    .finally(() => {
      runningOfferEditions = null;
    });
}

let runningCatalogResolution = null;
function scheduleCatalogResolution(catalogStore) {
  if (runningCatalogResolution) return runningCatalogResolution;
  const startedAt = performance.now();
  runningCatalogResolution = new Promise((resolve) => setImmediate(resolve))
    .then(() => enrichPendingOffers(catalogStore))
    .then(() => catalogStore.processQueued())
    .then((result) => {
      // Foreign editions found by this pass leave review at once while "Tylko polskie wydania" is on.
      if (catalogStore.repository?.database) rejectForeignEditions(catalogStore.repository);
      return result;
    })
    .then((result) => {
      // An idle poll every few seconds must not grow the log: record only real work.
      if (result.processed || result.failed)
        recordProgress({
          type: 'catalog_resolution',
          processed: result.processed,
          failed: result.failed || 0,
          durationMs: Math.round(performance.now() - startedAt),
        });
      return result;
    })
    .catch((error) => {
      recordProgress({
        type: 'catalog_resolution_error',
        code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'CATALOG_INTEGRATION_ERROR',
      });
      return null;
    })
    .finally(() => {
      runningCatalogResolution = null;
      scheduleProposalRefresh(catalogStore);
      scheduleLifecycleCheck(catalogStore);
      scheduleSetDescriptions(catalogStore);
      scheduleIsbnLookups(catalogStore);
      scheduleOfferEditionRecheck(catalogStore);
      scheduleListingSeries(catalogStore);
    });
  return runningCatalogResolution;
}

const sharedVintedDetailCache = createVintedDetailCache();
async function searchAndStore(
  input,
  onProgress = () => {},
  { catalogProvider = getProductionCatalog, search = searchOffers, signal = null, shouldAutoResolve = () => true } = {},
) {
  storageMode();
  const catalog = catalogProvider();
  if (!catalog) throw Error('SQLITE_STORAGE_REQUIRES_CATALOG');
  scanCancelled(signal);
  const detailCache = catalog.repository?.database
    ? createSqliteVintedDetailCache(catalog.repository)
    : sharedVintedDetailCache;
  // Offers of each finished source+query are saved at once and identification starts, so results
  // appear while the scan continues. The final save adds the scan summary and statistics.
  const scanAt = new Date();
  const scanState = createScanState();
  let savedDuringScan = 0;
  // Offers saved by finished tasks, so that a cancelled scan is still recorded as a (partial) run.
  const savedOffers = new Map();
  const onOffers = async ({ source, query, offers }) => {
    for (const offer of offers) {
      const known = savedOffers.get(offer.url);
      if (known) known.matchedQueries = [...new Set([...known.matchedQueries, ...offer.matchedQueries])];
      else savedOffers.set(offer.url, { ...offer, matchedQueries: [...offer.matchedQueries] });
    }
    const report = await withHistoryWriteLock(async () =>
      persistSqliteScanBatch(catalog, { offers, scanAt: scanAt.toISOString(), state: scanState }),
    );
    savedDuringScan += report.saved;
    onProgress({ type: 'offers-saved', source, query, saved: report.saved, newOffers: report.newOffers, total: savedDuringScan });
    if (String(process.env.BOOKFLIP_CATALOG_AUTO_RESOLVE ?? '1') !== '0' && shouldAutoResolve()) scheduleCatalogResolution(catalog);
  };
  let result;
  try {
    result = await awaitScan(search(input, { onProgress, detailCache, signal, onOffers, now: () => scanAt }), signal);
    scanCancelled(signal);
  } catch (error) {
    // Cancelled after some tasks finished: their offers are already saved; record the run too, so
    // that "review this scan" and the new-offer filters see them. Nothing is marked unseen, because
    // the scan did not finish.
    if (error?.message === 'SCAN_CANCELLED' && savedOffers.size)
      await withHistoryWriteLock(async () =>
        persistSqliteScan(catalog, { offers: [...savedOffers.values()], searchedAt: scanAt.toISOString(), errors: [], scanState,
          scanContext: { queries: input.queries, sources: input.sources, results: [], cancelled: true } }),
      ).catch(() => {});
    throw error;
  }
  const errors = result.results
    .filter((row) => row.status !== 'ok')
    .map((row) => ({
      source: row.source,
      query: row.query,
      code: row.diagnostic?.code || 'SOURCE_REQUEST_FAILED',
      // Lets "retry failed tasks" leave out bot checks and the tasks skipped after one.
      ...(row.diagnostic?.blocked ? { blocked: true } : {}),
      ...(row.diagnostic?.skipped ? { skipped: true } : {}),
      ...(row.diagnostic?.retryable === false ? { retryable: false } : {}),
    }));
  const saved = await withHistoryWriteLock(async () => {
    scanCancelled(signal);
    return persistSqliteScan(catalog, { offers: result.offers, searchedAt: result.searchedAt, errors, scanState,
      rejected: result.summary?.rejected,
      scanContext: { queries: input.queries, sources: input.sources, results: result.results, ...(result.mode ? { mode: result.mode } : {}) } });
  });
  if (String(process.env.BOOKFLIP_CATALOG_AUTO_RESOLVE ?? '1') !== '0' && shouldAutoResolve())
    scheduleCatalogResolution(catalog);
  return {
    ...result,
    offers: saved.offers,
    summary: { ...result.summary, ...saved.summary },
    history: saved.history,
    lastScan: saved.lastScan,
    catalog: { ingest: saved.ingest, resolution: { status: 'queued' } },
  };
}

export function createLocalAppServer({
  catalogProvider = getProductionCatalog,
  search = searchOffers,
  tailscaleAccess = tailscaleAccessFromEnv(),
  identificationControl = null,
} = {}) {
  storageMode();
  const getProductionCatalog = catalogProvider;
  let scanInFlight = false;
  let scanAbortController = null;
  let currentScan = null;
  // Every route of the local server, in the order they are tried (router.mjs). Handlers get the
  // request, the response, the parsed URL and the URL-decoded path parameters.
  const localRoutes = createRouter()
    .add('GET', '/api/image', async ({ request, response, url, params }) => {
      try {
        const image = await fetchCachedImage(url.searchParams.get('u'), {
          cacheDirectory: join(runtimeDataDirectory, 'image-cache'),
        });
        response.writeHead(200, {
          'Content-Type': image.type,
          'Cache-Control': 'private, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'",
        });
        return response.end(image.body);
      } catch (error) {
        return send(response, error.statusCode || 502, JSON.stringify({ error: error.message }));
      }
    })
    .add('GET', '/api/offers/:id/image', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const imageUrl = await offerImageUrl(catalog.repository, params.id);
      if (!imageUrl) return send(response, 404, JSON.stringify({ error: 'IMAGE_NOT_FOUND' }));
      response.writeHead(302, { Location: proxiedImage(imageUrl), 'Cache-Control': 'no-store' });
      return response.end();
    })
    .add('*', '/api/buyback/*', async ({ request, response, url, params }) => {
      const buyback = getBuyback();
      if (!buyback) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      if (request.method === 'GET' && url.pathname === '/api/buyback/quotes')
        return send(response, 200, JSON.stringify({ quotes: buyback.many((url.searchParams.get('isbn') || '').split(',').slice(0, 200)) }));
      if (request.method === 'GET' && url.pathname === '/api/buyback/batch')
        return send(response, 200, JSON.stringify(buyback.status()));
      if (request.method === 'POST' && url.pathname === '/api/buyback/batch')
        return send(response, 202, JSON.stringify(buyback.start()));
      if (request.method === 'PUT' && url.pathname === '/api/buyback/auto') {
        const input = await readJson(request);
        return send(response, 200, JSON.stringify(buyback.setAuto(input?.enabled === true)));
      }
      if (request.method === 'POST' && url.pathname === '/api/buyback/batch/cancel')
        return send(response, 202, JSON.stringify(buyback.cancel()));
      if (request.method === 'POST' && url.pathname === '/api/buyback/check') {
        const input = await readJson(request);
        try {
          return send(response, 200, JSON.stringify(await buyback.check(input?.isbn, { force: input?.force === true })));
        } catch (error) {
          return send(response, error.status || 502, JSON.stringify({ error: error.message }));
        }
      }
      return send(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
    })
    .add('*', '/api/images/backfill/*', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      imageBackfill ||= createImageBackfill(catalog.repository);
      if (request.method === 'GET' && url.pathname === '/api/images/backfill')
        return send(response, 200, JSON.stringify(imageBackfill.status()));
      if (request.method === 'POST')
        return send(response, 202, JSON.stringify(url.pathname.endsWith('/cancel') ? imageBackfill.cancel() : imageBackfill.start()));
      return send(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
    })
    // Smaller routes live in trading-api.mjs; its route table says which paths are its own.
    .add('GET', '/api/scan/diagnostics', async ({ request, response, url, params }) => {
      const scan = currentScan || await readScanStatus();
      return send(response, 200, JSON.stringify({ ...scan, progress: scanProgress(scan.diagnostics), telemetry: scanTelemetry(scan.diagnostics, { running: scan.status === 'running' }) }));
    })
    .add('GET', '/api/scan/status', async ({ request, response, url, params }) => {
      return send(response, 200, JSON.stringify(currentScan || await readScanStatus()));
    })
    .add('PUT', '/api/catalog/universe/:id', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const id = params.id;
      return send(response, 200, JSON.stringify(setWorkUniverse(catalog.repository, id, await readJson(request))));
    })
    // Catalogue seeding from BN: the list, a new seed, a seed's status, removing one.
    .add(['GET', 'POST'], '/api/catalog/seeds', async ({ request, response }) => {
      const catalog = getProductionCatalog();
      if (!catalog?.seeds) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      if (request.method === 'GET') return send(response, 200, JSON.stringify(catalog.seeds.list()));
      return send(response, 201, JSON.stringify(catalog.seeds.add(await readJson(request))));
    })
    .add(['PUT', 'DELETE'], '/api/catalog/seeds/:id', async ({ request, response, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog?.seeds) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      if (request.method === 'DELETE') return send(response, 200, JSON.stringify(catalog.seeds.remove(params.id)));
      return send(response, 200, JSON.stringify(catalog.seeds.setStatus(params.id, (await readJson(request))?.status)));
    })
    .add('GET', '/api/catalog/persons', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(response, 200, JSON.stringify({ items: catalogPersons(catalog.repository, { query: url.searchParams.get('q') || '', limit: url.searchParams.get('limit') || 200 }) }));
    })
    .add('GET', '/api/catalog/persons/:id', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(response, 200, JSON.stringify(personWorks(catalog.repository, params.id)));
    })
    .add('GET', '/api/catalog/series-tree', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(response, 200, JSON.stringify({ universes: catalogSeries(catalog.repository) }));
    })
    .add('*', '/api/catalog/series-definition', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      if (request.method === 'GET') return send(response, 200, JSON.stringify(getSeriesDefinition(catalog.repository, url.searchParams.get('name') || '')));
      if (request.method === 'PUT') return send(response, 200, JSON.stringify(saveSeriesDefinition(catalog.repository, await readJson(request))));
      return send(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
    })
    .add('GET', '/api/catalog/insights', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(response, 200, JSON.stringify(catalogInsights(catalog.repository)));
    })
    .add('GET', '/api/catalog/summary', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(response, 200, JSON.stringify(catalog.repository.counts()));
    })
    .add('GET', '/api/scan-profiles', async ({ request, response, url, params }) => {
      const catalog=getProductionCatalog();
      if (!catalog) return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));
      return send(response,200,JSON.stringify({items:listScanProfiles(catalog.repository)}));
    })
    .add('POST', '/api/scan-profiles/import', async ({ request, response, url, params }) => {
      const catalog=getProductionCatalog();
      if (!catalog) return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));
      const input=await readJson(request);
      return send(response,200,JSON.stringify(putScanProfile(catalog.repository,input?.name,input,{onlyIfAbsent:true})));
    })
    .add('POST', '/api/scan-profiles', async ({ request, response, url, params }) => {
      const catalog=getProductionCatalog();
      if (!catalog) return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));
      const input=await readJson(request);
      const result=putScanProfile(catalog.repository,input?.name,input,{onlyIfAbsent:true});
      return send(response,result.created?201:409,JSON.stringify(result.created?result:{error:'PROFILE_ALREADY_EXISTS'}));
    })
    .add(['PUT', 'DELETE'], '/api/scan-profiles/:name', async ({ request, response, url, params }) => {
      const catalog=getProductionCatalog();
      if (!catalog) return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));
      const name=params.name;
      if (request.method === 'DELETE')
        return send(response,200,JSON.stringify(deleteScanProfile(catalog.repository,name)));
      const input=await readJson(request);
      return send(response,200,JSON.stringify(putScanProfile(catalog.repository,name,input)));
    })
    .add('GET', '/api/sources', async ({ request, response, url, params }) => {
      return send(response, 200, JSON.stringify({ sources: Object.keys(localSourceHosts), blocked: (() => { try { const catalog = getProductionCatalog(); return catalog ? blockedSources(catalog.repository) : {}; } catch { return {}; } })() }));
    })
    .add('GET', '/api/history/brief', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(response, 200, JSON.stringify(historyBookLabels(catalog.repository)));
    })
    .add('GET', '/api/history', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) throw Error('SQLITE_HISTORY_REQUIRES_CATALOG');
      return send(response, 200, JSON.stringify(catalogHistorySnapshot(catalog.repository)));
    })
    .add('GET', '/api/book', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const bookId = url.searchParams.get('id');
      if (!bookId || bookId.length > 200)
        return send(response, 404, JSON.stringify({ error: 'BOOK_NOT_FOUND' }));
      const history = sqliteHistoryModel(catalog.repository, { bookId });
      const data = bookHistory(history, bookId);
      return data
        ? send(response, 200, JSON.stringify(data))
        : send(response, 404, JSON.stringify({ error: 'BOOK_NOT_FOUND' }));
    })
    .add('POST', '/api/catalog', async ({ request, response, url, params }) => {
      storageMode();
      const input = await readJson(request);
      const catalog = getProductionCatalog();
      if (!catalog) throw Error('SQLITE_STORAGE_REQUIRES_CATALOG');
      const created = await withHistoryWriteLock(async () => createSqliteBook(catalog, input));
      return send(
        response,
        created.created ? 201 : 200,
        JSON.stringify({
          book: created.book,
          editionId: created.editionId,
          catalog: url.searchParams.get('compact') === '1'
            ? historyBookLabels(catalog.repository)
            : catalogHistorySnapshot(catalog.repository),
          catalogSync: { mode: 'sqlite' },
        }),
      );
    })
    .add('POST', '/api/identification/control', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog || !identificationControl) return send(response, 503, JSON.stringify({ error: 'IDENTIFICATION_UNAVAILABLE' }));
      const { action, retryUnresolved = false } = await readJson(request);
      let retried = null;
      if (action === 'start') {
        if (retryUnresolved)
          retried = retryIdentificationJobs(catalog.repository, 'unresolved');
        const startedAt = new Date().toISOString();
        catalog.beginIdentificationRun(startedAt);
        identificationControl.start({ newRun: true, startedAt });
        void identificationControl.tick();
      }
      else if (action === 'stop') identificationControl.pause();
      else return send(response, 400, JSON.stringify({ error: 'INVALID_IDENTIFICATION_ACTION' }));
      return send(response, 200, JSON.stringify({ ...identificationControl.status(), retried }));
    })
    .add('GET', '/api/catalog/status', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      const scheduler = identificationControl?.status() ?? { available: false };
      return send(response, 200, JSON.stringify(catalog ? { ...catalog.status({ runStartedAt: scheduler.runStartedAt }), scheduler } : { enabled: false }));
    })
    .add('GET', '/api/catalog/series', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(response, 200, JSON.stringify({ items: listWorkSeries(catalog.repository) }));
    })
    .add('PUT', '/api/catalog/series/:id', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const id = params.id;
      const data = await readJson(request);
      return send(response, 200, JSON.stringify(updateWorkSeries(catalog.repository, id, data)));
    })
    .add('GET', '/api/catalog/works', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(
        response,
        200,
        JSON.stringify(
          listCatalogWorks(catalog.repository, Object.fromEntries(url.searchParams)),
        ),
      );
    })
    // Prices of a book over all its editions, and its price variants.
    .add('GET', '/api/catalog/works/:id/prices', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const data = workPriceOverview(catalog.repository, params.id);
      return data ? send(response, 200, JSON.stringify(data)) : send(response, 404, JSON.stringify({ error: 'WORK_NOT_FOUND' }));
    })
    .add('POST', '/api/catalog/works/:id/variants/merge', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const input = await readJson(request);
      return send(response, 200, JSON.stringify(mergeVariants(catalog.repository, params.id, String(input?.from ?? ''), String(input?.to ?? ''))));
    })
    .add('PUT', '/api/catalog/editions/:id/variant', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const input = await readJson(request);
      return send(response, 200, JSON.stringify(setEditionVariant(catalog.repository, params.id, input?.variantKey ?? null)));
    })
    .add('GET', '/api/catalog/works/:id', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog(),
        id = params.id;
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const data = getCatalogWork(catalog.repository, id);
      return data
        ? send(response, 200, JSON.stringify(data))
        : send(response, 404, JSON.stringify({ error: 'WORK_NOT_FOUND' }));
    })
    .add('GET', '/api/catalog/editions/:id', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog(),
        id = params.id;
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const data = getCatalogEdition(catalog.repository, id);
      return data
        ? send(response, 200, JSON.stringify(data))
        : send(response, 404, JSON.stringify({ error: 'EDITION_NOT_FOUND' }));
    })
    .add('GET', '/api/offer-workspace', async ({ request, response, url, params }) => {
      const catalog=getProductionCatalog();
      if (!catalog) return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));
      return send(response,200,JSON.stringify({items:listOfferWorkspace(catalog.repository)}));
    })
    .add('POST', '/api/offer-workspace/import', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error:'CATALOG_DISABLED' }));
      const input = await readJson(request);
      return send(response, 200, JSON.stringify(importOfferWorkspace(catalog.repository, input?.entries)));
    })
    .add('PUT', '/api/offer-workspace/:id', async ({ request, response, url, params }) => {
      const catalog=getProductionCatalog();
      if (!catalog) return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));
      const id=params.id;
      const input=await readJson(request);
      return send(response,200,JSON.stringify(setOfferWorkspace(catalog.repository,id,input)));
    })
    // Oferty → "Wg książki": one row per edition with its listings' count and price range.
    .add('GET', '/api/offer-groups', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(response, 200, JSON.stringify(listCatalogOfferGroups(catalog.repository, Object.fromEntries(url.searchParams))));
    })
    .add('GET', '/api/offers', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(
        response,
        200,
        JSON.stringify(
          listCatalogOffers(catalog.repository, Object.fromEntries(url.searchParams)),
        ),
      );
    })
    // Operator changes or removes an offer's edition (catalogue and offer panel).
    .add(['PUT', 'DELETE'], '/api/offers/:id/assignment', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const offerId = params.id;
      const input = await readJson(request);
      // A book without a named edition: the edition the listing points at, or its unknown edition.
      const editionId = request.method === 'PUT' && !input?.editionId && input?.workId
        ? catalog.repository.transaction(() => editionForWorkAssignment(catalog.repository, String(input.workId), offerId).editionId)
        : input?.editionId;
      const result = request.method === 'PUT'
        ? reassignOffer(catalog.repository, offerId, editionId, { reason: typeof input?.reason === 'string' ? input.reason.slice(0, 300) : null })
        : unassignOffer(catalog.repository, offerId, { reason: typeof input?.reason === 'string' ? input.reason.slice(0, 300) : null });
      return send(response, 200, JSON.stringify(result));
    })
    .add('GET', '/api/offers/:id', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog(),
        id = params.id;
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const data = getCatalogOffer(catalog.repository, id);
      return data
        ? send(response, 200, JSON.stringify(data))
        : send(response, 404, JSON.stringify({ error: 'OFFER_NOT_FOUND' }));
    })
    .add('POST', '/api/identification/retry', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const input = await readJson(request);
      const result = retryIdentificationJobs(catalog.repository, input?.mode);
      if (result.queued > 0 && identificationControl) {
        identificationControl.start();
        void identificationControl.tick();
      }
      return send(response, 200, JSON.stringify(result));
    })
    .add('GET', '/api/sets', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(response, 200, JSON.stringify({ items: listOfferSets(catalog.repository) }));
    })
    .add('POST', '/api/sets', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const input = await readJson(request);
      if (typeof input?.offerId !== 'string' || !input.offerId.trim()) return send(response, 400, JSON.stringify({ error:'INVALID_OFFER_ID' }));
      return send(response, 200, JSON.stringify(markOfferAsSet(catalog.repository, input.offerId)));
    })
    // GET: suggestions from the listing title; POST {text}: books named in a pasted description.
    .add(['GET', 'POST'], '/api/sets/:offerId/candidates', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const input = request.method === 'POST' ? await readJson(request) : {};
      const text = typeof input?.text === 'string' ? input.text.slice(0, 20000) : '';
      return send(response, 200, JSON.stringify(setCandidates(catalog.repository, params.offerId, { text })));
    })
    .add('GET', '/api/sets-cycle-volumes', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(response, 200, JSON.stringify(cycleVolumeEditions(catalog.repository, url.searchParams.get('name') || '', url.searchParams.get('from'), url.searchParams.get('to'))));
    })
    // A set's books: add one, remove one; or unmark the set. (The path used to be split by hand:
    // counted with the leading "/api/sets", adding a book, removing one and unmarking never matched.)
    .add('POST', '/api/sets/:offerId/editions', async ({ request, response, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const input = await readJson(request);
      if (typeof input?.editionId !== 'string' || !input.editionId.trim()) return send(response, 400, JSON.stringify({ error:'INVALID_EDITION_ID' }));
      return send(response, 200, JSON.stringify(updateSetEdition(catalog.repository, params.offerId, input.editionId, true)));
    })
    .add('DELETE', '/api/sets/:offerId/editions/:editionId', async ({ response, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(response, 200, JSON.stringify(updateSetEdition(catalog.repository, params.offerId, params.editionId, false)));
    })
    .add('DELETE', '/api/sets/:offerId', async ({ response, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(response, 200, JSON.stringify(unmarkOfferSet(catalog.repository, params.offerId)));
    })
    .add('GET', '/api/identification-jobs', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      return send(
        response,
        200,
        JSON.stringify(
          listIdentificationJobs(catalog.repository, Object.fromEntries(url.searchParams)),
        ),
      );
    })
    // "Szybkie" tab: the sure decisions to look through, then apply the ones the operator kept.
    .add('POST', '/api/identification-jobs/sure-plan', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const input = await readJson(request);
      const jobIds = Array.isArray(input?.jobIds) ? input.jobIds.map(String).slice(0, 2000) : null;
      return send(response, 200, JSON.stringify(sureReviewPlan(catalog.repository, { jobIds })));
    })
    .add('POST', '/api/identification-jobs/sure-apply', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const input = await readJson(request);
      const result = await applySureReviewPlan(catalog, Array.isArray(input?.items) ? input.items : []);
      // Approvals add ISBNs to the catalogue: the sibling offers with them are matched next.
      if (result.approved && identificationControl) {
        identificationControl.start();
        void identificationControl.tick();
      }
      return send(response, 200, JSON.stringify(result));
    })
    // ISBN that no source knows: a draft built from the listings, then the edition in one click.
    .add(['GET', 'POST'], '/api/identification-jobs/:id/offer-edition', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const jobId = params.id;
      if (request.method === 'GET') return send(response, 200, JSON.stringify(offerEditionDraft(catalog.repository, jobId)));
      const result = createEditionFromOffer(catalog.repository, jobId, await readJson(request));
      if (identificationControl) {
        identificationControl.start();
        void identificationControl.tick();
      }
      return send(response, 200, JSON.stringify(result));
    })
    .add('POST', '/api/identification-jobs/:id/decision', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog(),
        id = params.id;
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const input = await readJson(request);
      const result = decideIdentificationJob(catalog.repository, id, input);
      if (input.action === 'requeued' && identificationControl) {
        identificationControl.start();
        void identificationControl.tick();
      }
      return send(
        response,
        200,
        JSON.stringify(result),
      );
    })
    .add('GET', '/api/identification-jobs/:id/local-candidates', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const job = catalog.repository.database
        .prepare('SELECT o.id AS offer_id, o.original_title FROM identification_jobs j JOIN offers o ON o.id=j.offer_id WHERE j.id=?')
        .get(params.id);
      if (!job) return send(response, 404, JSON.stringify({ error: 'REVIEW_JOB_NOT_FOUND' }));
      return send(response, 200, JSON.stringify({ items: localWorkCandidates(catalog.repository, job.original_title, { offerId: job.offer_id }) }));
    })
    .add(['GET', 'POST'], '/api/identification-jobs/:id/proposals', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const id = params.id;
      const job = catalog.repository.database
        .prepare(
          "SELECT j.id,j.offer_id,o.original_title,o.observed_isbn FROM identification_jobs j JOIN offers o ON o.id=j.offer_id WHERE j.id=? AND j.status='review_required'",
        )
        .get(id);
      if (!job) return send(response, 404, JSON.stringify({ error: 'REVIEW_JOB_NOT_FOUND' }));
      // GET reads the stored proposal and computes one when missing; POST forces a fresh lookup.
      const stored = request.method === 'GET' ? loadProposal(catalog.repository, id) : null;
      if (stored) return send(response, 200, JSON.stringify(stored));
      const fresh = await computeProposal(catalog, job);
      return send(
        response,
        200,
        JSON.stringify({ jobId: id, queries: fresh.queries, candidates: fresh.candidates, confidence: fresh.confidence, unavailable: fresh.unavailable }),
      );
    })
    .add('POST', '/api/identification-jobs/:id/find-isbn', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const id = params.id;
      const job = catalog.repository.database.prepare(
        "SELECT j.id,o.original_title FROM identification_jobs j JOIN offers o ON o.id=j.offer_id WHERE j.id=? AND j.status='review_required'",
      ).get(id);
      if (!job) return send(response, 404, JSON.stringify({ error: 'REVIEW_JOB_NOT_FOUND' }));
      const input = await readJson(request);
      return send(response, 200, JSON.stringify(
        await catalog.findIsbnsByTitle(input?.title || job.original_title),
      ));
    })
    .add('POST', '/api/identification-jobs/:id/match-isbn', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const id = params.id;
      const input = await readJson(request);
      return send(
        response,
        200,
        JSON.stringify(await matchIdentificationJobByIsbn(catalog, id, input)),
      );
    })
    .add('POST', '/api/catalog/isbn-check', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const raw = (await readJson(request)).isbn;
      const isbn = normalizeISBN(raw);
      if (!isbn) return send(response, 400, JSON.stringify({ error: 'INVALID_ISBN' }));
      const edition = catalog.repository.findEditionByISBN(isbn);
      return send(response, 200, JSON.stringify({
        isbn, found: Boolean(edition),
        edition: edition ? { id: edition.id, title: edition.title, workId: edition.work_id, workTitle: edition.work_title } : null,
      }));
    })
    .add('POST', '/api/catalog/lookup-preview', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const isbn = normalizeISBN((await readJson(request))?.isbn);
      if (!isbn) return send(response, 400, JSON.stringify({ error: 'INVALID_ISBN' }));
      return send(
        response,
        200,
        JSON.stringify(await catalog.lookupIsbn(isbn)),
      );
    })
    .add('POST', '/api/catalog/lookup-confirm', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      const isbn = normalizeISBN((await readJson(request))?.isbn);
      if (!isbn) return send(response, 400, JSON.stringify({ error: 'INVALID_ISBN' }));
      const result = await catalog.resolveIsbn(isbn);
      return send(
        response,
        ['created_edition', 'created_work_and_edition', 'matched_existing'].includes(
          result.decision,
        )
          ? 200
          : 409,
        JSON.stringify(result),
      );
    })
    .add('POST', '/api/catalog/link', async ({ request, response, url, params }) => {
      storageMode();
      const input = await readJson(request);
      const catalog = getProductionCatalog();
      if (!catalog) throw Error('SQLITE_STORAGE_REQUIRES_CATALOG');
      await withHistoryWriteLock(async () => linkSqliteOffer(catalog, input, { returnHistory: false }));
      return send(response, 200, JSON.stringify(catalogHistorySnapshot(catalog.repository)));
    })
    .add('POST', '/api/search/cancel', async ({ request, response, url, params }) => {
      if (!scanInFlight || !scanAbortController || scanAbortController.signal.aborted)
        return send(response, 409, JSON.stringify({ error: 'NO_ACTIVE_SCAN' }));
      scanAbortController.abort();
      return send(response, 202, JSON.stringify({ status: 'cancelling' }));
    })
    .add('POST', '/api/search', async ({ request, response, url, params }) => {
      if (scanInFlight)
        return send(response, 409, JSON.stringify({ error: 'SCAN_ALREADY_RUNNING' }));
      scanInFlight = true;
      let scanStarted = false;
      try {
        const scanInput = validateSearchInput(await readJson(request));
        // "Tylko polskie wydania" (scanner form, saved in the database; scheduled scans use it too).
        try { const store = getProductionCatalog(); if (store?.repository) scanInput.polishOnly = getPolishOnly(store.repository); } catch {}
        scanStarted = true;
        scanAbortController = new AbortController();
        currentScan = { status: 'running', startedAt: new Date().toISOString(),
          diagnostics: createScanDiagnostics({ queries: scanInput.queries || [], sources: scanInput.sources || [], tasks: scanInput.tasks || null }) };
        await persistScanStatus(currentScan);
        if (url.searchParams.get('stream') === '1') {
          streamHeaders(response);
          const emit = (event) => {
            const safe = recordProgress(event);
            addScanEvent(currentScan.diagnostics, safe);
            if (!response.destroyed) response.write(JSON.stringify({ type: 'progress', event: safe }) + '\n');
          };
          try {
            const result = await searchAndStore(scanInput, emit, {
              catalogProvider,
              search,
              signal: scanAbortController.signal,
              shouldAutoResolve: () => identificationControl?.status().running ?? true,
            });
            currentScan = { ...currentScan, status: 'completed', finishedAt: new Date().toISOString(), summary: { ...result.summary, scanAt: result.lastScan?.at ?? null } };
            await persistScanStatus(currentScan);
            if (!response.destroyed) response.write(JSON.stringify({ type: 'result', result }) + '\n');
            if (!response.destroyed) response.end();
          } catch (error) {
            currentScan = { ...currentScan, status: error.message === 'SCAN_CANCELLED' ? 'cancelled' : 'failed', finishedAt: new Date().toISOString() };
            await persistScanStatus(currentScan);
            if (!response.destroyed) response.write(
              JSON.stringify({
                type: 'error',
                error: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_APP_ERROR',
              }) + '\n',
            );
            if (!response.destroyed) response.end();
          }
          return;
        }
        const result = await searchAndStore(scanInput, (event) => addScanEvent(currentScan.diagnostics, recordProgress(event)), {
          catalogProvider,
          search,
          signal: scanAbortController.signal,
          shouldAutoResolve: () => identificationControl?.status().running ?? true,
        });
        currentScan = { ...currentScan, status: 'completed', finishedAt: new Date().toISOString(), summary: { ...result.summary, scanAt: result.lastScan?.at ?? null } };
        await persistScanStatus(currentScan);
        return send(response, 200, JSON.stringify(result));
      } catch (error) {
        if (scanStarted) {
          currentScan = { ...currentScan, status: error.message === 'SCAN_CANCELLED' ? 'cancelled' : 'failed', finishedAt: new Date().toISOString() };
          await persistScanStatus(currentScan);
        }
        throw error;
      } finally {
        scanAbortController = null;
        scanInFlight = false;
      }
    })
  ;
  const server = createServer(async (request, response) => {
    try {
      const rejected = validateBookflipRequest(request, tailscaleAccess);
      if (rejected)
        return send(response, rejected.status, JSON.stringify({ error: rejected.error }));
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      // Smaller routes live in trading-api.mjs; its route table says which paths are its own.
      const tradingMatch = tradingRoutes.match(request.method, url.pathname);
      if (tradingMatch?.handler) {
        const catalog = getProductionCatalog();
        if (!catalog) return send(response,503,JSON.stringify({error:'CATALOG_DISABLED'}));
        const input = ['PUT','POST'].includes(request.method) ? await readJson(request) : null;
        const data = await tradingMatch.handler({ repo: catalog.repository, method: request.method, input, params: tradingMatch.params });
        return send(response,200,JSON.stringify(data ?? null));
      }
      const route = localRoutes.match(request.method, url.pathname);
      if (route?.handler) {
        const handled = await route.handler({ request, response, url, params: route.params });
        if (handled !== undefined || response.writableEnded) return handled;
      }
      if (request.method !== 'GET')
        return send(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
      const file = publicAssetPath(url.pathname);
      if (!file) return send(response, 404, 'Nie znaleziono', 'text/plain; charset=utf-8');
      const root = await realpath(appDirectory);
      let requested;
      try {
        requested = await realpath(join(root, file));
      } catch (error) {
        if (error.code === 'ENOENT') return send(response, 404, 'Nie znaleziono', 'text/plain; charset=utf-8');
        throw error;
      }
      if (!requested.startsWith(root + sep))
        return send(response, 404, 'Nie znaleziono', 'text/plain; charset=utf-8');
      const body = await readFile(requested);
      return send(response, 200, body, contentTypes[extname(file)] || 'application/octet-stream');
    } catch (error) {
      send(
        response,
        error.statusCode || 500,
        JSON.stringify({
          error: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_APP_ERROR',
        }),
      );
    }
  });
  server.on('close', () => {
    if (productionCatalog) {
      productionCatalog.close();
      productionCatalog = null;
    }
  });
  return server;
}

function openLocalApp(url) {
  if (process.platform === 'win32' && !process.argv.includes('--no-open'))
    spawn('cmd.exe', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
}
async function main() {
  const port = Number(process.env.BOOKFLIP_LOCAL_PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('INVALID_PORT');
  const url = `http://127.0.0.1:${port}`;
  const enabled = String(process.env.BOOKFLIP_CATALOG_AUTO_RESOLVE ?? '1') !== '0';
  const intervalMs = Number(process.env.BOOKFLIP_IDENTIFICATION_POLL_MS ?? 5_000);
  const scheduler = createIdentificationScheduler({
    runBatch: () => {
      const catalog = getProductionCatalog();
      return catalog ? scheduleCatalogResolution(catalog) : null;
    },
    intervalMs,
    onError: (error) => recordProgress({
      type: 'catalog_scheduler_error',
      code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'CATALOG_INTEGRATION_ERROR',
    }),
  });
  const server = createLocalAppServer({ identificationControl: scheduler });
  // Recurring scans of the saved profile (off until the user enables it in the Scanner view).
  const scanScheduler = createScanScheduler({
    getRepository: () => getProductionCatalog()?.repository ?? null,
    runScan: localScanRunner(port),
    onEvent: (event) => recordProgress(event),
  });
  // Daily integrity-checked copy of the catalogue (newest seven kept; BOOKFLIP_BACKUP_DIR for a second disk).
  const autoBackup = createAutoBackupScheduler({
    getPath: () => getProductionCatalog()?.repository?.path ?? null,
    onEvent: (event) => recordProgress(event),
  });
  server.on('close', () => { void scheduler.stop(); scanScheduler.stop(); buyback?.stopAuto(); productionCatalog?.seeds?.stop(); autoBackup.stop(); });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`BookFlip Scanner już działa pod adresem ${url}`);
      openLocalApp(url);
      process.exitCode = 0;
      return;
    }
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    if (enabled) scheduler.start();
    try {
      const catalog = getProductionCatalog();
      if (catalog) {
        rescoreStoredProposals(catalog.repository);
        repairCatalogTitles(catalog.repository);
      }
    } catch (error) {
      console.error('Przeliczenie propozycji: ' + error.message);
    }
    if (String(process.env.BOOKFLIP_SCHEDULED_SCANS ?? '1') !== '0') scanScheduler.start();
    if (String(process.env.BOOKFLIP_BUYBACK_AUTO ?? '1') !== '0') getBuyback()?.startAuto();
    if (String(process.env.BOOKFLIP_CATALOG_SEEDS ?? '1') !== '0') getProductionCatalog()?.seeds?.start();
    if (String(process.env.BOOKFLIP_AUTO_BACKUP ?? '1') !== '0') autoBackup.start();
    console.log(`BookFlip Scanner działa: ${url}`);
    openLocalApp(url);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
