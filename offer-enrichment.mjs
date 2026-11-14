import { createHash } from 'node:crypto';
import { readSourceHtml } from './marketplaces.mjs';
import { SOURCE_ROUND_LIMIT } from './marketplace-gate.mjs';
import { DETAIL_SOURCES, parseProductDetail, empikCategories } from './source-details.mjs';
import { conditionClass } from './offer-observations.mjs';

const MAX_ATTEMPTS = 3;
const RETRY_AFTER_MS = 60 * 60 * 1000;
// A rate limit or a challenge says nothing about the offer itself: it is tried again later and
// never uses up one of the offer's attempts (offers burnt by HTTP 429 earlier are retried too).
const THROTTLE_ERRORS = ['SOURCE_HTTP_429', 'SOURCE_CAPTCHA', 'SOURCE_HTTP_403'];
export const isThrottleError = (error) =>
  error?.blocked === true ||
  error?.status === 429 ||
  THROTTLE_ERRORS.includes(String(error?.message));

const stableId = (...parts) =>
  'enrich_' + createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);

/** Offers without an ISBN whose detail page has not been read yet (or failed long enough ago to retry). */
export function pendingEnrichment(
  repository,
  { sources = [...DETAIL_SOURCES], limit = 40, now = () => new Date() } = {},
) {
  if (!sources.length) return [];
  const marks = sources.map(() => '?').join(',');
  const retryBefore = new Date(now().getTime() - RETRY_AFTER_MS).toISOString();
  return repository.database
    .prepare(
      `SELECT o.id, o.source, o.normalized_url AS url
       FROM offers o LEFT JOIN offer_enrichment e ON e.offer_id = o.id
       WHERE o.source IN (${marks}) AND (o.observed_isbn IS NULL OR o.observed_isbn = '')
         AND (e.offer_id IS NULL OR (e.outcome = 'error' AND e.attempted_at <= ?
              AND (e.attempts < ? OR e.last_error IN (${THROTTLE_ERRORS.map(() => '?').join(',')}))))
       ORDER BY o.last_seen_at DESC LIMIT ?`,
    )
    .all(
      ...sources,
      retryBefore,
      MAX_ATTEMPTS,
      ...THROTTLE_ERRORS,
      Math.max(1, Math.min(500, limit)),
    );
}

/** Sends a job back to the resolver when new evidence arrived. Manual decisions and bundles stay put. */
export function requeueForNewEvidence(repository, offerId, at) {
  const result = repository.database
    .prepare(
      `UPDATE identification_jobs
       SET status='queued', run_after=NULL, lease_token=NULL, lease_expires_at=NULL, last_error=NULL,
           result_json=NULL, attempt_count=0, updated_at=?
       WHERE offer_id=? AND (status='review_required'
              OR (status='completed' AND json_valid(result_json) AND json_extract(result_json,'$.decision')='not_found'))
         AND NOT EXISTS (SELECT 1 FROM offer_matches m WHERE m.offer_id=identification_jobs.offer_id
              AND m.status='active' AND m.method IN ('manual','legacy_manual'))
         AND NOT EXISTS (SELECT 1 FROM offer_sets s WHERE s.offer_id=identification_jobs.offer_id)`,
    )
    .run(at, offerId);
  return Number(result.changes) > 0;
}

function record(
  repository,
  offer,
  { outcome, isbn = null, facts = null, error = null, countAttempt = true },
  at,
) {
  const step = countAttempt ? 1 : 0;
  repository.database
    .prepare(
      `INSERT INTO offer_enrichment(offer_id,source,outcome,attempts,attempted_at,isbn,facts_json,last_error)
       VALUES(?,?,?,1,?,?,?,?)
       ON CONFLICT(offer_id) DO UPDATE SET outcome=excluded.outcome, attempts=offer_enrichment.attempts+${step},
         attempted_at=excluded.attempted_at, isbn=excluded.isbn, facts_json=excluded.facts_json, last_error=excluded.last_error`,
    )
    .run(offer.id, offer.source, outcome, at, isbn, facts ? JSON.stringify(facts) : null, error);
}

