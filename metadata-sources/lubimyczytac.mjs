// lubimyczytac.pl as a last source for ISBNs that BN, Open Library and e-ISBN do not know (new
// Copernicus editions of Warhammer novels, small publishers). The site does not search by ISBN, so
// the offer's title (and author) is searched and the first few book pages are read; a page counts
// only when the ISBN in its structured data (schema.org Book) equals the offer's ISBN. Its record
// gives title, author, publisher, year, cycle with volume and pages. Requests go through the shared
// per-source pacing gate.

import { readSourceHtml } from '../marketplaces.mjs';
import { normalizeISBN } from '../isbn-normalization.mjs';

const HOST = 'https://lubimyczytac.pl';
const MAX_CANDIDATES = 4;

const decode = (text) =>
  String(text ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

/** Book page links of a search result page, in order, without duplicates. */
export function parseLcSearch(html) {
  const links = [];
  for (const match of String(html).matchAll(/href="(\/ksiazka\/\d+\/[a-z0-9-]+)"/g))
    if (!links.includes(match[1])) links.push(match[1]);
  return links.map((path) => HOST + path);
}

/** The schema.org Book of a book page, with the publisher from the page itself. */
export function parseLcBook(html) {
  let book = null;
  for (const match of String(html).matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(match[1]);
      for (const node of Array.isArray(data) ? data : [data]) if (node?.['@type'] === 'Book') book = node;
    } catch {}
  }
  if (!book) return null;
  const authors = [].concat(book.author ?? []).map((person) => decode(person?.name)).filter(Boolean);
  const publisher = decode(String(html).match(/Wydawnictwo:\s*<a[^>]*>([^<]+)<\/a>/)?.[1] ?? '');
  const year = Number(String(book.datePublished ?? '').slice(0, 4));
  const series = book.isPartOfSeries;
  return {
    title: decode(book.name),
    isbn: normalizeISBN(String(book.isbn ?? '')),
    authors,
    publisher: publisher || null,
    publicationYear: year >= 1400 && year <= 2100 ? year : null,
    cycle: series?.name ? { name: decode(series.name), volume: Number.isInteger(Number(series.position)) ? Number(series.position) : null } : null,
    pages: Number(book.numberOfPages) || null,
    language: decode(book.inLanguage) || null,
    url: typeof book.url === 'string' && book.url.startsWith(HOST + '/ksiazka/') ? book.url : null,
  };
}

/**
 * The lubimyczytac.pl record of `isbn`, searched by title (with the first author's surname first,
 * then the title alone). Null when no candidate page carries this exact ISBN.
 */
export async function findLcRecord({ isbn, title, authors = [] }, { read = (url) => readSourceHtml(url, { source: 'lubimyczytac.pl' }) } = {}) {
  const wanted = normalizeISBN(isbn);
  if (!wanted || !String(title ?? '').trim()) return null;
  const surname = String(authors[0] ?? '').trim().split(/\s+/).pop() ?? '';
  const phrases = [...new Set([surname ? `${title} ${surname}` : null, String(title)].filter(Boolean))];
  const seen = new Set();
  for (const phrase of phrases) {
    const search = await read(`${HOST}/szukaj/ksiazki?phrase=${encodeURIComponent(phrase.slice(0, 120))}`);
    for (const url of parseLcSearch(search).slice(0, MAX_CANDIDATES)) {
      if (seen.has(url)) continue;
      seen.add(url);
      const record = parseLcBook(await read(url));
      if (record?.isbn === wanted) return { ...record, url: record.url || url };
    }
  }
  return null;
}
