// Google Books as the third metadata source: asked only when BN does not know an ISBN (or is
// unreachable) and Open Library has no record. Its anonymous quota is shared worldwide and is
// routinely exhausted, so the adapter runs only with the operator's own free API key
// (BOOKFLIP_GOOGLE_BOOKS_KEY). The key is sent to Google only and never stored.
import { normalizeISBN } from '../isbn-normalization.mjs';
import { createJsonRequester } from '../metadata-http.mjs';
import {
  buildNormalizedRecord,
  matchingISBNs,
  normalizedStringList,
  normalizedText,
  payloadHash,
} from '../metadata-record.mjs';

export const GOOGLE_BOOKS_URL = 'https://www.googleapis.com/books/v1/volumes';

const LANGUAGES = {
  pl: 'polski',
  en: 'angielski',
  de: 'niemiecki',
  fr: 'francuski',
  ru: 'rosyjski',
  cs: 'czeski',
};

export function createGoogleBooksAdapter({
  apiKey,
  requester,
  fetcher,
  limiter,
  timeoutMs = 8_000,
  retries = 1,
  now = () => new Date(),
} = {}) {
  const request = requester ?? createJsonRequester({ fetcher, limiter, timeoutMs, retries });
  return {
    source: 'google_books',
    enabled: Boolean(apiKey),
    async lookup(isbn) {
      const requested = normalizeISBN(isbn);
      if (!requested)
        return {
          source: 'google_books',
          status: 'invalid_response',
          reason: 'invalid_isbn',
          records: [],
        };
      if (!apiKey)
        return { source: 'google_books', status: 'skipped', reason: 'no_api_key', records: [] };
      const url = new URL(GOOGLE_BOOKS_URL);
      url.searchParams.set('q', 'isbn:' + requested);
      url.searchParams.set('maxResults', '5');
      url.searchParams.set('key', apiKey);
      const response = await request(url.href);
      // Results are cached and stored: never keep the key in them.
      const sourceUrl = `${GOOGLE_BOOKS_URL}?q=isbn:${requested}`;
      if (response.status !== 'found') {
        const { url: _withKey, ...rest } = response;
        return { source: 'google_books', ...rest, url: sourceUrl, records: [] };
      }
      const items = Array.isArray(response.payload?.items) ? response.payload.items : [];
      const fetchedAt = now().toISOString();
      const records = [];
      for (const item of items) {
        const info = item?.volumeInfo ?? {};
        const identifiers = (info.industryIdentifiers ?? [])
          .map((entry) => entry?.identifier)
          .filter(Boolean);
        const matched = matchingISBNs(identifiers, requested);
        const title = normalizedText([info.title, info.subtitle].filter(Boolean).join(' : '));
        if (!matched.length || !title || !item.id) continue;
        const payload = { id: item.id, volumeInfo: info };
        records.push({
          ...buildNormalizedRecord({
            source: 'google_books',
            externalRecordId: item.id,
            workExternalId: null,
            isbn10: matched.find((value) => value.length === 10) ?? null,
            isbn13: matched.find((value) => value.length === 13) ?? null,
            title,
            authors: normalizedStringList(info.authors ?? []),
            publisher: normalizedText(info.publisher),
            publicationYear: info.publishedDate,
            language: LANGUAGES[info.language] ?? normalizedText(info.language),
            binding: null,
            materialType: normalizedText(info.printType),
            sourceUrl,
            fetchedAt,
            payloadHash: payloadHash(payload),
          }),
          payload,
        });
      }
      if (!records.length)
        return {
          source: 'google_books',
          status: 'not_found',
          records: [],
          fetchedAt,
          url: sourceUrl,
        };
      return {
        source: 'google_books',
        status: 'found',
        records,
        ambiguous: records.length > 1,
        fetchedAt,
        url: sourceUrl,
      };
    },
  };
}
