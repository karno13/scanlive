// The scan itself: validates the request, reads every source and query through the marketplace
// adapters (with retries, paging and the Vinted language check) and saves the offers of each
// finished task to SQLite while the scan continues.
import { createSqliteVintedDetailCache } from './vinted-detail-sqlite-cache.mjs';
import { scannableSources } from './source-blocks.mjs';
import { scanCancelled, awaitScan } from './scan-cancellation.mjs';
import { createVintedDetailCache } from './vinted-detail-cache.mjs';
import { setTimeout as wait } from 'node:timers/promises';
import { NEWEST_ORDER_SOURCES, scanMarketplace } from './marketplaces.mjs';
import { localSourceHosts } from './local-scan.mjs';
import { ANTIQUARIAN_SOURCES, isCategorySource } from './antiquarian-sources.mjs';
import { matchesTopic } from './search-policy.mjs';
import { completeResults } from './offer-availability.mjs';
import { readVintedLanguage } from './vinted-detail.mjs';
import { listedAtFromAge } from './offer-observations.mjs';
import {
  storageMode,
  persistSqliteScan,
  createScanState,
  persistSqliteScanBatch,
} from './sqlite-single-store.mjs';
import { getProductionCatalog, withHistoryWriteLock } from './app-runtime.mjs';
import { scheduleCatalogResolution } from './background-jobs.mjs';

