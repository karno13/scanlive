// Routes of offer photos and book covers: the image proxy, the cover of an ISBN and the photo
// backfill.
import { isbnKeys } from '../isbn-normalization.mjs';
import { join } from 'node:path';
import {
  createImageBackfill,
  fetchImageVariant,
  NO_COVER_GIF,
  offerCoverForIsbn,
  offerImageUrl,
  proxiedImage,
} from '../offer-images.mjs';
import { send, runtimeDataDirectory } from '../app-runtime.mjs';

// One photo backfill per process.
let imageBackfill = null;

export function addImageRoutes(routes, { getProductionCatalog }) {
  routes
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
    });
}
