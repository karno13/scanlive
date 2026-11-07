// Seeds the catalogue from BN by author, publisher or title. Each BN book record with an ISBN
// becomes a reference edition through the normal resolver path (work grouping, people, series),
// without an offer. One page per step at BN's rate limit; an outage pauses the pass.
import { randomUUID } from 'node:crypto';

import { CatalogResolver } from './catalog-resolver.mjs';
import { isbnKeys } from './isbn-normalization.mjs';
import { persistMetadataResults } from './metadata-lookup.mjs';
import { BN_API_URL, bnRecordIsbns, normalizeBnRecord } from './metadata-sources/bn.mjs';

const KINDS = new Set(['author', 'publisher', 'title']);
export const SEED_PAGE_SIZE = 50;
export const SEED_INTERVAL_MS = 20_000;
const OUTAGE_PAUSE_MS = 30 * 60_000;
// A runaway query ("a") must not import half the national bibliography.
export const SEED_MAX_RECORDS = 2_000;

function fail(code, statusCode = 400) {
  throw Object.assign(Error(code), { statusCode });
}

export function seedUrl(seed) {
  const url = new URL(BN_API_URL);
  url.searchParams.set(seed.kind, seed.query);
  if (seed.publisher_filter) url.searchParams.set('publisher', seed.publisher_filter);
  url.searchParams.set('limit', String(SEED_PAGE_SIZE));
  return url.href;
}

/** Only BN's own pagination links are followed. */
function nextPageUrl(payload) {
  const next = payload?.nextPage;
  if (typeof next !== 'string' || !next) return null;
  try {
    const url = new URL(next);
    return url.protocol === 'https:' && url.hostname === 'data.bn.org.pl' ? url.href : null;
  } catch {
    return null;
  }
}

function rowToSeed(row) {
  return {
    id: row.id,
    kind: row.kind,
    query: row.query,
    publisher: row.publisher_filter || null,
    polishOnly: row.polish_only === 1,
    status: row.status,
    pages: row.pages,
    recordsSeen: row.records_seen,
    editionsCreated: row.editions_created,
    alreadyKnown: row.already_known,
    skipped: row.skipped,
    lastError: row.last_error,
    createdAt: row.created_at,
    lastRunAt: row.last_run_at,
  };
}

function isBook(record) {
  // "audiobook" and "dokument elektroniczny" are not printed books.
  return !record.kind || /^(?:ksi[aą][zż]ka|book)$/i.test(String(record.kind).trim());
}

function isPolish(record) {
  return !record.language || /pol/i.test(String(record.language));
}

