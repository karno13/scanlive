import { tailscaleAccessFromEnv, validateBookflipRequest } from './tailscale-access.mjs';
import { apiRoutes } from './api-routes.mjs';
import { createRouter } from './router.mjs';
import { listScanProfiles, putScanProfile, deleteScanProfile } from './scan-profiles-api.mjs';
import { publicAssetPath } from './static-asset-path.mjs';
import { sendStaticFile } from './static-files.mjs';
import { createLiveEvents } from './live-events.mjs';
import { todaySummary } from './today.mjs';
import { sourceStatus } from './source-status.mjs';
import {
  addBatchPlan,
  applyAddBatch,
  applyQuickBatch,
  quickBatchPlan,
  recentBatches,
  undoBatch,
} from './review-batches.mjs';
import { retryIdentificationJobs } from './identification-retry.mjs';
import { getPolishOnly } from './language-policy.mjs';
import { blockedSources, NO_LEGAL_ACCESS } from './source-blocks.mjs';
import { reassignOffer, unassignOffer } from './offer-assignment.mjs';
import {
  editionForWorkAssignment,
  mergeVariants,
  setEditionVariant,
  workPriceOverview,
} from './edition-variants.mjs';
import { createAutoBackupScheduler } from './auto-backup.mjs';
import { createScanScheduler, localScanRunner } from './scan-schedule.mjs';
import { computeProposal, loadProposal, rescoreStoredProposals } from './title-proposals.mjs';
import { repairCatalogTitles } from './title-repair.mjs';
import { historyBookLabels } from './history-brief.mjs';
import {
  listOfferWorkspace,
  setOfferWorkspace,
  importOfferWorkspace,
} from './offer-workspace-api.mjs';
import { listWorkSeries, updateWorkSeries } from './work-series-api.mjs';
import {
  createScanDiagnostics,
  addScanEvent,
  scanProgress,
  scanTelemetry,
} from './scan-diagnostics.mjs';
import {
  listOfferSets,
  markOfferAsSet,
  updateSetEdition,
  unmarkOfferSet,
  setCandidates,
  cycleVolumeEditions,
} from './offer-sets.mjs';
import { isbnKeys, normalizeISBN } from './isbn-normalization.mjs';
import { createServer } from 'node:http';
import { realpath } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localSourceHosts } from './local-scan.mjs';
import {
  decideIdentificationJob,
  getCatalogEdition,
  getCatalogOffer,
  getCatalogWork,
  listCatalogOffers,
  listCatalogOfferGroups,
  listCatalogWorks,
  listIdentificationJobs,
  reviewQueueSummary,
  matchIdentificationJobByIsbn,
  localWorkCandidates,
  sureReviewPlan,
  applySureReviewPlan,
  approveJobAsBook,
  updateReviewSkipped,
} from './catalog-api.mjs';
import { offerEditionDraft, createEditionFromOffer } from './offer-editions.mjs';
import { bookHistory } from './price-analysis.mjs';
import { sqliteHistoryModel } from './sqlite-history-read.mjs';
import { storageMode, createSqliteBook, linkSqliteOffer } from './sqlite-single-store.mjs';
import { createIdentificationScheduler } from './identification-scheduler.mjs';
import {
  createImageBackfill,
  fetchImageVariant,
  NO_COVER_GIF,
  offerCoverForIsbn,
  offerImageUrl,
  proxiedImage,
} from './offer-images.mjs';
import { catalogInsights } from './catalog-insights.mjs';
import {
  catalogSeries,
  setWorkUniverse,
  getSeriesDefinition,
  saveSeriesDefinition,
} from './catalog-series.mjs';
import { catalogPersons, personWorks } from './catalog-bibliography.mjs';
import {
  closeProductionCatalog,
  buyback,
  getBuyback,
  readJson,
  securityHeaders,
  send,
  runtimeDataDirectory,
  persistScanStatus,
  readScanStatus,
  productionCatalog,
  getProductionCatalog,
  recordProgress,
  streamHeaders,
  catalogHistorySnapshot,
  withHistoryWriteLock,
} from './app-runtime.mjs';
import { scheduleCatalogResolution } from './background-jobs.mjs';
import { validateSearchInput, searchOffers, searchAndStore } from './scan-engine.mjs';

