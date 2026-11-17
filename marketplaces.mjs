import { sharedMarketplaceGate } from './marketplace-gate.mjs';
import { queryText, matchesTopic, excludesProduct } from './search-policy.mjs';
import { bibliographicMetadata, extractOfferISBN } from './isbn.mjs';
import { createHash } from 'node:crypto';
import { safeImageUrl } from './offer-images.mjs';
import { grosze, observationFields } from './offer-observations.mjs';
import { setTimeout as wait } from 'node:timers/promises';
import {
  parseVinted,
  parseAllegroListing,
  parseOlx,
  rscText,
  objectAt,
} from './reference-parsers.mjs';
import { attribute, decodeHtml, textOnly } from './html-text.mjs';
import {
  ANTIQUARIAN_SOURCES,
  categoryPageInfo,
  categoryPageUrl,
  isCategorySource,
  parseCategoryPage,
} from './antiquarian-sources.mjs';
const sources = {
  Allegro: { host: 'allegro.pl', path: '/oferta/' },
  Empik: { host: 'www.empik.com', path: null },
  Vinted: { host: 'www.vinted.pl', path: '/items/' },
  'Allegro Lokalnie': { host: 'allegrolokalnie.pl', path: '/oferta/' },
  OLX: { host: 'www.olx.pl', path: '/d/oferta/' },
  'Tezeusz.pl': { host: 'tezeusz.pl', path: null },
  'Dedalus.pl': { host: 'dedalus.pl', path: null },
  // JSON list API, allowed by the shop's robots.txt (docs/SOURCES-ACCESS-2026-11.md).
  'Skupszop.pl': { host: 'skupszop.pl', path: null },
  // Antiquarian bookshops read by category (antiquarian-sources.mjs).
  ...Object.fromEntries(
    Object.entries(ANTIQUARIAN_SOURCES).map(([name, spec]) => [
      name,
      { host: spec.host, path: null },
    ]),
  ),
  // Not a marketplace: book pages read to confirm ISBNs no bibliographic source knows.
  'lubimyczytac.pl': { host: 'lubimyczytac.pl', path: '/ksiazka/' },
};
const norm = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const foreignLanguageMarker =
  /\b(?:english|angielski|anglojęzyczn|po angielsku|wersja angielska|wydanie angielskie|original language|deutsch|german|niemieck|français|french|francusk|español|spanish|hiszpańsk|italiano|italian|włoski|russian|rosyjsk|ukrainian|ukraińsk|magyar|hungarian|węgiersk|gyülekező|válka|kniha|knihy|bøger|kirjat|kezdetek|drakono|medžioklė|kniga|livre|libro|libri|livros)\b|[őűøčšž]|\[(?:eng|en|de|fr|es|it|ru|uk|hu)\]|\((?:eng|en|de|fr|es|it|ru|uk|hu)\)/i;