export function validateSearchInput(input) {
  const queries = [
    ...new Set(
      (Array.isArray(input?.queries) ? input.queries : [])
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];
  const requested = [...new Set((Array.isArray(input?.sources) ? input.sources : []).map(String))];
  if (!queries.length || queries.length > 10 || queries.some((query) => query.length > 120))
    throw Object.assign(Error('INVALID_QUERIES'), { statusCode: 400 });
  if (
    !requested.length ||
    requested.length > Object.keys(localSourceHosts).length ||
    requested.some((source) => !localSourceHosts[source])
  )
    throw Object.assign(Error('INVALID_SOURCES'), { statusCode: 400 });
  // Allegro and OLX are never scanned (no legal access, source-blocks.mjs); a scan that names only
  // them is refused like an unknown source.
  const sources = scannableSources(requested);
  if (!sources.length) throw Object.assign(Error('INVALID_SOURCES'), { statusCode: 400 });
  if (input?.tasks !== undefined) {
    if (
      !Array.isArray(input.tasks) ||
      !input.tasks.length ||
      input.tasks.length > 70 ||
      input.tasks.some((task) => !queries.includes(task?.query) || !sources.includes(task?.source))
    )
      throw Object.assign(Error('INVALID_SCAN_TASKS'), { statusCode: 400 });
    const tasks = [
      ...new Map(
        input.tasks.map((task) => [
          JSON.stringify([task.source, task.query]),
          { source: task.source, query: task.query },
        ]),
      ).values(),
    ];
    return { queries, sources, tasks, ...newestMode(input, sources) };
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
  const suggested =
    retryAfter === null || retryAfter === undefined ? NaN : Number(retryAfter) * 1000;
  if (Number.isFinite(suggested) && suggested >= 0)
    return Math.min(24 * 60 * 60 * 1000, Math.max(1000, suggested));
  // A rate limit without Retry-After clears in tens of seconds, not in one or two.
  if (error?.status === 429) return 30000 * attempt;
  return Math.min(30000, Math.max(1000, 1000 * 2 ** (attempt - 1)));
}
async function retryRead(
  read,
  { onProgress = () => {}, waiter = wait, context = {}, signal = null } = {},
) {
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
    // Antiquarian source+phrase pairs read completely in the last hours (freshCategoryTasks).
    freshTasks = new Set(),
  } = {},
) {
  const { queries, sources, tasks, mode } = validateSearchInput(input),
    newest = mode === 'newest',
    results = [],
    languageCache = detailCache;
  await Promise.all(
    sources.map(async (source) => {
      if (isCategorySource(source)) {
        // Category pages hold no newest-first order: a quick scan leaves these shops out.
        if (newest) return;
        const wanted = queries.filter(
          (query) => !tasks || tasks.some((task) => task.source === source && task.query === query),
        );
        results.push(
          ...(await readCategorySource(source, wanted, {
            language: input?.polishOnly === false ? null : 'pl',
            fresh: (query) => freshTasks.has(categoryTaskKey(source, query)),
            scanner,
            onProgress,
            retryWait,
            signal,
            onOffers,
          })),
        );
        return;
      }
      // A source that blocked automated requests (CAPTCHA, 403) blocks the rest of this scan too:
      // its remaining phrases are reported at once instead of being asked and retried one by one.
      let blockedBy = null;
      for (const query of queries) {
        if (tasks && !tasks.some((task) => task.source === source && task.query === query))
          continue;
        if (newest && !NEWEST_ORDER_SOURCES.has(source)) continue;
        scanCancelled(signal);
        if (blockedBy) {
          onProgress({ type: 'source-error', source, query, code: blockedBy.code, partial: 0 });
          results.push({
            source,
            query,
            status: 'unavailable',
            offers: [],
            diagnostic: { ...blockedBy, skipped: true },
          });
          onProgress({
            type: 'source-done',
            source,
            query,
            offers: 0,
            pages: 0,
            status: 'unavailable',
          });
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
            for (const [reason, count] of Object.entries(filtered.rejected))
              rejected[reason] = (rejected[reason] || 0) + count;
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
            await onOffers({
              source,
              query,
              offers: offers.map((offer) => ({ ...offer, source, matchedQueries: [query] })),
            });
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
          onProgress({
            type: 'source-done',
            source,
            query,
            offers: 0,
            pages: 0,
            status: 'unavailable',
          });
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
    for (const [reason, count] of Object.entries(row.rejected || {}))
      rejected[reason] = (rejected[reason] || 0) + count;
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
async function scanAllPages(
  task,
  scanner,
  onProgress = () => {},
  waiter = wait,
  signal = null,
  maxPages = 50,
) {
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
    const read = await retryRead(() => scanner(current, { signal }), {
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
    for (const [reason, count] of Object.entries(scan.rejected || {}))
      rejected[reason] = (rejected[reason] || 0) + count;
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
    // A category page names the address of the next one (antiquarian-sources.mjs).
    current = {
      ...current,
      page: next,
      ...(scan.pagination.nextUrl ? { pageUrl: scan.pagination.nextUrl } : {}),
    };
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
// Antiquarian bookshops: a whole category is read once per scan (a few hundred listings, page by
// page through the gate) and matched against each phrase afterwards. A phrase whose category read
// finished within CATEGORY_READ_HOURS is not read again: small shops, ~250 pages for all five.
export const CATEGORY_READ_HOURS = 20;
const CATEGORY_LABEL = 'cała kategoria';
const categoryTaskKey = (source, query) => JSON.stringify([source, query]);

/** Source+phrase pairs of antiquarian bookshops read to the end in the last `hours`. */
export function freshCategoryTasks(repository, now = new Date(), hours = CATEGORY_READ_HOURS) {
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const keys = new Set();
  for (const row of repository.database
    .prepare('SELECT summary_json FROM scan_runs WHERE scanned_at>=?')
    .all(since)) {
    let results;
    try {
      results = JSON.parse(row.summary_json)?.context?.results;
    } catch {
      continue;
    }
    for (const result of completeResults(Array.isArray(results) ? results : []))
      if (isCategorySource(result.source)) keys.add(categoryTaskKey(result.source, result.query));
  }
  return keys;
}

async function readCategorySource(
  source,
  queries,
  { language, fresh, scanner, onProgress, retryWait, signal, onOffers },
) {
  const due = queries.filter((query) => !fresh(query));
  for (const query of queries)
    if (fresh(query))
      onProgress({ type: 'source-done', source, query, offers: 0, pages: 0, status: 'fresh' });
  if (!due.length) return [];
  onProgress({ type: 'source-start', source, query: CATEGORY_LABEL });
  const offers = new Map(),
    pages = [],
    rejected = {};
  let diagnostic = null,
    complete = true;
  for (const categoryUrl of ANTIQUARIAN_SOURCES[source].categories) {
    scanCancelled(signal);
    const scan = await scanAllPages(
      {
        source,
        host: localSourceHosts[source],
        mode: 'category',
        categoryUrl,
        language,
        page: 1,
        paginationVersion: 1,
      },
      scanner,
      (event) => onProgress({ ...event, source, query: CATEGORY_LABEL }),
      retryWait,
      signal,
      300,
    );
    for (const offer of scan.offers) if (!offers.has(offer.url)) offers.set(offer.url, offer);
    pages.push(...scan.pages);
    for (const [reason, count] of Object.entries(scan.rejected || {}))
      rejected[reason] = (rejected[reason] || 0) + count;
    if (scan.pagination?.state !== 'end') complete = false;
    if (scan.diagnostic) {
      diagnostic ||= scan.diagnostic;
      if (scan.diagnostic.blocked) break;
    }
  }
  const listed = [...offers.values()],
    matched = new Set(),
    results = [];
  for (const query of due) {
    const topic = { mode: 'discovery', title: query, category: query, searchQuery: query };
    const found = listed.filter((offer) => matchesTopic(topic, offer.title));
    for (const offer of found) matched.add(offer.url);
    const status = diagnostic ? (found.length ? 'partial' : 'unavailable') : 'ok';
    results.push({
      source,
      query,
      status,
      offers: found,
      // Only a category read to its last page may conclude that an offer is gone.
      pagination: { state: complete && !diagnostic ? 'end' : 'partial' },
      pages,
      ...(diagnostic ? { diagnostic } : {}),
    });
    if (diagnostic)
      onProgress({
        type: 'source-error',
        source,
        query,
        code: diagnostic.code,
        partial: found.length,
      });
    if (onOffers && found.length) {
      scanCancelled(signal);
      await onOffers({
        source,
        query,
        offers: found.map((offer) => ({ ...offer, source, matchedQueries: [query] })),
      });
    }
    onProgress({
      type: 'source-done',
      source,
      query,
      offers: found.length,
      pages: pages.length,
      status,
    });
  }
  // Books of the category that no phrase names: counted once, on the first phrase.
  const unmatched = listed.length - matched.size;
  if (unmatched) rejected.topic = (rejected.topic || 0) + unmatched;
  if (results.length && Object.keys(rejected).length) results[0].rejected = rejected;
  return results;
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
  let next = 0,
    checked = 0,
    unknown = 0,
    cached = 0,
    foreign = 0;
  let diagnostic = null,
    stopped = false,
    lastRequestAt = 0;
  let startGate = Promise.resolve();

  async function startDetailRead(url, index) {
    let release;
    const previous = startGate;
    startGate = new Promise((resolve) => {
      release = resolve;
    });
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
    const read = await retryRead(() => languageReader(url, { signal }), {
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
  if (typeof detail.description === 'string' && detail.description)
    out.listingDescription = detail.description.slice(0, 8000);
  for (const field of ['conditionText', 'listedAtText', 'photoCount', 'favouriteCount', 'sellerId'])
    if (detail[field] != null) out[field] = detail[field];
  if (detail.listedAtText) {
    const listedAt = listedAtFromAge(detail.listedAtText, now);
    if (listedAt) out.listedAt = listedAt;
  }
  if (detail.rawDetail) out.rawDetail = detail.rawDetail;
  return out;
}

const sharedVintedDetailCache = createVintedDetailCache();
export async function searchAndStore(
  input,
  onProgress = () => {},
  {
    catalogProvider = getProductionCatalog,
    search = searchOffers,
    signal = null,
    shouldAutoResolve = () => true,
  } = {},
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
  const startedMs = Date.now();
  const scanState = createScanState();
  let savedDuringScan = 0;
  // Offers saved by finished tasks, so that a cancelled scan is still recorded as a (partial) run.
  const savedOffers = new Map();
  const onOffers = async ({ source, query, offers }) => {
    for (const offer of offers) {
      const known = savedOffers.get(offer.url);
      if (known)
        known.matchedQueries = [...new Set([...known.matchedQueries, ...offer.matchedQueries])];
      else savedOffers.set(offer.url, { ...offer, matchedQueries: [...offer.matchedQueries] });
    }
    const report = await withHistoryWriteLock(async () =>
      persistSqliteScanBatch(catalog, { offers, scanAt: scanAt.toISOString(), state: scanState }),
    );
    savedDuringScan += report.saved;
    onProgress({
      type: 'offers-saved',
      source,
      query,
      saved: report.saved,
      newOffers: report.newOffers,
      total: savedDuringScan,
    });
    if (String(process.env.BOOKFLIP_CATALOG_AUTO_RESOLVE ?? '1') !== '0' && shouldAutoResolve())
      scheduleCatalogResolution(catalog);
  };
  let result;
  try {
    result = await awaitScan(
      search(input, {
        onProgress,
        detailCache,
        signal,
        onOffers,
        now: () => scanAt,
        freshTasks: catalog.repository?.database
          ? freshCategoryTasks(catalog.repository, scanAt)
          : new Set(),
      }),
      signal,
    );
    scanCancelled(signal);
  } catch (error) {
    // Cancelled after some tasks finished: their offers are already saved; record the run too, so
    // that "review this scan" and the new-offer filters see them. Nothing is marked unseen, because
    // the scan did not finish.
    if (error?.message === 'SCAN_CANCELLED' && savedOffers.size)
      await withHistoryWriteLock(async () =>
        persistSqliteScan(catalog, {
          offers: [...savedOffers.values()],
          searchedAt: scanAt.toISOString(),
          errors: [],
          scanState,
          scanContext: {
            queries: input.queries,
            sources: input.sources,
            results: [],
            cancelled: true,
          },
        }),
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
    return persistSqliteScan(catalog, {
      offers: result.offers,
      searchedAt: result.searchedAt,
      errors,
      scanState,
      rejected: result.summary?.rejected,
      scanContext: {
        queries: input.queries,
        sources: input.sources,
        results: result.results,
        // How long the whole scan took: the cost of a phrase or a source, shown on „Dziś”.
        durationMs: Date.now() - startedMs,
        ...(result.mode ? { mode: result.mode } : {}),
      },
    });
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
