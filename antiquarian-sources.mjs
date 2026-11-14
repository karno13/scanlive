// @ts-check
// Antiquarian bookshops read by category (docs/SOURCES-ACCESS-2026-11.md, „Antykwariaty internetowe”).
// Their search pages are forbidden by robots.txt or not needed, while the fantasy / SF category
// pages are allowed and small: the scan reads every page of a category once and filters the
// listings with the profile's phrases afterwards (scan-engine.mjs, readCategorySource), instead of
// one request per phrase. Requests go through readSourceHtml and the marketplace gate like any other.
import { createHash } from 'node:crypto';
import { attribute, decodeHtml, textOnly } from './html-text.mjs';
import { conditionClass } from './offer-observations.mjs';

/**
 * @typedef {object} AntiquarianRow
 * @property {string} title
 * @property {string} url
 * @property {number|string} price   Złoty as the shop writes it ("12.00", "10,00").
 * @property {boolean} available
 * @property {boolean} [availabilityKnown]
 * @property {string} [sourceAvailability]
 * @property {string} [image]
 * @property {string} [isbn]
 * @property {string} [publisher]
 * @property {string} [binding]
 * @property {string} [conditionText]
 * @property {string} [conditionClass]
 * @property {string} [listingDescription]
 * @property {string} [externalOfferId]
 * @property {boolean} sellerBusiness
 */
/** @typedef {{ accept: (title: string) => boolean }} BookFilter */
/**
 * @typedef {object} CategorySource
 * @property {string} host
 * @property {string[]} categories        Paths of the category first pages.
 * @property {number} perPage             Listings on a full page (a shorter page is the last one).
 * @property {(category: string, page: number) => string | null} pageUrl  Path of page N; null: only the link the shop prints.
 * @property {(url: URL, category: string) => number | null} pageNumber   Page of `url` within `category`, null if not one.
 * @property {RegExp} card                Marks each listing on a page (counted for the "full page" rule).
 * @property {(html: string, book: BookFilter, origin: string) => AntiquarianRow[]} parse
 */

