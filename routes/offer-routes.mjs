// @ts-check
// Routes of offers and sets: lists, details, assignment to an edition, notes and watching, set
// composition.
import { reassignOffer, unassignOffer } from '../offer-assignment.mjs';
import { editionForWorkAssignment } from '../edition-variants.mjs';
import {
  listOfferWorkspace,
  setOfferWorkspace,
  importOfferWorkspace,
} from '../offer-workspace-api.mjs';
import {
  listOfferSets,
  markOfferAsSet,
  updateSetEdition,
  unmarkOfferSet,
  setCandidates,
  cycleVolumeEditions,
} from '../offer-sets.mjs';
import { getCatalogOffer, listCatalogOffers, listCatalogOfferGroups } from '../catalog-api.mjs';
import { readJson, send } from '../app-runtime.mjs';

export function addOfferRoutes(routes) {
  routes
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
    });
}
