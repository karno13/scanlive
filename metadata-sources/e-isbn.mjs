// @ts-check
// e-ISBN (e-isbn.pl): the national ISBN registry run by the National Library. Publishers register
// a book there when they get its ISBN, often long before BN catalogues the printed copy, so it
// knows recent Polish books that BN, Open Library and Google Books do not (Pratchett reprints from
// Prószyński, Warcraft from Insignis…). The public API answers in ONIX 3.0 XML. Asked only when
// BN and Open Library have nothing; records are publisher-supplied, not library descriptions.
import { normalizeISBN } from '../isbn-normalization.mjs';
import { SourceRateLimiter } from '../metadata-http.mjs';
import {
  buildNormalizedRecord,
  matchingISBNs,
  normalizedText,
  payloadHash,
} from '../metadata-record.mjs';

export const E_ISBN_URL = 'https://e-isbn.pl/IsbnWeb/api.xml';

const LANGUAGES = {
  pol: 'polski',
  eng: 'angielski',
  ger: 'niemiecki',
  fre: 'francuski',
  rus: 'rosyjski',
  cze: 'czeski',
};
const BINDINGS = { BB: 'twarda', BC: 'miękka' };

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text) =>
  String(text ?? '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code) =>
      code[0] === '#'
        ? String.fromCodePoint(
            code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)),
          )
        : ENTITIES[code.toLowerCase()],
    )
    .replace(/\s+/g, ' ')
    .trim();
