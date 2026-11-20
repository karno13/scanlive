import { tailscaleAccessFromEnv, validateBookflipRequest } from './tailscale-access.mjs';
import { apiRoutes } from './api-routes.mjs';
import { createRouter } from './router.mjs';
import { publicAssetPath } from './static-asset-path.mjs';
import { sendStaticFile } from './static-files.mjs';
import { createLiveEvents } from './live-events.mjs';
import { unseenDealAlerts } from './deal-alerts.mjs';
import { todaySummary } from './today.mjs';
import { sourceStatus } from './source-status.mjs';
import { getPolishOnly } from './language-policy.mjs';
import { createAutoBackupScheduler } from './auto-backup.mjs';
import { createScanScheduler, localScanRunner } from './scan-schedule.mjs';
import { rescoreStoredProposals } from './title-proposals.mjs';
import { repairCatalogTitles } from './title-repair.mjs';
import {
  createScanDiagnostics,
  addScanEvent,
  scanProgress,
  scanTelemetry,
} from './scan-diagnostics.mjs';
import { createServer } from 'node:http';
import { realpath } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localSourceHosts } from './local-scan.mjs';
import { reviewQueueSummary } from './review-queue.mjs';
import { storageMode } from './sqlite-single-store.mjs';
import { createIdentificationScheduler } from './identification-scheduler.mjs';
import {
  closeProductionCatalog,
  buyback,
  getBuyback,
  readJson,
  securityHeaders,
  send,
  persistScanStatus,
  readScanStatus,
  productionCatalog,
  getProductionCatalog,
  recordProgress,
  streamHeaders,
} from './app-runtime.mjs';
import { scheduleCatalogResolution } from './background-jobs.mjs';
import { validateSearchInput, searchOffers, searchAndStore } from './scan-engine.mjs';
import { addImageRoutes } from './routes/image-routes.mjs';
import { addReviewRoutes } from './routes/review-routes.mjs';
import { addCatalogRoutes } from './routes/catalog-routes.mjs';
import { addOfferRoutes } from './routes/offer-routes.mjs';
import { addSourceRoutes } from './routes/source-routes.mjs';

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
      // New deals announced (deal-alerts.mjs): the page shows them and notifies.
      deals: () => {
        const catalog = getProductionCatalog();
        if (!catalog) return null;
        try {
          return { unseen: unseenDealAlerts(catalog.repository) };
        } catch {
          return null;
        }
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
  // The routes that need the state of the running scan; the rest are added below from
  // routes/*.mjs. Routes are tried in the order they were added (router.mjs). Handlers get the
  // request, the response, the parsed URL and the URL-decoded path parameters. A handler that
  // names `catalog` in its parameters gets the open catalogue; when there is none the request ends
  // with 503 CATALOG_DISABLED before the handler body runs.
  const localRoutes = createRouter()
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
    .add('GET', '/api/scan/status', async ({ request, response, url, params }) => {
      return send(response, 200, JSON.stringify(currentScan || (await readScanStatus())));
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
  // The other routes, one file per area (routes/*.mjs). No two routes match the same request, so
  // the order of these tables does not matter.
  const routeContext = { getProductionCatalog, identificationControl };
  addImageRoutes(localRoutes, routeContext);
  addReviewRoutes(localRoutes, routeContext);
  addCatalogRoutes(localRoutes, routeContext);
  addOfferRoutes(localRoutes);
  addSourceRoutes(localRoutes, routeContext);
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