export async function enrichOffers(
  repository,
  {
    fetchHtml = (url, source) => readSourceHtml(url, { source }),
    sources,
    limit = 40,
    now = () => new Date(),
    signal = null,
    onProgress = () => {},
  } = {},
) {
  const report = {
    checked: 0,
    isbnFound: 0,
    noIsbn: 0,
    errors: 0,
    requeued: 0,
    stopped: null,
    paused: [],
  };
  const pagesRead = new Map();
  for (const offer of pendingEnrichment(repository, { sources, limit, now })) {
    if (signal?.aborted) {
      report.stopped = 'aborted';
      break;
    }
    // A source that refused us in this run is not asked again; the other sources go on.
    if (report.paused.includes(offer.source)) continue;
    // A few pages of such a source per run; the rest stays pending for the next one.
    const read = pagesRead.get(offer.source) ?? 0;
    if (read >= (SOURCE_ROUND_LIMIT[offer.source] ?? Infinity)) continue;
    pagesRead.set(offer.source, read + 1);
    const at = now().toISOString();
    let html;
    try {
      html = await fetchHtml(offer.url, offer.source);
    } catch (error) {
      report.checked += 1;
      report.errors += 1;
      const throttled = isThrottleError(error);
      record(
        repository,
        offer,
        {
          outcome: 'error',
          error: String(error?.message ?? error).slice(0, 200),
          countAttempt: !throttled,
        },
        at,
      );
      // A challenge or rate limit applies to the whole source: leave it alone (the caller also
      // pauses it for a while) instead of hammering it.
      if (throttled) {
        report.stopped = String(error.message);
        report.paused.push(offer.source);
      }
      continue;
    }
    report.checked += 1;
    const detail = parseProductDetail(html);
    const facts = { ...detail, isbn: undefined };
    // The page's condition ("bardzo dobry") is more precise than the result card's "Używany".
    if (detail.condition)
      repository.database
        .prepare(
          "UPDATE offers SET condition_text=?, condition_class=? WHERE id=? AND (condition_text IS NULL OR coalesce(condition_class,'unknown')='unknown')",
        )
        .run(
          String(detail.condition).trim().slice(0, 200),
          conditionClass(detail.condition),
          offer.id,
        );
    if (offer.source === 'Empik') {
      const categories = empikCategories(html);
      facts.category = categories.join(' / ') || null;
      // An import from "Książki obcojęzyczne": no Polish source will know it.
      if (categories[0] === 'Książki obcojęzyczne') {
        repository.database
          .prepare("UPDATE offers SET language='obcojęzyczna' WHERE id=?")
          .run(offer.id);
        if (requeueForNewEvidence(repository, offer.id, at)) report.requeued += 1;
        report.foreign = (report.foreign || 0) + 1;
      }
    }
    if (!detail.isbn) {
      report.noIsbn += 1;
      record(repository, offer, { outcome: 'no_isbn', facts }, at);
    } else {
      repository.transaction(() => {
        repository.database
          .prepare(
            "UPDATE offers SET observed_isbn=? WHERE id=? AND (observed_isbn IS NULL OR observed_isbn='')",
          )
          .run(detail.isbn, offer.id);
        repository.putMetadataEvidence({
          id: stableId(offer.id, detail.isbn),
          offerId: offer.id,
          fieldName: 'isbn',
          value: detail.isbn,
          classification: 'structured',
          sourceType: `detail:${offer.source}`,
          verificationStatus: 'unverified',
          observedAt: at,
          at,
        });
        record(repository, offer, { outcome: 'isbn_found', isbn: detail.isbn, facts }, at);
        if (requeueForNewEvidence(repository, offer.id, at)) report.requeued += 1;
      });
      report.isbnFound += 1;
    }
    onProgress({ ...report });
  }
  return report;
}