const blocks = (xml, tag) =>
  [...String(xml).matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map(
    (m) => m[1],
  );
const first = (xml, tag) => {
  const value = blocks(xml, tag)[0];
  return value === undefined ? null : decode(value);
};

/** "Pratchett, Terry" stays; "Terry Pratchett" from separate name parts becomes "Pratchett, Terry". */
function contributorName(block) {
  const inverted = first(block, 'PersonNameInverted');
  if (inverted) return inverted;
  const key = first(block, 'KeyNames');
  const before = first(block, 'NamesBeforeKey');
  if (key) return before ? `${key}, ${before}` : key;
  return first(block, 'PersonName') ?? first(block, 'CorporateName');
}

/** One ONIX <Product> → the fields BookFlip keeps. Exported for tests. */
export function parseOnixProduct(product) {
  const identifiers = blocks(product, 'ProductIdentifier')
    .filter((block) => ['15', '02', '03'].includes(first(block, 'ProductIDType')))
    .map((block) => first(block, 'IDValue'))
    .filter(Boolean);
  const fullDetail = blocks(product, 'DescriptiveDetail')[0] ?? '';
  // The series (<Collection>) has its own TitleDetail: read the book's title without it.
  const detail = fullDetail.replace(/<Collection\b[\s\S]*?<\/Collection>/g, '');
  const titleDetail =
    blocks(detail, 'TitleDetail').find((block) => first(block, 'TitleType') === '01') ??
    blocks(detail, 'TitleDetail')[0] ??
    '';
  const element = blocks(titleDetail, 'TitleElement')[0] ?? '';
  const title = [
    first(element, 'TitlePrefix'),
    first(element, 'TitleWithoutPrefix') ?? first(element, 'TitleText'),
  ]
    .filter(Boolean)
    .join(' ');
  const subtitle = first(element, 'Subtitle');
  const authors = blocks(detail, 'Contributor')
    .filter((block) => ['A01', 'A02', 'A12'].includes(first(block, 'ContributorRole')))
    .map(contributorName)
    .filter(Boolean);
  const translators = blocks(detail, 'Contributor')
    .filter((block) => first(block, 'ContributorRole') === 'B06')
    .map(contributorName)
    .filter(Boolean);
  const series = blocks(fullDetail, 'Collection')
    .map((block) => {
      const name = first(blocks(block, 'TitleElement')[0] ?? '', 'TitleText');
      const part = first(blocks(block, 'TitleElement')[0] ?? '', 'PartNumber');
      return name ? { name, part } : null;
    })
    .filter(Boolean);
  const publishing = blocks(product, 'PublishingDetail')[0] ?? '';
  const imprint = first(blocks(publishing, 'Imprint')[0] ?? '', 'ImprintName');
  const publisher = first(blocks(publishing, 'Publisher')[0] ?? '', 'PublisherName');
  const date = blocks(publishing, 'PublishingDate')
    .map((block) => ({ role: first(block, 'PublishingDateRole'), date: first(block, 'Date') }))
    .sort((a, b) => (a.role === '01' ? -1 : b.role === '01' ? 1 : 0))[0]?.date;
  return {
    recordReference: first(product, 'RecordReference'),
    identifiers,
    title: subtitle ? `${title} : ${subtitle}` : title,
    authors,
    translators,
    series,
    publisher: imprint || publisher,
    publisherCompany: publisher,
    year: date ? Number(String(date).slice(0, 4)) || null : null,
    language: LANGUAGES[first(detail, 'LanguageCode')] ?? first(detail, 'LanguageCode'),
    binding: BINDINGS[first(detail, 'ProductForm')] ?? null,
    form: first(detail, 'ProductForm'),
    edition: first(detail, 'EditionNumber'),
    city: first(publishing, 'CityOfPublication'),
  };
}

export function createEIsbnAdapter({
  fetcher = globalThis.fetch,
  limiter = new SourceRateLimiter({ minIntervalMs: 1_000 }),
  timeoutMs = 8_000,
  userAgent = 'BookFlip/2.0 (catalog resolver)',
  now = () => new Date(),
  enabled = true,
} = {}) {
  return {
    source: 'e_isbn',
    enabled,
    async lookup(isbn) {
      const requested = normalizeISBN(isbn);
      if (!requested)
        return {
          source: 'e_isbn',
          status: 'invalid_response',
          reason: 'invalid_isbn',
          records: [],
        };
      const url = new URL(E_ISBN_URL);
      url.searchParams.set('isbn', requested);
      let xml;
      try {
        await limiter.acquire();
        const response = await fetcher(url.href, {
          headers: { Accept: 'application/xml, text/xml', 'User-Agent': userAgent },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status === 404)
          return { source: 'e_isbn', status: 'not_found', records: [], url: url.href };
        if (!response.ok)
          return {
            source: 'e_isbn',
            status: 'temporary_error',
            httpStatus: response.status,
            records: [],
            url: url.href,
          };
        xml = await response.text();
      } catch (error) {
        return {
          source: 'e_isbn',
          status: 'temporary_error',
          error: { code: error?.name || 'FETCH_FAILED' },
          records: [],
          url: url.href,
        };
      }
      if (!/<ONIXMessage\b/.test(xml))
        return {
          source: 'e_isbn',
          status: 'invalid_response',
          reason: 'not_onix',
          records: [],
          url: url.href,
        };
      const fetchedAt = now().toISOString();
      const records = [];
      for (const product of blocks(xml, 'Product')) {
        const parsed = parseOnixProduct(product);
        const matched = matchingISBNs(parsed.identifiers, requested);
        const title = normalizedText(parsed.title);
        if (!matched.length || !title) continue;
        const payload = { onix: parsed };
        records.push({
          ...buildNormalizedRecord({
            source: 'e_isbn',
            externalRecordId: parsed.recordReference || requested,
            workExternalId: null,
            isbn10: matched.find((value) => value.length === 10) ?? null,
            isbn13: matched.find((value) => value.length === 13) ?? null,
            title,
            authors: parsed.authors,
            publisher: parsed.publisher,
            publicationYear: parsed.year,
            language: parsed.language,
            binding: parsed.binding,
            materialType: 'książka',
            sourceUrl: url.href,
            fetchedAt,
            payloadHash: payloadHash(payload),
          }),
          payload,
        });
      }
      if (!records.length)
        return { source: 'e_isbn', status: 'not_found', records: [], fetchedAt, url: url.href };
      return {
        source: 'e_isbn',
        status: 'found',
        records,
        ambiguous: records.length > 1,
        fetchedAt,
        url: url.href,
      };
    },
  };
}