let imageBackfill = null;
const appDirectory = fileURLToPath(new URL('./app/', import.meta.url));
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

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
  // Live updates (/api/events): scan state, review queue and sources, checked while a tab listens.
  const liveEvents = createLiveEvents({
    headers: securityHeaders,
    probes: {
      scan: () => {
        const scan = currentScan;
        if (!scan) return { status: 'idle' };
        return {
          status: scan.status,
          startedAt: scan.startedAt,
          finishedAt: scan.finishedAt || null,
          progress: scanProgress(scan.diagnostics),
        };
      },
      queue: () => {
        const catalog = getProductionCatalog();
        if (!catalog) return null;
        const scheduler = identificationControl?.status() ?? { available: false };
        return {
          ...reviewQueueSummary(catalog.repository),
          identification: catalog.status({ runStartedAt: scheduler.runStartedAt }).identification,
          active: scheduler.active === true,
          paused: scheduler.paused === true,
        };
      },
      source: () => {
        const catalog = getProductionCatalog();
        if (!catalog) return null;
        return sourceStatus(catalog.repository, Object.keys(localSourceHosts)).map((row) => [
          row.source,
          row.state,
          row.downSince,
        ]);
      },
    },
  });
  // Every route of the local server, in the order they are tried (router.mjs). Handlers get the
  // request, the response, the parsed URL and the URL-decoded path parameters. A handler that
  // names `catalog` in its parameters gets the open catalogue; when there is none the request ends
  // with 503 CATALOG_DISABLED before the handler body runs.
  const localRoutes = createRouter()
    .add('GET', '/api/image', async ({ request, response, url, params }) => {
      try {
        const image = await fetchImageVariant(url.searchParams.get('u'), {
          size: url.searchParams.get('thumb') === '1' ? 'thumb' : null,
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
    // Cover for an ISBN: a photo of a stored offer of that book, else Open Library. Open Library has
    // no cover for most Polish editions; then a 1x1 transparent GIF (200, X-BookFlip-Cover: none)
    // instead of a 404, so the page shows its placeholder without an error in the console.
    .add('GET', '/api/cover', async ({ request, response, url, params }) => {
      const keys = isbnKeys(url.searchParams.get('isbn'));
      const size = ['S', 'M', 'L'].includes(url.searchParams.get('size'))
        ? url.searchParams.get('size')
        : 'M';
      const cacheDirectory = join(runtimeDataDirectory, 'image-cache');
      const catalog = getProductionCatalog();
      const candidates = [];
      if (keys.length) {
        const offerImage = catalog ? offerCoverForIsbn(catalog.repository.database, keys) : null;
        if (offerImage) candidates.push(offerImage);
        candidates.push(
          `https://covers.openlibrary.org/b/isbn/${keys[0]}-${size}.jpg?default=false`,
        );
      }
      for (const candidate of candidates) {
        try {
          // The offer photo may have a small CDN variant; Open Library sizes come from size=S/M/L.
          const image = await fetchImageVariant(candidate, {
            size: url.searchParams.get('thumb') === '1' ? 'thumb' : null,
            cacheDirectory,
          });
          response.writeHead(200, {
            'Content-Type': image.type,
            'Cache-Control': 'private, max-age=86400',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'",
          });
          return response.end(image.body);
        } catch {}
      }
      // Short cache: an offer of this book may be saved or assigned later.
      response.writeHead(200, {
        'Content-Type': 'image/gif',
        'Cache-Control': 'private, max-age=3600',
        'X-BookFlip-Cover': 'none',
        'X-Content-Type-Options': 'nosniff',
      });
      return response.end(NO_COVER_GIF);
    })
    .add('GET', '/api/offers/:id/image', async ({ catalog, request, response, url, params }) => {
      const imageUrl = await offerImageUrl(catalog.repository, params.id);
      if (!imageUrl) return send(response, 404, JSON.stringify({ error: 'IMAGE_NOT_FOUND' }));
      response.writeHead(302, {
        Location: proxiedImage(imageUrl, url.searchParams.get('thumb') === '1' ? 'thumb' : null),
        'Cache-Control': 'no-store',
      });
      return response.end();
    })
    .add('*', '/api/buyback/*', async ({ request, response, url, params }) => {
      const buyback = getBuyback();
      if (!buyback) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      if (request.method === 'GET' && url.pathname === '/api/buyback/quotes')
        return send(
          response,
          200,
          JSON.stringify({
            quotes: buyback.many((url.searchParams.get('isbn') || '').split(',').slice(0, 200)),
          }),
        );
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
          return send(
            response,
            200,
            JSON.stringify(await buyback.check(input?.isbn, { force: input?.force === true })),
          );
        } catch (error) {
          return send(response, error.status || 502, JSON.stringify({ error: error.message }));
        }
      }
      return send(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
    })
    .add('*', '/api/images/backfill/*', async ({ catalog, request, response, url, params }) => {
      imageBackfill ||= createImageBackfill(catalog.repository);
      if (request.method === 'GET' && url.pathname === '/api/images/backfill')
        return send(response, 200, JSON.stringify(imageBackfill.status()));
      if (request.method === 'POST')
        return send(
          response,
          202,
          JSON.stringify(
            url.pathname.endsWith('/cancel') ? imageBackfill.cancel() : imageBackfill.start(),
          ),
        );
      return send(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
    })
    // Smaller routes live in api-routes.mjs; its route table says which paths are its own.
    .add('GET', '/api/scan/diagnostics', async ({ request, response, url, params }) => {
      const scan = currentScan || (await readScanStatus());
      return send(
        response,
        200,
        JSON.stringify({
          ...scan,
          progress: scanProgress(scan.diagnostics),
          telemetry: scanTelemetry(scan.diagnostics, { running: scan.status === 'running' }),
        }),
      );
    })
    // One event stream per tab: scan, queue and source changes (live-events.mjs).
    .add('GET', '/api/events', async ({ request, response }) => {
      liveEvents.handle(request, response);
      // The stream stays open: tell the router it is handled.
      return true;
    })
    // The "Dziś" start view: changes since the previous visit, queue, sources, last and next scan.
    .add('GET', '/api/today', async ({ catalog, request, response, url, params }) => {
      return send(
        response,
        200,
        JSON.stringify({
          ...todaySummary(catalog.repository, {
            since: url.searchParams.get('since'),
            sources: Object.keys(localSourceHosts),
          }),
          scan: currentScan
            ? {
                status: currentScan.status,
                startedAt: currentScan.startedAt,
                finishedAt: currentScan.finishedAt || null,
              }
            : await readScanStatus().then((value) => ({
                status: value.status,
                startedAt: value.startedAt || null,
                finishedAt: value.finishedAt || null,
              })),
        }),
      );
    })
    // Batch approval in the queue ("Szybkie", "Do dodania") and undoing a whole batch.
    .add(
      'POST',
      '/api/review-batches/:kind/plan',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        const jobIds = Array.isArray(input.jobIds) ? input.jobIds.map(String).slice(0, 500) : null;
        if (!['quick', 'add'].includes(params.kind))
          return send(response, 404, JSON.stringify({ error: 'UNKNOWN_BATCH' }));
        const plan =
          params.kind === 'quick'
            ? quickBatchPlan(catalog.repository, { jobIds })
            : addBatchPlan(catalog.repository, { jobIds });
        return send(response, 200, JSON.stringify(plan));
      },
    )
    .add(
      'POST',
      '/api/review-batches/:kind/apply',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        if (params.kind === 'quick')
          return send(
            response,
            200,
            JSON.stringify(
              await applyQuickBatch(catalog, Array.isArray(input.items) ? input.items : []),
            ),
          );
        if (params.kind === 'add')
          return send(
            response,
            200,
            JSON.stringify(
              applyAddBatch(
                catalog.repository,
                Array.isArray(input.jobIds) ? input.jobIds.map(String) : [],
              ),
            ),
          );
        return send(response, 404, JSON.stringify({ error: 'UNKNOWN_BATCH' }));
      },
    )
    .add('GET', '/api/review-batches', async ({ catalog, request, response, url, params }) => {
      return send(response, 200, JSON.stringify({ items: recentBatches(catalog.repository) }));
    })
    .add(
      'POST',
      '/api/review-batches/:id/undo',
      async ({ catalog, request, response, url, params }) => {
        return send(response, 200, JSON.stringify(undoBatch(catalog.repository, params.id)));
      },
    )
    .add('GET', '/api/source-status', async ({ catalog, request, response, url, params }) => {
      return send(
        response,
        200,
        JSON.stringify({ items: sourceStatus(catalog.repository, Object.keys(localSourceHosts)) }),
      );
    })
    .add('GET', '/api/scan/status', async ({ request, response, url, params }) => {
      return send(response, 200, JSON.stringify(currentScan || (await readScanStatus())));
    })
    .add(
      'PUT',
      '/api/catalog/universe/:id',
      async ({ catalog, request, response, url, params }) => {
        const id = params.id;
        return send(
          response,
          200,
          JSON.stringify(setWorkUniverse(catalog.repository, id, await readJson(request))),
        );
      },
    )
    // Catalogue seeding from BN: the list, a new seed, a seed's status, removing one.
    .add(['GET', 'POST'], '/api/catalog/seeds', async ({ request, response }) => {
      const catalog = getProductionCatalog();
      if (!catalog?.seeds)
        return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      if (request.method === 'GET')
        return send(response, 200, JSON.stringify(catalog.seeds.list()));
      return send(response, 201, JSON.stringify(catalog.seeds.add(await readJson(request))));
    })
    .add(['PUT', 'DELETE'], '/api/catalog/seeds/:id', async ({ request, response, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog?.seeds)
        return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
      if (request.method === 'DELETE')
        return send(response, 200, JSON.stringify(catalog.seeds.remove(params.id)));
      return send(
        response,
        200,
        JSON.stringify(catalog.seeds.setStatus(params.id, (await readJson(request))?.status)),
      );
    })
    .add('GET', '/api/catalog/persons', async ({ catalog, request, response, url, params }) => {
      return send(
        response,
        200,
        JSON.stringify({
          items: catalogPersons(catalog.repository, {
            query: url.searchParams.get('q') || '',
            limit: url.searchParams.get('limit') || 200,
          }),
        }),
      );
    })
    .add('GET', '/api/catalog/persons/:id', async ({ catalog, request, response, url, params }) => {
      return send(response, 200, JSON.stringify(personWorks(catalog.repository, params.id)));
    })
    .add('GET', '/api/catalog/series-tree', async ({ catalog, request, response, url, params }) => {
      return send(response, 200, JSON.stringify({ universes: catalogSeries(catalog.repository) }));
    })
    .add(
      '*',
      '/api/catalog/series-definition',
      async ({ catalog, request, response, url, params }) => {
        if (request.method === 'GET')
          return send(
            response,
            200,
            JSON.stringify(
              getSeriesDefinition(catalog.repository, url.searchParams.get('name') || ''),
            ),
          );
        if (request.method === 'PUT')
          return send(
            response,
            200,
            JSON.stringify(saveSeriesDefinition(catalog.repository, await readJson(request))),
          );
        return send(response, 405, JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
      },
    )
    .add('GET', '/api/catalog/insights', async ({ catalog, request, response, url, params }) => {
      return send(response, 200, JSON.stringify(catalogInsights(catalog.repository)));
    })
    .add('GET', '/api/catalog/summary', async ({ catalog, request, response, url, params }) => {
      return send(response, 200, JSON.stringify(catalog.repository.counts()));
    })
    .add('GET', '/api/scan-profiles', async ({ catalog, request, response, url, params }) => {
      return send(response, 200, JSON.stringify({ items: listScanProfiles(catalog.repository) }));
    })
    .add(
      'POST',
      '/api/scan-profiles/import',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        return send(
          response,
          200,
          JSON.stringify(
            putScanProfile(catalog.repository, input?.name, input, { onlyIfAbsent: true }),
          ),
        );
      },
    )
    .add('POST', '/api/scan-profiles', async ({ catalog, request, response, url, params }) => {
      const input = await readJson(request);
      const result = putScanProfile(catalog.repository, input?.name, input, { onlyIfAbsent: true });
      return send(
        response,
        result.created ? 201 : 409,
        JSON.stringify(result.created ? result : { error: 'PROFILE_ALREADY_EXISTS' }),
      );
    })
    .add(
      ['PUT', 'DELETE'],
      '/api/scan-profiles/:name',
      async ({ catalog, request, response, url, params }) => {
        const name = params.name;
        if (request.method === 'DELETE')
          return send(response, 200, JSON.stringify(deleteScanProfile(catalog.repository, name)));
        const input = await readJson(request);
        return send(response, 200, JSON.stringify(putScanProfile(catalog.repository, name, input)));
      },
    )
    .add('GET', '/api/sources', async ({ request, response, url, params }) => {
      return send(
        response,
        200,
        JSON.stringify({
          sources: Object.keys(localSourceHosts),
          noAccess: NO_LEGAL_ACCESS,
          blocked: (() => {
            try {
              const catalog = getProductionCatalog();
              return catalog ? blockedSources(catalog.repository) : {};
            } catch {
              return {};
            }
          })(),
        }),
      );
    })
    .add('GET', '/api/history/brief', async ({ catalog, request, response, url, params }) => {
      return send(response, 200, JSON.stringify(historyBookLabels(catalog.repository)));
    })
    .add('GET', '/api/history', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog) throw Error('SQLITE_HISTORY_REQUIRES_CATALOG');
      return send(response, 200, JSON.stringify(catalogHistorySnapshot(catalog.repository)));
    })
    .add('GET', '/api/book', async ({ catalog, request, response, url, params }) => {
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
          catalog:
            url.searchParams.get('compact') === '1'
              ? historyBookLabels(catalog.repository)
              : catalogHistorySnapshot(catalog.repository),
          catalogSync: { mode: 'sqlite' },
        }),
      );
    })
    .add('POST', '/api/identification/control', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog || !identificationControl)
        return send(response, 503, JSON.stringify({ error: 'IDENTIFICATION_UNAVAILABLE' }));
      const { action, retryUnresolved = false } = await readJson(request);
      let retried = null;
      if (action === 'start') {
        if (retryUnresolved) retried = retryIdentificationJobs(catalog.repository, 'unresolved');
        const startedAt = new Date().toISOString();
        catalog.beginIdentificationRun(startedAt);
        identificationControl.start({ newRun: true, startedAt });
        void identificationControl.tick();
      } else if (action === 'stop') identificationControl.pause();
      else return send(response, 400, JSON.stringify({ error: 'INVALID_IDENTIFICATION_ACTION' }));
      return send(response, 200, JSON.stringify({ ...identificationControl.status(), retried }));
    })
    .add('GET', '/api/catalog/status', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      const scheduler = identificationControl?.status() ?? { available: false };
      return send(
        response,
        200,
        JSON.stringify(
          catalog
            ? {
                ...catalog.status({ runStartedAt: scheduler.runStartedAt }),
                scheduler,
                reviewQueue: reviewQueueSummary(catalog.repository),
              }
            : { enabled: false },
        ),
      );
    })
    .add('GET', '/api/catalog/series', async ({ catalog, request, response, url, params }) => {
      return send(response, 200, JSON.stringify({ items: listWorkSeries(catalog.repository) }));
    })
    .add('PUT', '/api/catalog/series/:id', async ({ catalog, request, response, url, params }) => {
      const id = params.id;
      const data = await readJson(request);
      return send(response, 200, JSON.stringify(updateWorkSeries(catalog.repository, id, data)));
    })
    .add('GET', '/api/catalog/works', async ({ catalog, request, response, url, params }) => {
      return send(
        response,
        200,
        JSON.stringify(listCatalogWorks(catalog.repository, Object.fromEntries(url.searchParams))),
      );
    })
    // Prices of a book over all its editions, and its price variants.
    .add(
      'GET',
      '/api/catalog/works/:id/prices',
      async ({ catalog, request, response, url, params }) => {
        const data = workPriceOverview(catalog.repository, params.id);
        return data
          ? send(response, 200, JSON.stringify(data))
          : send(response, 404, JSON.stringify({ error: 'WORK_NOT_FOUND' }));
      },
    )
    .add(
      'POST',
      '/api/catalog/works/:id/variants/merge',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        return send(
          response,
          200,
          JSON.stringify(
            mergeVariants(
              catalog.repository,
              params.id,
              String(input?.from ?? ''),
              String(input?.to ?? ''),
            ),
          ),
        );
      },
    )
    .add(
      'PUT',
      '/api/catalog/editions/:id/variant',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        return send(
          response,
          200,
          JSON.stringify(
            setEditionVariant(catalog.repository, params.id, input?.variantKey ?? null),
          ),
        );
      },
    )
    .add('GET', '/api/catalog/works/:id', async ({ catalog, request, response, url, params }) => {
      const id = params.id;
      const data = getCatalogWork(catalog.repository, id);
      return data
        ? send(response, 200, JSON.stringify(data))
        : send(response, 404, JSON.stringify({ error: 'WORK_NOT_FOUND' }));
    })
    .add(
      'GET',
      '/api/catalog/editions/:id',
      async ({ catalog, request, response, url, params }) => {
        const id = params.id;
        const data = getCatalogEdition(catalog.repository, id);
        return data
          ? send(response, 200, JSON.stringify(data))
          : send(response, 404, JSON.stringify({ error: 'EDITION_NOT_FOUND' }));
      },
    )
    .add('GET', '/api/offer-workspace', async ({ catalog, request, response, url, params }) => {
      return send(response, 200, JSON.stringify({ items: listOfferWorkspace(catalog.repository) }));
    })
    .add(
      'POST',
      '/api/offer-workspace/import',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        return send(
          response,
          200,
          JSON.stringify(importOfferWorkspace(catalog.repository, input?.entries)),
        );
      },
    )
    .add('PUT', '/api/offer-workspace/:id', async ({ catalog, request, response, url, params }) => {
      const id = params.id;
      const input = await readJson(request);
      return send(response, 200, JSON.stringify(setOfferWorkspace(catalog.repository, id, input)));
    })
    // Oferty → "Wg książki": one row per edition with its listings' count and price range.
    .add('GET', '/api/offer-groups', async ({ catalog, request, response, url, params }) => {
      return send(
        response,
        200,
        JSON.stringify(
          listCatalogOfferGroups(catalog.repository, Object.fromEntries(url.searchParams)),
        ),
      );
    })
    .add('GET', '/api/offers', async ({ catalog, request, response, url, params }) => {
      return send(
        response,
        200,
        JSON.stringify(listCatalogOffers(catalog.repository, Object.fromEntries(url.searchParams))),
      );
    })
    // Operator changes or removes an offer's edition (catalogue and offer panel).
    .add(
      ['PUT', 'DELETE'],
      '/api/offers/:id/assignment',
      async ({ catalog, request, response, url, params }) => {
        const offerId = params.id;
        const input = await readJson(request);
        // A book without a named edition: the edition the listing points at, or its unknown edition.
        const editionId =
          request.method === 'PUT' && !input?.editionId && input?.workId
            ? catalog.repository.transaction(
                () =>
                  editionForWorkAssignment(catalog.repository, String(input.workId), offerId)
                    .editionId,
              )
            : input?.editionId;
        const result =
          request.method === 'PUT'
            ? reassignOffer(catalog.repository, offerId, editionId, {
                reason: typeof input?.reason === 'string' ? input.reason.slice(0, 300) : null,
              })
            : unassignOffer(catalog.repository, offerId, {
                reason: typeof input?.reason === 'string' ? input.reason.slice(0, 300) : null,
              });
        return send(response, 200, JSON.stringify(result));
      },
    )
    .add('GET', '/api/offers/:id', async ({ catalog, request, response, url, params }) => {
      const id = params.id;
      const data = getCatalogOffer(catalog.repository, id);
      return data
        ? send(response, 200, JSON.stringify(data))
        : send(response, 404, JSON.stringify({ error: 'OFFER_NOT_FOUND' }));
    })
    .add(
      'POST',
      '/api/identification/retry',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        const result = retryIdentificationJobs(catalog.repository, input?.mode);
        if (result.queued > 0 && identificationControl) {
          identificationControl.start();
          void identificationControl.tick();
        }
        return send(response, 200, JSON.stringify(result));
      },
    )
    .add('GET', '/api/sets', async ({ catalog, request, response, url, params }) => {
      return send(response, 200, JSON.stringify({ items: listOfferSets(catalog.repository) }));
    })
    .add('POST', '/api/sets', async ({ catalog, request, response, url, params }) => {
      const input = await readJson(request);
      if (typeof input?.offerId !== 'string' || !input.offerId.trim())
        return send(response, 400, JSON.stringify({ error: 'INVALID_OFFER_ID' }));
      return send(response, 200, JSON.stringify(markOfferAsSet(catalog.repository, input.offerId)));
    })
    // GET: suggestions from the listing title; POST {text}: books named in a pasted description.
    .add(
      ['GET', 'POST'],
      '/api/sets/:offerId/candidates',
      async ({ catalog, request, response, url, params }) => {
        const input = request.method === 'POST' ? await readJson(request) : {};
        const text = typeof input?.text === 'string' ? input.text.slice(0, 20000) : '';
        return send(
          response,
          200,
          JSON.stringify(setCandidates(catalog.repository, params.offerId, { text })),
        );
      },
    )
    .add('GET', '/api/sets-cycle-volumes', async ({ catalog, request, response, url, params }) => {
      return send(
        response,
        200,
        JSON.stringify(
          cycleVolumeEditions(
            catalog.repository,
            url.searchParams.get('name') || '',
            url.searchParams.get('from'),
            url.searchParams.get('to'),
          ),
        ),
      );
    })
    // A set's books: add one, remove one; or unmark the set. (The path used to be split by hand:
    // counted with the leading "/api/sets", adding a book, removing one and unmarking never matched.)
    .add('POST', '/api/sets/:offerId/editions', async ({ catalog, request, response, params }) => {
      const input = await readJson(request);
      if (typeof input?.editionId !== 'string' || !input.editionId.trim())
        return send(response, 400, JSON.stringify({ error: 'INVALID_EDITION_ID' }));
      return send(
        response,
        200,
        JSON.stringify(updateSetEdition(catalog.repository, params.offerId, input.editionId, true)),
      );
    })
    .add(
      'DELETE',
      '/api/sets/:offerId/editions/:editionId',
      async ({ catalog, response, params }) => {
        return send(
          response,
          200,
          JSON.stringify(
            updateSetEdition(catalog.repository, params.offerId, params.editionId, false),
          ),
        );
      },
    )
    .add('DELETE', '/api/sets/:offerId', async ({ catalog, response, params }) => {
      return send(
        response,
        200,
        JSON.stringify(unmarkOfferSet(catalog.repository, params.offerId)),
      );
    })
    .add('GET', '/api/identification-jobs', async ({ catalog, request, response, url, params }) => {
      return send(
        response,
        200,
        JSON.stringify(
          listIdentificationJobs(catalog.repository, Object.fromEntries(url.searchParams)),
        ),
      );
    })
    // Offers skipped in review ("Pomiń"): { add: [jobId…] } or { clear: true }.
    .add('POST', '/api/review/skipped', async ({ catalog, request, response }) => {
      const input = (await readJson(request)) || {};
      const add = Array.isArray(input.add) ? input.add.slice(0, 500) : [];
      return send(
        response,
        200,
        JSON.stringify(
          updateReviewSkipped(catalog.repository, { add, clear: input.clear === true }),
        ),
      );
    })
    // "Szybkie" tab: the sure decisions to look through, then apply the ones the operator kept.
    .add(
      'POST',
      '/api/identification-jobs/sure-plan',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        const jobIds = Array.isArray(input?.jobIds)
          ? input.jobIds.map(String).slice(0, 2000)
          : null;
        return send(response, 200, JSON.stringify(sureReviewPlan(catalog.repository, { jobIds })));
      },
    )
    .add(
      'POST',
      '/api/identification-jobs/sure-apply',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        const result = await applySureReviewPlan(
          catalog,
          Array.isArray(input?.items) ? input.items : [],
        );
        // Approvals add ISBNs to the catalogue: the sibling offers with them are matched next.
        if (result.approved && identificationControl) {
          identificationControl.start();
          void identificationControl.tick();
        }
        return send(response, 200, JSON.stringify(result));
      },
    )
    // ISBN that no source knows: a draft built from the listings, then the edition in one click.
    .add(
      ['GET', 'POST'],
      '/api/identification-jobs/:id/offer-edition',
      async ({ catalog, request, response, url, params }) => {
        const jobId = params.id;
        if (request.method === 'GET')
          return send(response, 200, JSON.stringify(offerEditionDraft(catalog.repository, jobId)));
        const result = createEditionFromOffer(catalog.repository, jobId, await readJson(request));
        if (identificationControl) {
          identificationControl.start();
          void identificationControl.tick();
        }
        return send(response, 200, JSON.stringify(result));
      },
    )
    .add(
      'POST',
      '/api/identification-jobs/:id/decision',
      async ({ catalog, request, response, url, params }) => {
        const id = params.id;
        const input = await readJson(request);
        // "This book, edition not settled" from a title proposal: the book is named by an ISBN.
        const result =
          input.action === 'approved' && input.bookIsbn && !input.editionId && !input.workId
            ? await approveJobAsBook(catalog, id, { isbn: input.bookIsbn })
            : decideIdentificationJob(catalog.repository, id, input);
        if (input.action === 'requeued' && identificationControl) {
          identificationControl.start();
          void identificationControl.tick();
        }
        return send(response, 200, JSON.stringify(result));
      },
    )
    .add(
      'GET',
      '/api/identification-jobs/:id/local-candidates',
      async ({ catalog, request, response, url, params }) => {
        const job = catalog.repository.database
          .prepare(
            'SELECT o.id AS offer_id, o.original_title FROM identification_jobs j JOIN offers o ON o.id=j.offer_id WHERE j.id=?',
          )
          .get(params.id);
        if (!job) return send(response, 404, JSON.stringify({ error: 'REVIEW_JOB_NOT_FOUND' }));
        return send(
          response,
          200,
          JSON.stringify({
            items: localWorkCandidates(catalog.repository, job.original_title, {
              offerId: job.offer_id,
            }),
          }),
        );
      },
    )
    .add(
      ['GET', 'POST'],
      '/api/identification-jobs/:id/proposals',
      async ({ catalog, request, response, url, params }) => {
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
          JSON.stringify({
            jobId: id,
            queries: fresh.queries,
            candidates: fresh.candidates,
            confidence: fresh.confidence,
            unavailable: fresh.unavailable,
          }),
        );
      },
    )
    .add(
      'POST',
      '/api/identification-jobs/:id/find-isbn',
      async ({ catalog, request, response, url, params }) => {
        const id = params.id;
        const job = catalog.repository.database
          .prepare(
            "SELECT j.id,o.original_title FROM identification_jobs j JOIN offers o ON o.id=j.offer_id WHERE j.id=? AND j.status='review_required'",
          )
          .get(id);
        if (!job) return send(response, 404, JSON.stringify({ error: 'REVIEW_JOB_NOT_FOUND' }));
        const input = await readJson(request);
        return send(
          response,
          200,
          JSON.stringify(await catalog.findIsbnsByTitle(input?.title || job.original_title)),
        );
      },
    )
    .add(
      'POST',
      '/api/identification-jobs/:id/match-isbn',
      async ({ catalog, request, response, url, params }) => {
        const id = params.id;
        const input = await readJson(request);
        return send(
          response,
          200,
          JSON.stringify(await matchIdentificationJobByIsbn(catalog, id, input)),
        );
      },
    )
    .add('POST', '/api/catalog/isbn-check', async ({ catalog, request, response, url, params }) => {
      const raw = (await readJson(request)).isbn;
      const isbn = normalizeISBN(raw);
      if (!isbn) return send(response, 400, JSON.stringify({ error: 'INVALID_ISBN' }));
      const edition = catalog.repository.findEditionByISBN(isbn);
      return send(
        response,
        200,
        JSON.stringify({
          isbn,
          found: Boolean(edition),
          edition: edition
            ? {
                id: edition.id,
                title: edition.title,
                workId: edition.work_id,
                workTitle: edition.work_title,
              }
            : null,
        }),
      );
    })
    .add(
      'POST',
      '/api/catalog/lookup-preview',
      async ({ catalog, request, response, url, params }) => {
        const isbn = normalizeISBN((await readJson(request))?.isbn);
        if (!isbn) return send(response, 400, JSON.stringify({ error: 'INVALID_ISBN' }));
        return send(response, 200, JSON.stringify(await catalog.lookupIsbn(isbn)));
      },
    )
    .add(
      'POST',
      '/api/catalog/lookup-confirm',
      async ({ catalog, request, response, url, params }) => {
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
      },
    )
    .add('POST', '/api/catalog/link', async ({ request, response, url, params }) => {
      storageMode();
      const input = await readJson(request);
      const catalog = getProductionCatalog();
      if (!catalog) throw Error('SQLITE_STORAGE_REQUIRES_CATALOG');
      await withHistoryWriteLock(async () =>
        linkSqliteOffer(catalog, input, { returnHistory: false }),
      );
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
        try {
          const store = getProductionCatalog();
          if (store?.repository) scanInput.polishOnly = getPolishOnly(store.repository);
        } catch {}
        scanStarted = true;
        scanAbortController = new AbortController();
        currentScan = {
          status: 'running',
          startedAt: new Date().toISOString(),
          diagnostics: createScanDiagnostics({
            queries: scanInput.queries || [],
            sources: scanInput.sources || [],
            tasks: scanInput.tasks || null,
          }),
        };
        await persistScanStatus(currentScan);
        if (url.searchParams.get('stream') === '1') {
          streamHeaders(response);
          const emit = (event) => {
            const safe = recordProgress(event);
            addScanEvent(currentScan.diagnostics, safe);
            if (!response.destroyed)
              response.write(JSON.stringify({ type: 'progress', event: safe }) + '\n');
          };
          try {
            const result = await searchAndStore(scanInput, emit, {
              catalogProvider,
              search,
              signal: scanAbortController.signal,
              shouldAutoResolve: () => identificationControl?.status().running ?? true,
            });
            currentScan = {
              ...currentScan,
              status: 'completed',
              finishedAt: new Date().toISOString(),
              summary: { ...result.summary, scanAt: result.lastScan?.at ?? null },
            };
            await persistScanStatus(currentScan);
            if (!response.destroyed)
              response.write(JSON.stringify({ type: 'result', result }) + '\n');
            if (!response.destroyed) response.end();
          } catch (error) {
            currentScan = {
              ...currentScan,
              status: error.message === 'SCAN_CANCELLED' ? 'cancelled' : 'failed',
              finishedAt: new Date().toISOString(),
            };
            await persistScanStatus(currentScan);
            if (!response.destroyed)
              response.write(
                JSON.stringify({
                  type: 'error',
                  error: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_APP_ERROR',
                }) + '\n',
              );
            if (!response.destroyed) response.end();
          }
          return;
        }
        const result = await searchAndStore(
          scanInput,
          (event) => addScanEvent(currentScan.diagnostics, recordProgress(event)),
          {
            catalogProvider,
            search,
            signal: scanAbortController.signal,
            shouldAutoResolve: () => identificationControl?.status().running ?? true,
          },
        );
        currentScan = {
          ...currentScan,
          status: 'completed',
          finishedAt: new Date().toISOString(),
          summary: { ...result.summary, scanAt: result.lastScan?.at ?? null },
        };
        await persistScanStatus(currentScan);
        return send(response, 200, JSON.stringify(result));
      } catch (error) {
        if (scanStarted) {
          currentScan = {
            ...currentScan,
            status: error.message === 'SCAN_CANCELLED' ? 'cancelled' : 'failed',
            finishedAt: new Date().toISOString(),
          };
          await persistScanStatus(currentScan);
        }
        throw error;
      } finally {
        scanAbortController = null;
        scanInFlight = false;
      }
    });
  const server = createServer(async (request, response) => {
    try {
      const rejected = validateBookflipRequest(request, tailscaleAccess);
      if (rejected)
        return send(response, rejected.status, JSON.stringify({ error: rejected.error }));
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      // Smaller routes live in api-routes.mjs; its route table says which paths are its own.
      const apiMatch = apiRoutes.match(request.method, url.pathname);
      if (apiMatch?.handler) {
        const catalog = getProductionCatalog();
        if (!catalog) return send(response, 503, JSON.stringify({ error: 'CATALOG_DISABLED' }));
        const input = ['PUT', 'POST'].includes(request.method) ? await readJson(request) : null;
        const data = await apiMatch.handler({
          repo: catalog.repository,
          method: request.method,
          input,
          params: apiMatch.params,
        });
        return send(response, 200, JSON.stringify(data ?? null));
      }
      const route = localRoutes.match(request.method, url.pathname);
      if (route?.handler) {
        const handled = await route.handler({
          request,
          response,
          url,
          params: route.params,
          // Read only by handlers that name it; without an open catalogue the request ends with 503.
          get catalog() {
            const catalog = getProductionCatalog();
            if (!catalog) throw Object.assign(Error('CATALOG_DISABLED'), { statusCode: 503 });
            return catalog;
          },
        });
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
        if (error.code === 'ENOENT')
          return send(response, 404, 'Nie znaleziono', 'text/plain; charset=utf-8');
        throw error;
      }
      if (!requested.startsWith(root + sep))
        return send(response, 404, 'Nie znaleziono', 'text/plain; charset=utf-8');
      await sendStaticFile(request, response, requested, {
        type: contentTypes[extname(file)] || 'application/octet-stream',
        headers: securityHeaders,
      });
      return;
    } catch (error) {
      // A stream (scan progress, events) already started: end it instead of a second header.
      if (response.headersSent) return response.end();
      send(
        response,
        error.statusCode || 500,
        JSON.stringify({
          error: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_APP_ERROR',
        }),
      );
    }
  });
  // Event streams never end on their own: end them first, or close() would wait for them.
  const closeServer = server.close.bind(server);
  server.close = (callback) => {
    liveEvents.close();
    return closeServer(callback);
  };
  server.on('close', () => {
    closeProductionCatalog();
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
    onError: (error) =>
      recordProgress({
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
  server.on('close', () => {
    void scheduler.stop();
    scanScheduler.stop();
    buyback?.stopAuto();
    productionCatalog?.seeds?.stop();
    autoBackup.stop();
  });
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
    if (String(process.env.BOOKFLIP_CATALOG_SEEDS ?? '1') !== '0')
      getProductionCatalog()?.seeds?.start();
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
