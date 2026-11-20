// @ts-check
// Routes of the catalogue ("Książki"): works, editions, variants, series, persons, seeding from BN,
// buyback quotes and the legacy history export.
import { mergeVariants, setEditionVariant, workPriceOverview } from '../edition-variants.mjs';
import { historyBookLabels } from '../history-brief.mjs';
import { listWorkSeries, updateWorkSeries } from '../work-series-api.mjs';
import { getCatalogEdition, getCatalogWork, listCatalogWorks } from '../catalog-api.mjs';
import { reviewQueueSummary } from '../review-queue.mjs';
import { bookHistory } from '../price-analysis.mjs';
import { sqliteHistoryModel } from '../sqlite-history-read.mjs';
import { catalogInsights } from '../catalog-insights.mjs';
import {
  catalogSeries,
  setWorkUniverse,
  getSeriesDefinition,
  saveSeriesDefinition,
} from '../catalog-series.mjs';
import { catalogPersons, personWorks } from '../catalog-bibliography.mjs';
import { marketIndex } from '../market-index.mjs';
import { buyback, getBuyback, readJson, send, catalogHistorySnapshot } from '../app-runtime.mjs';

export function addCatalogRoutes(routes, { getProductionCatalog, identificationControl }) {
  routes
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
    // „Okazje” → „Rynek”: every edition's resale value, sale chance in 30 days and turnover.
    .add('GET', '/api/market/index', async ({ catalog, response, url }) =>
      send(
        response,
        200,
        JSON.stringify(
          marketIndex(catalog.repository, {
            sort: url.searchParams.get('sort') ?? undefined,
            limit: url.searchParams.get('limit') ?? undefined,
            offset: url.searchParams.get('offset') ?? undefined,
            query: url.searchParams.get('q') ?? undefined,
            confidence: url.searchParams.get('confidence') ?? undefined,
          }),
        ),
      ),
    )
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
    );
}