export function isPolishBook(title, metadata) {
  const text = String(title || '').trim(),
    language = String(metadata?.language ?? metadata?.lang ?? '').trim();
  if (!text || foreignLanguageMarker.test(text)) return false;
  if (language && !/^(?:pl|pol|polish|polski|język polski)$/i.test(language)) return false;
  if (
    /\b(?:język polski|polska wersja|po polsku|wydanie polskie|polski|polska|polskie)\b/i.test(
      text,
    ) ||
    /[ąćęłńóśźż]/i.test(text)
  )
    return true;
  return true; // A title alone cannot establish a foreign edition.
}
/** Why a listing is left out before it is saved: 'language', 'product' (not a book) or 'topic'; null when kept. */
export function rejectionReason(task, title, metadata) {
  // Vinted listings are decided after their page is read (language field, free delivery):
  // a foreign book with free delivery is kept (filterVintedPolishOffers in scan-engine.mjs).
  if (task.language === 'pl' && task.source !== 'Vinted' && !isPolishBook(title, metadata))
    return 'language';
  if (excludesProduct(title)) return 'product';
  // A category read keeps every book: the scan matches the phrases afterwards (readCategorySource).
  if (task.mode === 'category') return null;
  // Empik searches series and descriptions inside its book category: a Black Library novel
  // ("Kosmiczny Wilk. Tom 1") found for "warhammer" rarely names the universe in its title.
  // Its own fantasy / SF genre is trusted; other genres must still name the topic.
  if (task.source === 'Empik' && /^Książki\/Fantastyka/i.test(String(metadata?.category ?? '')))
    return null;
  // Tezeusz is read by author page: every listing there is by the author the phrase names.
  if (task.source === 'Tezeusz.pl') return null;
  if (!matchesTopic(task, title)) return 'topic';
  return null; // Matching query + product exclusions; no mandatory generic book keyword.
}
export function acceptsBook(task, title, metadata) {
  return rejectionReason(task, title, metadata) === null;
}
// Availability as Empik tiles (data-availabilityType) and schema.org write it: true / false / null (not said).
export function sourceAvailable(code) {
  const text = String(code || '');
  if (!text) return null;
  if (
    /UNAVAILABLE|NOT_AVAILABLE|OUT_OF_STOCK|OutOfStock|SOLD_OUT|SoldOut|Discontinued|NOTIFY|ARCHIV/i.test(
      text,
    )
  )
    return false;
  if (
    /^IN_|AVAILABLE|PRE_SALE|PreOrder|PreSale|InStock|LimitedAvailability|OnlineOnly|InStoreOnly/i.test(
      text,
    )
  )
    return true;
  return null;
}
// Sources whose results can be sorted newest first (checked on the live page 2026-11-10). The quick
// scan reads one such page per phrase; other sources only offer their default order.
export const NEWEST_ORDER_SOURCES = new Set(['Vinted']);
// Tezeusz forbids its search address in robots.txt (Disallow: /szukaj?), so a phrase is read as
// the author page /autor/<slug>, which is allowed. A phrase that names no author has no page (404)
// and brings nothing from Tezeusz. Pages that exist under another spelling of the name:
const TEZEUSZ_AUTHOR_ALIASES = { salvatore: 'r-a-salvatore', 'richard-knaak': 'richard-a-knaak' };
export function tezeuszAuthorSlug(query) {
  const slug = String(query ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return TEZEUSZ_AUTHOR_ALIASES[slug] ?? slug;
}
const pageParameter = (source) =>
  source === 'Allegro'
    ? 'p'
    : source === 'Empik'
      ? 'start'
      : source === 'Tezeusz.pl'
        ? 'strona'
        : 'page';

export function searchUrl(task) {
  if (!sources[task.source] || task.host !== sources[task.source].host)
    throw Error('UNTRUSTED_MARKETPLACE_TASK');
  if (isCategorySource(task.source)) {
    if (task.mode !== 'category') throw Error('CATEGORY_SOURCE_NEEDS_CATEGORY');
    return categoryPageUrl(task);
  }
  const query = queryText(task);
  if (task.source === 'Vinted') {
    const u = new URL('https://www.vinted.pl/catalog/2312-books');
    u.searchParams.set('search_text', query);
    // Quick scan: only the newest listings (one page), see scan mode 'newest'.
    if (task.order === 'newest') u.searchParams.set('order', 'newest_first');
    if (task.paginationVersion === 1) {
      if (!Number.isInteger(task.page) || task.page < 1 || task.page > 10000)
        throw Error('INVALID_VINTED_PAGE');
      u.searchParams.set('page', String(task.page));
    }
    return u.href;
  }
  if (
    task.paginationVersion === 1 &&
    (!Number.isInteger(task.page) || task.page < 1 || task.page > 10000)
  )
    throw Error('INVALID_MARKETPLACE_PAGE');
  if (task.source === 'Skupszop.pl') {
    // The request the shop's own search page sends (read in the browser, 2026-11-16).
    const api = new URL('https://skupszop.pl/api/search/listing');
    api.searchParams.set('nodeId', '');
    api.searchParams.set('routeName', 'listing.search');
    api.searchParams.set('page', String(task.paginationVersion === 1 ? task.page : 1));
    api.searchParams.set('perPage', '28');
    api.searchParams.set('filters[keyword]', query);
    return api.href;
  }
  let u;
  if (task.source === 'Allegro') {
    u = new URL('https://allegro.pl/listing');
    u.searchParams.set('string', task.mode === 'watchlist' ? query : query + ' książki');
  } else if (task.source === 'Empik') {
    // Category "Książki" (31): Polish books only. The whole-shop search returned figurines, video
    // games and "Książki obcojęzyczne", which no Polish bibliographic source can identify.
    u = new URL('https://www.empik.com/ksiazki,31,s');
    u.searchParams.set('q', query);
    u.searchParams.set('qtype', 'basicForm');
  } else if (task.source === 'Allegro Lokalnie')
    u = new URL(
      'https://allegrolokalnie.pl/oferty/q/' +
        encodeURIComponent(task.mode === 'watchlist' ? query : query + ' książki'),
    );
  else if (task.source === 'OLX')
    u = new URL('https://www.olx.pl/muzyka-edukacja/ksiazki/q-' + encodeURIComponent(query) + '/');
  else if (task.source === 'Tezeusz.pl') {
    const slug = tezeuszAuthorSlug(query);
    if (!slug) throw Error('INVALID_MARKETPLACE_QUERY');
    u = new URL('https://tezeusz.pl/autor/' + slug);
  } else {
    u = new URL('https://dedalus.pl/s');
    u.searchParams.set('q', query);
  }
  if (task.paginationVersion === 1 && task.page > 1)
    u.searchParams.set(
      pageParameter(task.source),
      String(task.source === 'Empik' ? (task.page - 1) * 60 + 1 : task.page),
    );
  return u.href;
}
export function retryAfterSeconds(header, now = Date.now()) {
  const text = String(header || '').trim(),
    seconds = /^\d+$/.test(text) ? Number(text) : (Date.parse(text) - now) / 1000;
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(86400, Math.max(30, Math.ceil(seconds)))
    : 30;
}
export function sourceChallenge(html) {
  // Embedded form integrations are not access challenges. Inspect visible markup,
  // while retaining explicit challenge-provider endpoints even inside scripts.
  const markup = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  return (
    /verify (?:that )?you are human|access denied|just a moment\.\.\.|attention required|<title>[^<]*(?:captcha|verification)|potwierd[zź],? [zż]e jeste[sś] cz[lł]owiekiem/i.test(
      markup,
    ) ||
    /\/cdn-cgi\/challenge-platform\/(?!scripts\/jsd\/)|(?:geo\.)?captcha-delivery\.com\/(?:captcha|interstitial)\/|ct\.captcha-delivery\.com\/c\.js|\bvar\s+dd\s*=\s*\{[^}]*['"]?host['"]?\s*:\s*['"]geo\.captcha-delivery\.com/i.test(
      html,
    ) ||
    (html.length < 100000 && /captcha|datadome.*challenge/i.test(markup))
  );
}
async function readBody(response, limit = 4000000) {
  // Antykwariat NWS answers in ISO-8859-2 ("charset=latin2"); the rest in UTF-8.
  const charset = /charset=["']?([\w-]+)/i.exec(response.headers?.get?.('content-type') || '')?.[1];
  let decoder;
  try {
    decoder = new TextDecoder(charset || 'utf-8');
  } catch {
    decoder = new TextDecoder();
  }
  if (!response.body) return '';
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error('SOURCE_TOO_LARGE');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return decoder.decode(buffer);
}
export async function readSourceHtml(
  raw,
  {
    fetcher = fetch,
    source,
    pause = wait,
    now = Date.now,
    gate = sharedMarketplaceGate,
    signal = null,
  } = {},
) {
  const config = sources[source];
  if (!config) throw Error('UNTRUSTED_MARKETPLACE_TASK');
  const allowed = (h) => h === config.host || h === config.host.replace(/^www\./, '');
  let url = new URL(raw);
  // Skupszop answers its list API in JSON; its product pages and every other source are HTML.
  const json = source === 'Skupszop.pl' && url.pathname.startsWith('/api/');
  for (let hop = 0; hop < 4; hop++) {
    if (
      url.protocol !== 'https:' ||
      !allowed(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      throw Error('UNSAFE_SOURCE_REDIRECT');
    // Provider cooldown can outlive the HTTP timeout; count only the actual request.
    await gate.acquire(source, { now, pause, signal });
    const requestTimeout = AbortSignal.timeout(18000);
    const requestSignal = signal ? AbortSignal.any([signal, requestTimeout]) : requestTimeout;
    const response = await fetcher(url, {
      headers: {
        Accept: json ? 'application/json' : 'text/html',
        'User-Agent': 'BookFlip/1.0 (book price comparison)',
      },
      redirect: 'manual',
      signal: requestSignal,
    });
    if ([403, 429].includes(response.status)) {
      const retryAfter = retryAfterSeconds(response.headers.get('retry-after'), now());
      gate.cooldown(source, retryAfter, { now });
      // Adaptive pace: a refusal doubles this source's gap between requests (see marketplace-gate).
      gate.slowDown?.(source);
      let html;
      try {
        html = await readBody(response, 100000);
      } catch {
        if (response.status === 403)
          throw Object.assign(Error('SOURCE_FORBIDDEN_UNREADABLE'), {
            blocked: true,
            status: 403,
            retryAfter,
          });
        html = '';
      }
      // A bot check answered with 403 or 429 (Allegro Lokalnie) is a block, not a rate limit:
      // retrying it only lengthens the scan. BookFlip does not get around such checks.
      if (sourceChallenge(html))
        throw Object.assign(Error('SOURCE_CAPTCHA'), {
          blocked: true,
          status: response.status,
          retryAfter,
        });
      // CloudFront's refusal page (OLX) rejects automated requests outright: no retry either.
      // Other 403s may be a temporary throttle (Vinted) and stay retryable.
      if (response.status === 403 && /The request could not be satisfied/i.test(html))
        throw Object.assign(Error('SOURCE_HTTP_403'), { status: 403, blocked: true, retryAfter });
      throw Object.assign(Error('SOURCE_HTTP_' + response.status), {
        status: response.status,
        blocked: false,
        retryable: true,
        retryAfter,
      });
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw Error('SOURCE_REDIRECT_MISSING');
      url = new URL(location, url);
      // Dedalus sends every request to /captcha.php: that is a bot check, not a page to read.
      if (/captcha|challenge/i.test(url.pathname))
        throw Object.assign(Error('SOURCE_CAPTCHA'), { blocked: true, status: response.status });
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      const retryable =
        response.status === 408 || response.status === 425 || response.status >= 500;
      if (retryable) {
        const cooldown = retryAfterSeconds(response.headers.get('retry-after'), now());
        gate.cooldown(source, cooldown, { now });
      }
      throw Object.assign(Error('SOURCE_HTTP_' + response.status), {
        status: response.status,
        retryable,
        ...(retryable
          ? { retryAfter: retryAfterSeconds(response.headers.get('retry-after'), now()) }
          : {}),
      });
    }
    if (
      !(json ? /application\/json/i : /text\/html|application\/xhtml/i).test(
        response.headers.get('content-type') || '',
      )
    ) {
      await response.body?.cancel();
      throw Error('SOURCE_NOT_HTML');
    }
    const html = await readBody(response);
    if (sourceChallenge(html)) {
      gate.slowDown?.(source);
      throw Object.assign(Error('SOURCE_CAPTCHA'), { blocked: true, status: response.status });
    }
    gate.speedUp?.(source);
    return html;
  }
  throw Error('SOURCE_REDIRECT_LIMIT');
}
export function parseMarketplace(
  html,
  task,
  observedAt = new Date().toISOString(),
  limit = 20,
  rejected = {},
) {
  searchUrl(task);
  // Listings left out before saving are counted by reason, for the scan summary.
  const reject = (reason) => {
    rejected[reason] = (rejected[reason] || 0) + 1;
  };
  const book = {
    accept: (title, metadata) => {
      const reason = rejectionReason(task, title, metadata);
      if (reason) reject(reason);
      return reason === null;
    },
    reject,
  };
  let rows;
  try {
    if (task.source === 'Vinted') rows = parseVinted(html, book, observedAt);
    else if (task.source === 'Allegro Lokalnie') rows = parseAllegroListing(html, book, observedAt);
    else if (['Tezeusz.pl', 'Dedalus.pl', 'Allegro', 'Empik'].includes(task.source))
      rows = parseBookstore(html, book, task.source);
    else if (isCategorySource(task.source)) rows = parseCategoryPage(html, task.source, book);
    else if (task.source === 'Skupszop.pl') rows = parseSkupszop(html, book);
    else {
      let recognized = false;
      for (const m of html.matchAll(
        /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
      )) {
        try {
          const d = JSON.parse(m[1]);
          if (Array.isArray(d.offers?.offers)) recognized = true;
        } catch {}
      }
      if (!recognized) throw Error('UNRECOGNIZED_MARKETPLACE_DATA');
      rows = parseOlx(html, book, observedAt);
    }
  } catch (e) {
    if (e.message === 'UNRECOGNIZED_MARKETPLACE_DATA') throw e;
    throw Error('UNRECOGNIZED_MARKETPLACE_DATA');
  }
  const out = [],
    seen = new Set();
  for (const row of rows) {
    if (row.available === false && row.availabilityKnown !== false) continue;
    let u;
    try {
      u = new URL(row.url);
    } catch {
      continue;
    }
    if (
      u.protocol !== 'https:' ||
      ![task.host, task.host.replace(/^www\./, '')].includes(u.hostname) ||
      u.username ||
      u.password ||
      u.port ||
      (sources[task.source].path && !u.pathname.startsWith(sources[task.source].path)) ||
      (['Tezeusz.pl', 'Dedalus.pl', 'Allegro', 'Empik'].includes(task.source) &&
        /^\/(?:szukaj|s|do-koszyka|do-schowka|koszyk|logowanie|info|tanie-ksiazki(?=\/?$))(?:\/|$)/i.test(
          u.pathname,
        ))
    )
      continue;
    if (task.source === 'Vinted' && !/^\/items\/\d+/.test(u.pathname)) continue;
    u.search = '';
    u.hash = '';
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    const price = Math.round(row.price * 100);
    if (!Number.isSafeInteger(price) || price <= 0 || price > 100000000) continue;
    const buyerFee = grosze(row.buyerFee);
    out.push({
      ...bibliographicMetadata(row),
      ...observationFields({ ...row, buyerFee }),
      ...(row.raw && typeof row.raw === 'object' ? { rawListing: row.raw } : {}),
      ...(typeof row.listingDescription === 'string' && row.listingDescription
        ? { listingDescription: row.listingDescription.slice(0, 8000) }
        : {}),
      ...(typeof row.externalOfferId === 'string' && /^\d{1,20}$/.test(row.externalOfferId)
        ? { externalOfferId: row.externalOfferId }
        : {}),
      title: row.title.slice(0, 500),
      url: u.href,
      price,
      ...(safeImageUrl(row.image) ? { image: safeImageUrl(row.image) } : {}),
      observedAt,
      activeConfirmed: false,
      priceConfirmed: false,
      availability: 'unconfirmed',
      priceEvidence: 'marketplace_listing',
    });
    if (out.length === limit) break;
  }
  return out;
}
function parseEmpikCards(html, add) {
  const starts = [...html.matchAll(/<div\b([^>]*)>/gi)].filter((match) => {
    const classes = attribute(match[1], 'class').split(/\s+/);
    return classes.includes('search-list-item') && classes.includes('ta-product-tile');
  });
  if (!starts.length) {
    const recognized = [...html.matchAll(/<div\b([^>]*)>/gi)].some((match) => {
      const classes = attribute(match[1], 'class').split(/\s+/);
      return (
        classes.includes('search-content') &&
        classes.includes('js-search-content') &&
        attribute(match[1], 'itemtype') === 'https://schema.org/ItemList'
      );
    });
    return recognized ? [] : null;
  }
  for (let index = 0; index < starts.length; index++) {
    const root = starts[index],
      attrs = root[1],
      end = Math.min(starts[index + 1]?.index ?? html.length, root.index + 50000),
      segment = html.slice(root.index, end),
      productId = attribute(attrs, 'data-product-id');
    // Newer products are "p1730634714"; older catalogue entries (often second-hand copies sold by
    // Empik's partner bookshops) keep a plain number: ",301657,ksiazka-p".
    if (!/^p?\d+$/.test(productId)) continue;
    let title = textOnly(attribute(attrs, 'data-product-name'));
    if (!title) {
      for (const match of segment.matchAll(/<strong\b([^>]*)>([\s\S]*?)<\/strong>/gi)) {
        if (attribute(match[1], 'itemprop') === 'name') {
          title = textOnly(match[2]);
          break;
        }
      }
    }
    let rawUrl = '';
    for (const match of segment.matchAll(/<a\b([^>]*)>/gi)) {
      const candidate = attribute(match[1], 'href'),
        id = attribute(match[1], 'data-product-id');
      if (id && id !== productId) continue;
      let url;
      try {
        url = new URL(candidate, 'https://www.empik.com');
      } catch {
        continue;
      }
      const pathId = url.pathname.match(/,(p?\d+),ksiazka-p$/i)?.[1];
      if (pathId && pathId === productId) {
        rawUrl = url.href;
        break;
      }
    }
    const priceTag = [...segment.matchAll(/<(?:meta|div|span)\b([^>]*)>/gi)].find(
        (match) => attribute(match[1], 'itemprop') === 'price',
      ),
      price = attribute(priceTag?.[1], 'content'),
      declared = attribute(attrs, 'data-product-price');
    const currencyTag = [...segment.matchAll(/<meta\b([^>]*)>/gi)].find(
        (match) => attribute(match[1], 'itemprop') === 'priceCurrency',
      ),
      currency = attribute(currencyTag?.[1], 'content');
    const numeric = Number(String(price).replace(',', '.')),
      declaredNumeric = declared ? Number(declared.replace(',', '.')) : numeric;
    if (
      !rawUrl ||
      !price ||
      currency !== 'PLN' ||
      !Number.isFinite(numeric) ||
      !Number.isFinite(declaredNumeric) ||
      Math.abs(numeric - declaredNumeric) > 0.001
    )
      continue;
    const imageTag = [...segment.matchAll(/<img\b([^>]*)>/gi)].find((match) =>
      safeImageUrl(attribute(match[1], 'lazy-img') || attribute(match[1], 'src')),
    );
    // Availability of this tile ("IN_24_H", "PRE_SALE"…) and who sells it: Empik itself (merchant 0)
    // or a marketplace shop, often an antiquarian bookshop with second-hand copies.
    const availabilityTag = [...segment.matchAll(/<div\b([^>]*)>/gi)].find((match) =>
        attribute(match[1], 'class').split(/\s+/).includes('info__availability'),
      ),
      availabilityType = attribute(availabilityTag?.[1], 'data-availabilityType'),
      merchantId = attribute(attrs, 'data-merchant-id'),
      merchantName = textOnly(attribute(attrs, 'data-merchant-name'));
    add(title, rawUrl, price, currency, {
      isbn: attribute(attrs, 'data-product-ean') || attribute(attrs, 'data-ean'),
      category: attribute(attrs, 'data-product-category'),
      image: imageTag && (attribute(imageTag[1], 'lazy-img') || attribute(imageTag[1], 'src')),
      availability: availabilityType,
      sellerId: /^\d{1,20}$/.test(merchantId) ? merchantId : null,
      sellerName: merchantName || null,
      raw: {
        productId,
        availabilityType: availabilityType || null,
        delivery: attribute(attrs, 'data-delivery') || null,
        merchantId: merchantId || null,
        merchantName: merchantName || null,
        outlet: /\bribbon--outlet\b/.test(segment),
        category: attribute(attrs, 'data-product-category') || null,
        price: declared || price,
        discount: attribute(attrs, 'data-product-discount') || null,
      },
    });
  }
  return true;
}
const SKUPSZOP_CONDITION = {
  nowa: 'new',
  'jak nowa': 'very_good',
  dobry: 'good',
  'widoczne ślady używania': 'satisfactory',
};
function skupszopData(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw Error('UNRECOGNIZED_MARKETPLACE_DATA');
  }
  if (body?.success !== true || !Array.isArray(body.data?.data))
    throw Error('UNRECOGNIZED_MARKETPLACE_DATA');
  return body.data;
}
// Skupszop.pl: one row per book — the copy the shop lists first (its `price` and `condition`).
// Every book has an ISBN; the other conditions and their prices go into the description, because
// all variants share one address.
function parseSkupszop(text, book) {
  const rows = [];
  for (const item of skupszopData(text).data) {
    const name = String(item?.name || '').trim(),
      author = String(item?.author_raw || '').trim(),
      title = [name, author].filter(Boolean).join(' - '),
      price = Number(item?.price);
    if (!name || !item.url || !(price > 0) || !book.accept(title)) continue;
    const condition = String(item.condition || '').trim();
    const variants = (Array.isArray(item.variants) ? item.variants : [])
      .filter((v) => v && v.condition && Number(v.price) > 0)
      .map(
        (v) => `${v.condition}: ${Number(v.price).toFixed(2)} zł (${Number(v.quantity) || 0} szt.)`,
      );
    const isbn = String(item.isbn || '').trim();
    rows.push({
      title,
      url: String(item.url),
      price,
      available: item.is_available !== false,
      availabilityKnown: true,
      sellerBusiness: true,
      ...(typeof item.cover === 'string' ? { image: item.cover } : {}),
      ...(/^[\dXx-]{10,17}$/.test(isbn) ? { isbn } : {}),
      ...(author ? { author: author.slice(0, 500) } : {}),
      ...(item.publisher?.name ? { publisher: String(item.publisher.name).slice(0, 500) } : {}),
      ...(item.binding ? { binding: String(item.binding).slice(0, 100) } : {}),
      ...(condition
        ? {
            conditionText: condition.slice(0, 200),
            conditionClass: SKUPSZOP_CONDITION[condition.toLowerCase()] || 'unknown',
          }
        : {}),
      ...(variants.length || item.release_date
        ? {
            listingDescription: [
              item.release_date ? `Rok wydania: ${item.release_date}` : '',
              variants.length ? 'Stany i ceny: ' + variants.join('; ') : '',
            ]
              .filter(Boolean)
              .join('\n'),
          }
        : {}),
    });
  }
  return rows;
}
function parseBookstore(html, book, source) {
  const host = sources[source].host,
    rows = [],
    seen = new Set();
  const add = (title, rawUrl, price, currency = 'PLN', metadata = {}) => {
    let url;
    try {
      url = new URL(rawUrl, 'https://' + host);
    } catch {
      return;
    }
    if (source === 'Allegro' && !/^\/oferta\/[^/]+-\d+$/.test(url.pathname)) return;
    if (source === 'Empik' && !/,p?\d+,ksiazka-p$/.test(url.pathname)) return;
    if (
      url.protocol !== 'https:' ||
      url.hostname !== host ||
      url.port ||
      url.username ||
      url.password ||
      /^\/(?:szukaj|s|do-koszyka|do-schowka|koszyk|logowanie|info|tanie-ksiazki(?=\/?$))(?:\/|$)/i.test(
        url.pathname,
      ) ||
      !title ||
      !book.accept(title, metadata.category ? { category: metadata.category } : undefined) ||
      currency !== 'PLN'
    )
      return;
    const amount = Number(String(price).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return;
    url.search = '';
    url.hash = '';
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const isbn = extractOfferISBN(metadata).isbn;
    const image = safeImageUrl(metadata.image);
    // The shop's own availability when it states one; a shop listing without it is taken as on sale.
    const availabilityCode =
      typeof metadata.availability === 'string'
        ? metadata.availability.replace(/^https?:\/\/schema\.org\//, '')
        : '';
    const available = sourceAvailable(availabilityCode);
    rows.push({
      title,
      url: url.href,
      price: amount,
      available: available !== false,
      ...(available === null ? {} : { availabilityKnown: true }),
      ...(availabilityCode ? { sourceAvailability: availabilityCode.slice(0, 100) } : {}),
      ...(metadata.sellerId ? { sellerId: metadata.sellerId, sellerBusiness: true } : {}),
      ...(metadata.sellerName ? { sellerName: metadata.sellerName } : {}),
      ...(metadata.raw ? { raw: metadata.raw } : {}),
      ...(isbn ? { isbn } : {}),
      ...(image ? { image } : {}),
    });
  };
  // Tezeusz cards contain variant counts and old prices; read only the
  // current-price element within the same product anchor.
  if (source === 'Tezeusz.pl' && /tezeusz-product-card/.test(html)) {
    for (const m of html.matchAll(
      /<a\b([^>]*\bclass=["'][^"']*\btezeusz-product-card\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi,
    )) {
      const href = m[1].match(/\bhref=["']([^"']+)["']/i)?.[1],
        card = m[2];
      const title = card.match(/<img\b[^>]*\balt=["']([^"']+)["']/i)?.[1];
      const price = card.match(
        /<div\b[^>]*\bclass=["']tezeusz-product-card-price["'][^>]*>\s*([^<]+)/i,
      )?.[1];
      const amount =
        price && textOnly(price).match(/^(\d+(?:[ \u00a0]\d{3})*(?:[,.]\d{2})?)\s*(?:zł|PLN)$/i);
      // Non-greedy: the onerror handler also contains "this.src='…placeholder…'".
      const image = card.match(/<img\b[^>]*?\ssrc=["']([^"']+)["']/i)?.[1];
      if (href && title && amount)
        add(textOnly(title), decodeHtml(href), amount[1], 'PLN', { image: decodeHtml(image) });
    }
    return rows;
  }
  if (
    source === 'Dedalus.pl' &&
    /Niestety, nie znaleźliśmy produktów, których szukasz\./i.test(textOnly(html))
  )
    return rows;
  if (source === 'Empik') {
    const cards = parseEmpikCards(html, add);
    if (cards !== null) return rows;
  }
  const products = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const type = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    if (type.some((x) => ['Product', 'Book'].includes(x))) products.push(node);
    for (const k of ['@graph', 'itemListElement', 'item']) visit(node[k]);
  };
  for (const m of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  ))
    try {
      // Dedalus emits literal newlines inside JSON-LD descriptions. Escape only
      // control characters inside strings; never evaluate page JavaScript.
      const json =
        source === 'Dedalus.pl'
          ? m[1].replace(/"(?:[^"\\]|\\[\s\S])*"/g, (value) =>
              value.replace(
                /[\u0000-\u001f]/g,
                (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
              ),
            )
          : m[1];
      visit(JSON.parse(json));
    } catch {}
  for (const p of products) {
    const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
    if (!offer || offer['@type'] === 'AggregateOffer') continue;
    const price = offer.price ?? offer.lowPrice,
      currency = offer.priceCurrency || 'PLN';
    if (offer.lowPrice != null && offer.price == null) continue;
    add(p.name || p.title, offer.url || p.url || p['@id'], price, currency, {
      ...p,
      availability: offer.availability,
    });
  }
  if (['Allegro', 'Empik'].includes(source)) {
    if (!products.length) throw Error('UNRECOGNIZED_MARKETPLACE_DATA');
    return rows;
  }
  if (rows.length || products.length) return rows;
  const anchors = [
    ...html.matchAll(/<a\b([^>]*\bhref=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi),
  ].filter((m) => {
    try {
      const u = new URL(decodeHtml(m[2]), 'https://' + host);
      return (
        u.hostname === host &&
        /^https?:$/.test(u.protocol) &&
        !/^\/(?:szukaj|s|do-koszyka|do-schowka|koszyk|logowanie|info|tanie-ksiazki(?=\/?$))(?:\/|$)/i.test(
          u.pathname,
        )
      );
    } catch {
      return false;
    }
  });
  if (!anchors.length) throw Error('UNRECOGNIZED_MARKETPLACE_DATA');
  const seenUrls = new Set();
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i],
      url = decodeHtml(a[2]);
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    let next = i + 1;
    while (next < anchors.length && decodeHtml(anchors[next][2]) === url) next++;
    const segment = html.slice(
        a.index,
        anchors[next]?.index ?? Math.min(html.length, a.index + 5000),
      ),
      attrs = a[1];
    let title =
      attrs.match(/\btitle=["']([^"']+)["']/i)?.[1] ||
      attrs.match(/\baria-label=["']([^"']+)["']/i)?.[1] ||
      a[3].match(/<img\b[^>]*\balt=["']([^"']+)/i)?.[1] ||
      textOnly(a[3]);
    title = textOnly(title);
    if (!title) continue;
    let price = null,
      currency = 'PLN';
    const micro =
      segment.match(/itemprop=["']price["'][^>]*content=["']([^"']+)/i) ||
      segment.match(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i);
    if (micro) price = micro[1];
    if (price == null) {
      const match = textOnly(segment).match(
        /(?:^|\s)(\d{1,5}(?:[\s\u00a0]\d{3})*(?:[,.]\d{2})?)\s*(?:zł|PLN)(?:\s|$)/i,
      );
      if (match) price = match[1];
    }
    if (price != null) add(title, url, price, currency);
  }
  if (
    !rows.length &&
    /<(?:article|li|div)\b[^>]*(?:product|product-item|productbox|search-product)/i.test(html)
  )
    return rows;
  if (!rows.length) throw Error('UNRECOGNIZED_MARKETPLACE_DATA');
  return rows;
}
export function vintedPageInfo(html, task) {
  const page = task.page || 1,
    data = rscText(html),
    ids = [];
  for (const m of data.matchAll(/"productItem"\s*:\s*\{/g)) {
    const p = objectAt(data, m.index + m[0].length - 1);
    if (p?.url) ids.push(p.url);
  }
  const digest = createHash('sha256')
    .update(JSON.stringify([...new Set(ids)]))
    .digest('hex');
  for (const m of data.matchAll(/"pagination"\s*:\s*\{/g)) {
    const p = objectAt(data, m.index + m[0].length - 1);
    if (!p) continue;
    const current = p.currentPage ?? p.current_page,
      total = p.totalPages ?? p.total_pages;
    if (Number.isInteger(current) && Number.isInteger(total) && current > 0 && total >= current) {
      if (current !== page) throw Error('VINTED_PAGE_NOT_MATCHED');
      return {
        page,
        digest,
        state: current < total ? 'more' : 'end',
        nextPage: current < total ? current + 1 : null,
        totalPages: total,
      };
    }
  }
  const current = new URL(searchUrl(task));
  for (const m of html.matchAll(/<(?:a|link)\b([^>]*)>/gi)) {
    const attrs = m[1];
    if (!/\bnext\b|nast[eę]pn/i.test(attrs) || /aria-disabled=["']true|\bdisabled\b/i.test(attrs))
      continue;
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      const u = new URL(href.replace(/&amp;/g, '&'), current);
      if (
        u.origin === current.origin &&
        u.pathname === current.pathname &&
        u.searchParams.get('search_text') === current.searchParams.get('search_text') &&
        Number(u.searchParams.get('page')) === page + 1
      )
        return { page, digest, state: 'more', nextPage: page + 1 };
    } catch {}
  }
  return { page, digest, state: 'unknown', nextPage: null };
}
export function marketplacePageInfo(html, task, offers) {
  if (task.source === 'Vinted') return vintedPageInfo(html, task);
  if (isCategorySource(task.source)) return categoryPageInfo(html, task, offers);
  const current = new URL(searchUrl(task)),
    page = task.page || 1;
  const digest = createHash('sha256')
    .update(JSON.stringify(offers.map((o) => o.url)))
    .digest('hex');
  if (task.source === 'Skupszop.pl') {
    // The answer lists the page numbers that exist.
    const pages = skupszopData(html).pages;
    if (!Array.isArray(pages)) return { page, digest, state: 'unknown', nextPage: null };
    return pages.includes(page + 1)
      ? { page, digest, state: 'more', nextPage: page + 1 }
      : { page, digest, state: 'end', nextPage: null };
  }
  let ended = false;
  for (const m of html.matchAll(/<(?:a|link|button)\b([^>]*)>([^<]*)/gi)) {
    const attrs = m[1],
      label = m[2];
    if (
      !/\brel=["'][^"']*\bnext\b|\baria-label=["'][^"']*(?:next|nast[eę]pn)/i.test(attrs) &&
      !/^\s*(?:next|nast[eę]pn)/i.test(label) &&
      !(task.source === 'Empik' && attribute(attrs, 'class').split(/\s+/).includes('ta-next-page'))
    )
      continue;
    if (/aria-disabled=["']true|\bdisabled(?:[\s=>]|$)/i.test(attrs)) {
      ended = true;
      continue;
    }
    const href = attrs.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      const u = new URL(href.replace(/&amp;/g, '&'), current),
        parameter = pageParameter(task.source),
        rawNext = Number(u.searchParams.get(parameter)),
        next = task.source === 'Empik' ? (rawNext - 1) / 60 + 1 : rawNext;
      u.searchParams.delete(parameter);
      const base = new URL(current);
      base.searchParams.delete(parameter);
      let sameQuery = true;
      if (task.source === 'Empik') {
        sameQuery =
          norm(u.searchParams.get('q')) === norm(base.searchParams.get('q')) &&
          String(u.searchParams.get('qtype') || '').trim() ===
            String(base.searchParams.get('qtype') || '').trim();
        u.searchParams.delete('q');
        u.searchParams.delete('qtype');
        base.searchParams.delete('q');
        base.searchParams.delete('qtype');
      }
      u.searchParams.sort();
      base.searchParams.sort();
      if (!u.username && !u.password && sameQuery && u.href === base.href && next === page + 1)
        return { page, digest, state: 'more', nextPage: next };
    } catch {}
  }
  // Empik draws its pager with JavaScript: a full page of 60 tiles means there is another one.
  if (task.source === 'Empik' && !ended && (html.match(/\bta-product-tile\b/g) || []).length >= 60)
    return { page, digest, state: 'more', nextPage: page + 1 };
  // Tezeusz author pages name the next one in <link rel="next">; the last page has none.
  if (task.source === 'Tezeusz.pl' && offers.length) ended = true;
  return { page, digest, state: ended ? 'end' : 'unknown', nextPage: null };
}
export async function scanMarketplace(task, options = {}) {
  let html;
  try {
    html = await readSourceHtml(searchUrl(task), { ...options, source: task.source });
  } catch (error) {
    // No author page for this phrase: nothing to read, not a failure. The state stays "unknown",
    // so offers found earlier by this phrase are not concluded to be gone.
    if (task.source !== 'Tezeusz.pl' || error?.message !== 'SOURCE_HTTP_404') throw error;
    return {
      offers: [],
      rejected: {},
      pagination: { page: task.page || 1, state: 'unknown', nextPage: null, total: 0 },
      coverage: 'Tezeusz.pl: brak strony autora dla tej frazy.',
    };
  }
  const paginated = task.paginationVersion === 1;
  const rejected = {};
  const offers = parseMarketplace(
    html,
    task,
    new Date().toISOString(),
    paginated ? 5001 : 20,
    rejected,
  );
  if (offers.length > 5000) throw Error('MARKETPLACE_PAGE_TOO_LARGE');
  const pagination = paginated
    ? { ...marketplacePageInfo(html, task, offers), total: offers.length }
    : undefined;
  return {
    offers,
    rejected,
    pagination,
    coverage: paginated
      ? `${task.source}: strona ${task.page}, ${offers.length} pasujących wpisów. Cała odczytana strona zapisywana partiami. ${pagination.state === 'end' ? 'Źródło wskazało koniec wyników.' : pagination.state === 'more' ? 'Potwierdzono kolejną stronę.' : 'Nie rozpoznano kolejnej strony; zakres niepełny.'} Dostępność, wydanie i koszty wymagają sprawdzenia. Zmiany kolejności mogą powodować pominięcia.`
      : 'Jedna strona wyszukiwania, maksymalnie 20 kandydatów. Dostępność, cena szczegółowa, wydanie i koszty wymagają sprawdzenia. Zakres niepełny.',
  };
}