const escapeRegExp = (/** @type {string} */ text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Category path with `?page=N` (PrestaShop, osCommerce). */
const queryPaging = {
  pageUrl: (/** @type {string} */ category, /** @type {number} */ page) =>
    page > 1 ? `${category}?page=${page}` : category,
  pageNumber: (/** @type {URL} */ url, /** @type {string} */ category) =>
    url.pathname === category ? Number(url.searchParams.get('page') || 1) || null : null,
};

/** "35,00 zł", "12.00 zł", "1 200,00 zł" → "35.00"; null when it is not a price. */
function priceText(/** @type {string} */ text) {
  const match = textOnly(text).match(/(\d{1,3}(?:[  ]\d{3})*|\d+)(?:[,.](\d{2}))?\s*(?:zł|PLN)/i);
  return match ? `${match[1].replace(/[  ]/g, '')}.${match[2] || '00'}` : null;
}

/** Listing fragments: from each start marker to the next one. */
function segments(/** @type {string} */ html, /** @type {RegExp} */ start) {
  const starts = [...html.matchAll(new RegExp(start.source, 'gi'))].map((m) => m.index ?? 0);
  return starts.map((at, i) => html.slice(at, starts[i + 1] ?? Math.min(html.length, at + 20000)));
}

function unrecognized() {
  return Error('UNRECOGNIZED_MARKETPLACE_DATA');
}

// BlackBooks.pl (Gdańsk, PrestaShop): title with author, price, image. ISBN and condition are on
// the product page only. Every listed product can be bought.
/** @type {CategorySource['parse']} */
function parseBlackBooks(html, book, origin) {
  const cards = segments(html, /<article\b[^>]*\bjs-product-miniature\b/);
  if (!cards.length) throw unrecognized();
  /** @type {AntiquarianRow[]} */
  const rows = [];
  for (const card of cards) {
    const link = card.match(/<h\d\b[^>]*product-title[^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    const title = textOnly(link?.[2]);
    const price = attribute(card.match(/<span\b([^>]*\bproduct-price\b[^>]*)>/i)?.[1], 'content');
    if (!link || !title || !price || !book.accept(title)) continue;
    const image = attribute(card.match(/<img\b([^>]*)>/i)?.[1], 'data-src');
    rows.push({
      title,
      url: new URL(attribute(link[1], 'href'), origin).href,
      price,
      available: true,
      sellerBusiness: true,
      ...(image ? { image } : {}),
      ...(attribute(card, 'data-id-product')
        ? { externalOfferId: attribute(card, 'data-id-product') }
        : {}),
    });
  }
  return rows;
}

/** "Wydawca: Ars Machina." lines of a Conroy description → { wydawca: 'Ars Machina', … }. */
function conroyFields(/** @type {string} */ text) {
  /** @type {Record<string, string>} */
  const fields = {};
  for (const line of text.split(/\n/)) {
    const match = line.match(/^\s*([A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż ]{2,30}):\s*(.+?)\.?\s*$/);
    if (match) fields[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return fields;
}

// Antykwariat Conroy (Kraków, osCommerce): the whole description is on the list — author and title,
// publisher, year, binding, ISBN, defects and condition. Product pages are not needed.
/** @type {CategorySource['parse']} */
function parseConroy(html, book, origin) {
  const cards = segments(html, /<div\b[^>]*class="item col-12"/);
  if (!cards.length) throw unrecognized();
  /** @type {AntiquarianRow[]} */
  const rows = [];
  for (const card of cards) {
    const href = card.match(/<a\b[^>]*href="([^"]*-p-\d+\.html)"/i)?.[1];
    const about = card.match(/<p\b[^>]*class="aboutProduct"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '';
    const description = decodeHtml(about.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
    // First line: Daniel Abraham "Smocza Droga". — the author's full name, which phrases name.
    const heading =
      description.split('\n')[0]?.trim().replace(/\.$/, '') ||
      textOnly(card.match(/<h4\b[^>]*titleProduct[^>]*>([\s\S]*?)<\/h4>/i)?.[1]);
    const price = priceText(card.match(/<span class="value">([\s\S]*?)<\/span>/i)?.[1] || '');
    if (!href || !heading || !price || !book.accept(heading)) continue;
    const fields = conroyFields(description);
    const state = fields.stan || '';
    const defects = fields.wady && !/^brak$/i.test(fields.wady) ? fields.wady : '';
    const condition = [state, defects && 'wady: ' + defects].filter(Boolean).join('; ');
    const image = card.match(/<img\b[^>]*\bsrc="([^"]+)"/i)?.[1];
    rows.push({
      title: heading,
      url: new URL(decodeHtml(href), origin).href,
      price,
      available: true,
      sellerBusiness: true,
      ...(image ? { image: new URL(decodeHtml(image), origin + '/').href } : {}),
      ...(fields.isbn ? { isbn: fields.isbn } : {}),
      ...(fields.wydawca ? { publisher: fields.wydawca.slice(0, 500) } : {}),
      ...(fields.oprawa ? { binding: fields.oprawa.slice(0, 100) } : {}),
      // The class follows the stated condition only: defects are listed even for good copies.
      ...(condition
        ? { conditionText: condition.slice(0, 200), conditionClass: conditionClass(state) }
        : {}),
      ...(description ? { listingDescription: description.slice(0, 8000) } : {}),
    });
  }
  return rows;
}

// Szarlatan (Wrocław, WooCommerce): "Author Title  catalogue-number." and a price; the stock state
// is a class of the list item.
/** @type {CategorySource['parse']} */
function parseSzarlatan(html, book, origin) {
  const cards = segments(html, /<li\b[^>]*\bclass="[^"]*\btype-product\b/);
  if (!cards.length) throw unrecognized();
  /** @type {AntiquarianRow[]} */
  const rows = [];
  for (const card of cards) {
    const classes = attribute(card.match(/^<li\b([^>]*)>/i)?.[1], 'class').split(/\s+/);
    const href = attribute(
      card.match(/<a\b([^>]*woocommerce-LoopProduct-link[^>]*)>/i)?.[1],
      'href',
    );
    const title = textOnly(
      card.match(/<h2\b[^>]*woocommerce-loop-product__title[^>]*>([\s\S]*?)<\/h2>/i)?.[1],
    ).replace(/\s+\d{3,}\.?$/, '');
    // A sale shows the old price in <del> and the current one in <ins>.
    const priceBox = card.match(/<span class="price">([\s\S]*?)<\/span>\s*<\/a>/i)?.[1] || '';
    const price = priceText(priceBox.match(/<ins\b[^>]*>([\s\S]*?)<\/ins>/i)?.[1] || priceBox);
    if (!href || !title || !price || !book.accept(title)) continue;
    const img = card.match(/<img\b([^>]*)>/i)?.[1];
    // Lazy images: a .svg placeholder in src, the photo in data-tf-src.
    const image = [attribute(img, 'data-tf-src'), attribute(img, 'src')].find(
      (src) => /^https:\/\//.test(src) && !/\.svg$/i.test(src),
    );
    const inStock = classes.includes('instock'),
      outOfStock = classes.includes('outofstock');
    rows.push({
      title,
      url: new URL(href, origin).href,
      price,
      available: !outOfStock,
      ...(inStock || outOfStock ? { availabilityKnown: true } : {}),
      sellerBusiness: true,
      ...(image ? { image } : {}),
    });
  }
  return rows;
}

// Stara Dobra Książka (Gdynia, RedCart): "TITLE - Author", price and stock; a sold copy stays on
// the list without a price and with „Egzemplarz sprzedany”.
/** @type {CategorySource['parse']} */
function parseStaraDobraKsiazka(html, book, origin) {
  const cards = segments(html, /<article\b[^>]*\bproduct-inside\b/);
  if (!cards.length) throw unrecognized();
  /** @type {AntiquarianRow[]} */
  const rows = [];
  for (const card of cards) {
    const url = attribute(card.match(/^<article\b([^>]*)>/i)?.[1], 'data-url');
    const title = attribute(
      card.match(/<h2\b[^>]*product-name[^>]*>\s*<a\b([^>]*)>/i)?.[1],
      'title',
    );
    const sold = /view_stock_info_text_not[^>]*>\s*Egzemplarz sprzedany/i.test(card);
    const price = attribute(card.match(/<span\b([^>]*itemprop="price"[^>]*)>/i)?.[1], 'content');
    if (!url || !title || !book.accept(title)) continue;
    if (sold || !price) {
      rows.push({
        title,
        url,
        price: 0,
        available: false,
        availabilityKnown: true,
        sellerBusiness: true,
      });
      continue;
    }
    const image = card.match(/<img\b[^>]*\bsrc="(https:[^"]+)"/i)?.[1];
    rows.push({
      title,
      url: new URL(url, origin).href,
      price,
      available: true,
      availabilityKnown: true,
      sourceAvailability: 'InStock',
      sellerBusiness: true,
      ...(image ? { image } : {}),
      ...(url.match(/\/p\/\d+\/(\d+)\//)?.[1]
        ? { externalOfferId: url.match(/\/p\/\d+\/(\d+)\//)?.[1] }
        : {}),
    });
  }
  return rows;
}

// Antykwariat NWS (Kraków, own shop, ISO-8859-2 pages): "TITLE - Author, First", edition with year,
// price. No ISBN on the list.
/** @type {CategorySource['parse']} */
function parseNws(html, book, origin) {
  const cards = segments(html, /<div class="product_boxnew"/);
  if (!cards.length) throw unrecognized();
  /** @type {AntiquarianRow[]} */
  const rows = [];
  for (const card of cards) {
    const photo = card.match(/<a href="(oferta-\d+-(\d+)-[^"]*)"[^>]*>\s*<img\b([^>]*)>/i);
    const title = attribute(photo?.[3], 'alt').replace(/\s+/g, ' ').trim();
    const price = priceText(card.match(/class="newprice_box">([\s\S]*?)<br/i)?.[1] || '');
    if (!photo || !title || !price || !book.accept(title)) continue;
    const edition = textOnly(card.match(/<span class="subtitle">([\s\S]*?)<\/span>/i)?.[1]);
    const image = attribute(photo[3], 'src');
    rows.push({
      title,
      url: new URL(decodeHtml(photo[1]), origin + '/').href,
      price,
      available: true,
      sellerBusiness: true,
      externalOfferId: photo[2],
      ...(image ? { image: new URL(image, origin + '/').href } : {}),
      ...(edition ? { listingDescription: edition } : {}),
    });
  }
  return rows;
}

/** @type {Record<string, CategorySource>} */
export const ANTIQUARIAN_SOURCES = {
  'BlackBooks.pl': {
    host: 'blackbooks.pl',
    // Fantasy, science fiction and horror together (one parent category, no overlap).
    categories: ['/524-fantasy-science-fiction-horror'],
    perPage: 24,
    ...queryPaging,
    card: /<article\b[^>]*\bjs-product-miniature\b/gi,
    parse: parseBlackBooks,
  },
  'Antykwariat Conroy': {
    host: 'www.antykwariat-conroy.pl',
    categories: ['/fantastyka-c-7.html'],
    perPage: 10,
    ...queryPaging,
    card: /<div\b[^>]*class="item col-12"/gi,
    parse: parseConroy,
  },
  'Szarlatan.pl': {
    host: 'szarlatan.pl',
    categories: ['/kategoria-produktu/ksiazki-wspolczesne/fantastyka/'],
    perPage: 150,
    pageUrl: (category, page) => (page > 1 ? `${category}page/${page}/` : category),
    pageNumber: (url, category) => {
      if (!url.pathname.startsWith(category)) return null;
      const rest = url.pathname.slice(category.length);
      if (!rest) return 1;
      const match = rest.match(/^page\/(\d+)\/?$/);
      return match ? Number(match[1]) : null;
    },
    card: /<li\b[^>]*\bclass="[^"]*\btype-product\b/gi,
    parse: parseSzarlatan,
  },
  'Stara Dobra Książka': {
    host: 'staradobraksiazka.pl',
    categories: ['/1100-fantasy-science-fiction-horror'],
    perPage: 24,
    // Page 2 is ",1.html", page 3 ",2.html"…
    pageUrl: (category, page) => (page > 1 ? `${category},${page - 1}.html` : category),
    pageNumber: (url, category) => {
      if (url.pathname === category) return 1;
      const match = url.pathname.match(new RegExp(`^${escapeRegExp(category)},(\\d+)\\.html$`));
      return match ? Number(match[1]) + 1 : null;
    },
    card: /<article\b[^>]*\bproduct-inside\b/gi,
    parse: parseStaraDobraKsiazka,
  },
  'Antykwariat NWS': {
    host: 'www.antykwariatnws.pl',
    // Fantasy (27) and science fiction (28); page N is "antykwariat-27---(N-1)-<name>.html".
    categories: ['/antykwariat-27---0-Fantasy.html', '/antykwariat-28----_science_fiction.html'],
    perPage: 15,
    // The name part of later pages is the shop's own: follow the link it prints.
    pageUrl: () => null,
    pageNumber: (url, category) => {
      if (url.pathname === category) return 1;
      const id = category.match(/^\/antykwariat-(\d+)-/)?.[1];
      const match = url.pathname.match(new RegExp(`^/antykwariat-${id}---(\\d+)-[^/]*\\.html$`));
      return match ? Number(match[1]) + 1 : null;
    },
    card: /<div class="product_boxnew"/gi,
    parse: parseNws,
  },
};

export function isCategorySource(/** @type {string} */ source) {
  return Object.hasOwn(ANTIQUARIAN_SOURCES, source);
}

/**
 * @typedef {object} CategoryTask
 * @property {string} source
 * @property {string} host
 * @property {string} categoryUrl  One of the source's `categories`.
 * @property {number} [page]
 * @property {string} [pageUrl]    The address of this page as the previous page linked it.
 */

/** Address of one category page; throws for anything the source does not list. @param {CategoryTask} task */
export function categoryPageUrl(task) {
  const spec = ANTIQUARIAN_SOURCES[task.source];
  if (!spec || task.host !== spec.host || !spec.categories.includes(task.categoryUrl))
    throw Error('UNTRUSTED_MARKETPLACE_TASK');
  const page = task.page ?? 1;
  if (!Number.isInteger(page) || page < 1 || page > 500) throw Error('INVALID_MARKETPLACE_PAGE');
  const origin = 'https://' + spec.host;
  if (page === 1) return origin + task.categoryUrl;
  const path = spec.pageUrl(task.categoryUrl, page);
  if (path) return origin + path;
  let url;
  try {
    url = new URL(String(task.pageUrl));
  } catch {
    throw Error('INVALID_MARKETPLACE_PAGE');
  }
  if (url.origin !== origin || spec.pageNumber(url, task.categoryUrl) !== page)
    throw Error('INVALID_MARKETPLACE_PAGE');
  return url.origin + url.pathname;
}

/** @param {string} html @param {string} source @param {BookFilter} book */
export function parseCategoryPage(html, source, book) {
  const spec = ANTIQUARIAN_SOURCES[source];
  return spec.parse(html, book, 'https://' + spec.host);
}

/**
 * Whether another page follows: a link to page N+1 of the same category. The end is concluded only
 * when the page also shows it belongs to a pager (a link to an earlier page) or is shorter than a
 * full page; otherwise 'unknown', so that a changed pager never marks offers as gone.
 * @param {string} html @param {CategoryTask} task @param {Array<{url: string}>} offers
 */
export function categoryPageInfo(html, task, offers) {
  const spec = ANTIQUARIAN_SOURCES[task.source],
    current = new URL(categoryPageUrl(task)),
    page = task.page ?? 1;
  const digest = createHash('sha256')
    .update(JSON.stringify(offers.map((offer) => offer.url)))
    .digest('hex');
  let earlier = false;
  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
    let url;
    try {
      url = new URL(decodeHtml(match[1]), current);
    } catch {
      continue;
    }
    if (url.origin !== current.origin) continue;
    const number = spec.pageNumber(url, task.categoryUrl);
    if (number === page + 1) {
      const path = spec.pageUrl(task.categoryUrl, number);
      return {
        page,
        digest,
        state: 'more',
        nextPage: number,
        nextUrl: path ? current.origin + path : url.origin + url.pathname,
      };
    }
    if (number !== null && number < page) earlier = true;
  }
  const listed = (html.match(spec.card) || []).length;
  return {
    page,
    digest,
    state: earlier || listed < spec.perPage ? 'end' : 'unknown',
    nextPage: null,
  };
}
