// @ts-check
// Routes of the "Źródła" view: the state of each source and the saved scan profiles.
import { listScanProfiles, putScanProfile, deleteScanProfile } from '../scan-profiles-api.mjs';
import { sourceStatus } from '../source-status.mjs';
import { blockedSources, NO_LEGAL_ACCESS } from '../source-blocks.mjs';
import { localSourceHosts } from '../local-scan.mjs';
import { readJson, send } from '../app-runtime.mjs';

export function addSourceRoutes(routes, { getProductionCatalog }) {
  routes
    .add('GET', '/api/source-status', async ({ catalog, request, response, url, params }) => {
      return send(
        response,
        200,
        JSON.stringify({ items: sourceStatus(catalog.repository, Object.keys(localSourceHosts)) }),
      );
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
    });
}
