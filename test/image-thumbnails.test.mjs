import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchImageVariant, proxiedImage, thumbnailImageUrl } from '../offer-images.mjs';
import { thumbnailSrc, coverMarkup } from '../app/core/bibliography.js';

// Real catalogue URLs (copy of the data, 11.11.2026).
const ALLEGRO = 'https://a.allegroimg.com/original/113c92/342ed06d4a59b0476bb457318fc1';
const TEZEUSZ =
  'https://static2.tezeusz.pl/product_show/images/04/f1/4c/warhammer-40000-indomitus-gav-thorpe.jpeg';
const VINTED =
  'https://images1.vinted.net/t/01_00044_yomBV8kn1ftAN8hk2C3zYHRA/310x430/cea3ae96.webp?s=bbff9feb8af3c1d4b356370d53d28a30b9cbc00d';
const EMPIK =
  'https://ecsmedia.pl/cir/p/zlodziej-czasu-wielka-kolekcja-terry-pratchett-8230236464339896432/a770062eb0bb4b478ca551711ac57322.webp';
const DEDALUS =
  'https://dedalus.pl/img/imagecache/4001-5000/247x400/product-media/4001-5000/Drugie-pokolenie-Margaret-Weis-Tracy-Hickman-4114-247x400-nobckgr.jpg';

test('small CDN variants exist for Allegro and Tezeusz only', () => {
  assert.equal(
    thumbnailImageUrl(ALLEGRO),
    'https://a.allegroimg.com/s180/113c92/342ed06d4a59b0476bb457318fc1',
  );
  assert.equal(
    thumbnailImageUrl(TEZEUSZ),
    'https://static2.tezeusz.pl/product_thumb/images/04/f1/4c/warhammer-40000-indomitus-gav-thorpe.jpeg',
  );
  // Signed (Vinted), placeholder redirects (Dedalus) and already small (Empik): the original.
  for (const url of [VINTED, DEDALUS, EMPIK]) assert.equal(thumbnailImageUrl(url), null, url);
  assert.equal(thumbnailImageUrl('https://evil.example/original/a'), null);
});

test('proxied thumbnails carry thumb=1; the full size stays without it', () => {
  assert.equal(proxiedImage(ALLEGRO), '/api/image?u=' + encodeURIComponent(ALLEGRO));
  assert.equal(
    proxiedImage(ALLEGRO, 'thumb'),
    '/api/image?u=' + encodeURIComponent(ALLEGRO) + '&thumb=1',
  );
});

function fakeFetch(responses) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const answer = responses[url] || { status: 404, type: 'text/html' };
    return new Response(answer.body || 'x', {
      status: answer.status,
      headers: { 'content-type': answer.type },
    });
  };
  return { fetcher, calls };
}

test('a thumbnail request fetches the small variant through the same cache', async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'bookflip-thumbs-'));
  try {
    const small = 'https://a.allegroimg.com/s180/113c92/342ed06d4a59b0476bb457318fc1';
    const { fetcher, calls } = fakeFetch({
      [small]: { status: 200, type: 'image/webp', body: 'small' },
      [ALLEGRO]: { status: 200, type: 'image/jpeg', body: 'original-original' },
    });
    const image = await fetchImageVariant(ALLEGRO, { size: 'thumb', cacheDirectory, fetcher });
    assert.equal(image.type, 'image/webp');
    assert.equal(String(image.body), 'small');
    assert.deepEqual(calls, [small]);
    // Second time from the disk cache, no request.
    await fetchImageVariant(ALLEGRO, { size: 'thumb', cacheDirectory, fetcher });
    assert.equal(calls.length, 1);
    // Without size=thumb: the original.
    const full = await fetchImageVariant(ALLEGRO, { cacheDirectory, fetcher });
    assert.equal(String(full.body), 'original-original');
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test('a missing or broken variant falls back to the original', async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'bookflip-thumbs-'));
  try {
    const { fetcher, calls } = fakeFetch({
      [TEZEUSZ]: { status: 200, type: 'image/jpeg', body: 'original' },
    });
    const image = await fetchImageVariant(TEZEUSZ, { size: 'thumb', cacheDirectory, fetcher });
    assert.equal(String(image.body), 'original');
    assert.equal(calls.length, 2);
    // The failed variant is remembered (.missing): the next thumbnail goes straight to the original.
    await fetchImageVariant(TEZEUSZ, { size: 'thumb', cacheDirectory, fetcher });
    assert.equal(calls.length, 2);
    // A source without a variant asks for the original only.
    const vinted = fakeFetch({ [VINTED]: { status: 200, type: 'image/webp', body: 'v' } });
    await fetchImageVariant(VINTED, { size: 'thumb', cacheDirectory, fetcher: vinted.fetcher });
    assert.deepEqual(vinted.calls, [VINTED]);
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test('list covers up to 56 px ask for the thumbnail, detail covers keep the full image', () => {
  assert.equal(thumbnailSrc('/api/image?u=x'), '/api/image?u=x&thumb=1');
  assert.equal(
    thumbnailSrc('/api/offers/Vinted%3A1/image'),
    '/api/offers/Vinted%3A1/image?thumb=1',
  );
  assert.equal(
    thumbnailSrc('/api/cover?isbn=9788375780000&size=M'),
    '/api/cover?isbn=9788375780000&size=M&thumb=1',
  );
  assert.equal(thumbnailSrc('/api/image?u=x&thumb=1'), '/api/image?u=x&thumb=1');
  assert.equal(thumbnailSrc('data:image/gif;base64,AA'), 'data:image/gif;base64,AA');
  for (const size of ['xs', 'sm', 'md'])
    assert.match(
      coverMarkup('/api/image?u=x', 'Tytuł', { size }),
      /src="\/api\/image\?u=x&amp;thumb=1"|src="\/api\/image\?u=x&#38;thumb=1"/,
    );
  for (const size of ['lg', 'xl'])
    assert.doesNotMatch(coverMarkup('/api/image?u=x', 'Tytuł', { size }), /thumb=1/);
});
