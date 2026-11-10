import { isbnKeys, normalizeISBN } from '../isbn-normalization.mjs';
import { createJsonRequester } from '../metadata-http.mjs';
import {
  buildNormalizedRecord,
  isbnCandidates,
  matchingISBNs,
  normalizedStringList,
  normalizedText,
  payloadHash,
  singleValue,
} from '../metadata-record.mjs';
import { catalogTitle, parseBnMarc } from '../bn-marc.mjs';

export const BN_API_URL = 'https://data.bn.org.pl/api/institutions/bibs.json';

function recordsFromPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const records = payload.bibs ?? payload.records ?? payload.items;
  return Array.isArray(records) ? records : null;
}

function recordIdentifiers(record) {
  return record.isbnIssn ?? record.isbn ?? record.isbns ?? record.identifiers ?? [];
}

function recordAuthors(record) {
  return normalizedStringList(record.authors ?? record.author ?? record.creator ?? []);
}

function recordLanguage(record) {
  return singleValue(record.language ?? record.languages);
}

function recordId(record) {
  return normalizedText(String(record.id ?? record.recordId ?? record.mmsId ?? ''));
}

/**
 * One BN bibliographic record as a catalogue metadata record for `requestedISBN` (one of its ISBNs).
 * Returns { record } or { issue }. Shared by the ISBN lookup and catalogue seeding.
 */
export function normalizeBnRecord(
  rawRecord,
  requestedISBN,
  { sourceUrl = null, fetchedAt = new Date().toISOString() } = {},
) {
  const matched = matchingISBNs(recordIdentifiers(rawRecord), requestedISBN);
  if (matched.length === 0)
    return { issue: { reason: 'isbn_mismatch', externalRecordId: recordId(rawRecord) } };
  const externalRecordId = recordId(rawRecord);
  // MARC keeps title, people and publisher apart; the flattened fields are the fallback.
  const marc = parseBnMarc(rawRecord);
  const title = normalizedText(catalogTitle(marc) ?? rawRecord.title ?? rawRecord.name);
  if (!externalRecordId || !title)
    return { issue: { reason: 'missing_required_fields', externalRecordId } };
  const isbn10 = matched.find((value) => value.length === 10) ?? null;
  const isbn13 = matched.find((value) => value.length === 13) ?? null;
  const record = buildNormalizedRecord({
    source: 'bn',
    externalRecordId,
    workExternalId: null,
    isbn10,
    isbn13,
    title,
    authors: marc ? marc.authors : recordAuthors(rawRecord),
    publisher: marc?.publisher ?? singleValue(rawRecord.publisher ?? rawRecord.publishers),
    publicationYear:
      rawRecord.publicationYear ?? rawRecord.publishYear ?? rawRecord.date ?? marc?.publicationYear,
    language: recordLanguage(rawRecord),
    binding: marc?.binding ?? singleValue(rawRecord.binding ?? rawRecord.physicalFormat),
    materialType: singleValue(rawRecord.materialType ?? rawRecord.kind ?? rawRecord.type),
    sourceUrl,
    fetchedAt,
    payloadHash: payloadHash(rawRecord),
  });
  return {
    record: marc?.originalTitle
      ? { ...record, originalTitle: marc.originalTitle, payload: rawRecord }
      : { ...record, payload: rawRecord },
  };
}

/** ISBNs a BN record lists (any form). */
export function bnRecordIsbns(rawRecord) {
  return isbnCandidates(recordIdentifiers(rawRecord));
}

export function createBnAdapter({
  requester,
  fetcher,
  limiter,
  timeoutMs = 8_000,
  retries = 2,
  wait,
  now = () => new Date(),
} = {}) {
  const request = requester ?? createJsonRequester({ fetcher, limiter, timeoutMs, retries, wait });

  return {
    source: 'bn',
    async lookup(isbn) {
      const requestedISBN = normalizeISBN(isbn);
      if (!requestedISBN)
        return { source: 'bn', status: 'invalid_response', reason: 'invalid_isbn', records: [] };

      // BN indexes older records under ISBN-10 only (and newer ones under ISBN-13 only), so an
      // exact-form query misses books the catalogue does hold. Ask for every equivalent form.
      const forms = isbnKeys(requestedISBN);
      if (!forms.length) forms.push(requestedISBN);
      let url, response, rawRecords;
      for (const form of forms) {
        url = new URL(BN_API_URL);
        url.searchParams.set('isbnIssn', form);
        url.searchParams.set('limit', '100');
        response = await request(url.href);
        if (response.status !== 'found') return { source: 'bn', ...response, records: [] };
        rawRecords = recordsFromPayload(response.payload);
        if (!rawRecords || rawRecords.length > 0) break;
      }

      if (!rawRecords) {
        return {
          source: 'bn',
          status: 'invalid_response',
          reason: 'missing_records_array',
          records: [],
        };
      }
      if (rawRecords.length === 0)
        return { source: 'bn', status: 'not_found', records: [], fetchedAt: now().toISOString() };

      const fetchedAt = now().toISOString();
      const records = [];
      const issues = [];
      for (const rawRecord of rawRecords) {
        const normalized = normalizeBnRecord(rawRecord, requestedISBN, {
          sourceUrl: response.url ?? url.href,
          fetchedAt,
        });
        if (normalized.issue) {
          issues.push(normalized.issue);
          continue;
        }
        records.push(normalized.record);
      }

      if (records.length === 0) {
        return {
          source: 'bn',
          status: 'invalid_response',
          reason: issues.some((issue) => issue.reason === 'isbn_mismatch')
            ? 'isbn_mismatch'
            : 'missing_required_fields',
          records: [],
          issues,
          fetchedAt,
        };
      }
      return {
        source: 'bn',
        status: 'found',
        records,
        ambiguous: records.length > 1,
        issues,
        fetchedAt,
      };
    },
  };
}