export function createSeedService(
  repository,
  { requestBn, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout, log = () => {} } = {},
) {
  if (typeof requestBn !== 'function') throw new TypeError('requestBn is required');
  const db = repository.database;
  let timer = null;
  let running = null;
  let pausedUntil = 0;
  let lastOutage = null;

  function list() {
    return {
      seeds: db.prepare('SELECT * FROM catalog_seeds ORDER BY created_at DESC').all().map(rowToSeed),
      pausedUntil: pausedUntil > now().getTime() ? new Date(pausedUntil).toISOString() : null,
      lastOutage,
      running: Boolean(running),
    };
  }

  function add(input = {}) {
    const kind = String(input.kind ?? '');
    const query = String(input.query ?? '').replace(/\s+/g, ' ').trim();
    const publisher = String(input.publisher ?? '').replace(/\s+/g, ' ').trim();
    if (!KINDS.has(kind)) fail('INVALID_SEED_KIND');
    if (query.length < 2 || query.length > 120) fail('INVALID_SEED_QUERY');
    if (publisher.length > 120) fail('INVALID_SEED_PUBLISHER');
    const at = now().toISOString();
    const existing = db
      .prepare('SELECT * FROM catalog_seeds WHERE kind=? AND query=? AND publisher_filter=?')
      .get(kind, query, publisher);
    if (existing) {
      // Adding the same seed again restarts it from the first page (new BN records appear).
      db.prepare("UPDATE catalog_seeds SET status='active', next_url=NULL, last_error=NULL, updated_at=? WHERE id=?").run(at, existing.id);
      schedule(0);
      return rowToSeed(db.prepare('SELECT * FROM catalog_seeds WHERE id=?').get(existing.id));
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO catalog_seeds(id,kind,query,publisher_filter,polish_only,status,created_at,updated_at)
       VALUES(?,?,?,?,?,'active',?,?)`,
    ).run(id, kind, query, publisher, input.polishOnly === false ? 0 : 1, at, at);
    schedule(0);
    return rowToSeed(db.prepare('SELECT * FROM catalog_seeds WHERE id=?').get(id));
  }

  function setStatus(id, status) {
    if (!['active', 'paused'].includes(status)) fail('INVALID_SEED_STATUS');
    const changed = db.prepare('UPDATE catalog_seeds SET status=?, updated_at=? WHERE id=?').run(status, now().toISOString(), String(id));
    if (!Number(changed.changes)) fail('SEED_NOT_FOUND', 404);
    if (status === 'active') schedule(0);
    return rowToSeed(db.prepare('SELECT * FROM catalog_seeds WHERE id=?').get(String(id)));
  }

  function remove(id) {
    const changed = db.prepare('DELETE FROM catalog_seeds WHERE id=?').run(String(id));
    if (!Number(changed.changes)) fail('SEED_NOT_FOUND', 404);
    return { removed: true };
  }

  async function importRecord(raw, sourceUrl, fetchedAt) {
    const isbns = bnRecordIsbns(raw);
    const isbn = isbns.find((value) => value.length === 13) ?? isbns[0];
    if (!isbn) return 'skipped';
    if (isbns.some((value) => repository.findEditionByISBN(value))) return 'known';
    const normalized = normalizeBnRecord(raw, isbn, { sourceUrl, fetchedAt });
    if (normalized.issue) return 'skipped';
    const metadata = {
      bn: { source: 'bn', status: 'found', records: [normalized.record], fetchedAt },
      openLibrary: { source: 'open_library', status: 'not_found', records: [] },
      comparison: { status: 'incomplete', conflicts: [] },
    };
    const resolver = new CatalogResolver({ repository, now, lookupMetadata: async () => metadata });
    const result = await resolver.resolve({
      evidence: {
        status: 'valid',
        values: [isbn],
        isbn,
        candidateIsbn: isbn,
        classification: 'structured',
        autoAssignable: true,
        reviewRequired: false,
        observations: [{ value: isbn, classification: 'structured', valid: true, source: 'seed:bn' }],
      },
    });
    if (['created_work_and_edition', 'created_edition'].includes(result.decision)) {
      // Keep the record's other ISBN forms on the edition (hardback / paperback in one record).
      for (const other of isbns)
        for (const key of isbnKeys(other))
          try {
            repository.attachIdentifier(result.editionId, key.length === 10 ? 'isbn10' : 'isbn13', key, {
              source: 'catalog_seed',
              verificationStatus: 'verified',
              at: now(),
            });
          } catch {
            // Another edition already owns this ISBN: leave it there.
          }
      return 'created';
    }
    if (result.decision === 'matched_existing') return 'known';
    // Persist the record anyway: a later ISBN lookup finds it linked.
    persistMetadataResults(repository, [metadata.bn]);
    return 'skipped';
  }

  /** Processes one page of the oldest active seed. */
  async function step() {
    if (running) return running;
    running = (async () => {
      if (pausedUntil > now().getTime()) return { state: 'paused' };
      const seed = db
        .prepare("SELECT * FROM catalog_seeds WHERE status='active' ORDER BY coalesce(last_run_at,''), created_at LIMIT 1")
        .get();
      if (!seed) return { state: 'idle' };
      const url = seed.next_url || seedUrl(seed);
      const response = await requestBn(url);
      const at = now().toISOString();
      if (response.status === 'temporary_error') {
        pausedUntil = now().getTime() + OUTAGE_PAUSE_MS;
        lastOutage = {
          at,
          reason: response.error?.code || response.error?.message || (response.httpStatus ? `HTTP ${response.httpStatus}` : 'temporary_error'),
        };
        db.prepare('UPDATE catalog_seeds SET last_error=?, last_run_at=?, updated_at=? WHERE id=?').run(lastOutage.reason, at, at, seed.id);
        return { state: 'outage', reason: lastOutage.reason };
      }
      lastOutage = null;
      if (response.status === 'not_found') {
        db.prepare("UPDATE catalog_seeds SET status='done', next_url=NULL, last_error=NULL, last_run_at=?, updated_at=? WHERE id=?").run(at, at, seed.id);
        return { state: 'done', seedId: seed.id };
      }
      const records = response.status === 'found' ? response.payload?.bibs : null;
      if (!Array.isArray(records)) {
        const reason = response.reason || response.error?.code || 'invalid_response';
        db.prepare("UPDATE catalog_seeds SET status='error', last_error=?, last_run_at=?, updated_at=? WHERE id=?").run(reason, at, at, seed.id);
        return { state: 'error', reason };
      }
      const counts = { created: 0, known: 0, skipped: 0 };
      for (const raw of records) {
        if (!isBook(raw) || (seed.polish_only === 1 && !isPolish(raw))) {
          counts.skipped += 1;
          continue;
        }
        try {
          counts[await importRecord(raw, response.url ?? url, at)] += 1;
        } catch (error) {
          counts.skipped += 1;
          log('CATALOG_SEED_RECORD_FAILED', error?.message ?? error);
        }
      }
      const seen = seed.records_seen + records.length;
      const next = records.length && seen < SEED_MAX_RECORDS ? nextPageUrl(response.payload) : null;
      db.prepare(
        `UPDATE catalog_seeds SET status=?, next_url=?, pages=pages+1, records_seen=?, editions_created=editions_created+?,
           already_known=already_known+?, skipped=skipped+?, last_error=NULL, last_run_at=?, updated_at=? WHERE id=?`,
      ).run(next ? 'active' : 'done', next, seen, counts.created, counts.known, counts.skipped, at, at, seed.id);
      return { state: next ? 'more' : 'done', seedId: seed.id, ...counts };
    })();
    try {
      return await running;
    } finally {
      running = null;
    }
  }

  function schedule(delay = SEED_INTERVAL_MS) {
    if (timer) clearTimer(timer);
    timer = setTimer(async () => {
      timer = null;
      let result;
      try {
        result = await step();
      } catch (error) {
        log('CATALOG_SEED_STEP_FAILED', error?.message ?? error);
      }
      const active = db.prepare("SELECT 1 FROM catalog_seeds WHERE status='active' LIMIT 1").get();
      if (active) schedule(result?.state === 'outage' || result?.state === 'paused' ? OUTAGE_PAUSE_MS : SEED_INTERVAL_MS);
    }, delay);
    timer?.unref?.();
  }

  function start() {
    if (db.prepare("SELECT 1 FROM catalog_seeds WHERE status='active' LIMIT 1").get()) schedule(5_000);
  }

  function stop() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  return { list, add, setStatus, remove, step, start, stop };
}
