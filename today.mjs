// @ts-check
// The "Dziś" start view in one request: what changed since the previous visit (new offers, price
// changes), the decisions waiting, the state of every source, the last and the next scan. Each count
// comes with the filters of the list it opens, so the number and the list always agree.
import { countCatalogOffers, reviewQueueSummary } from './catalog-api.mjs';
import { getScanSchedule, nextQuickRunAt, nextRunAt } from './scan-schedule.mjs';
import { sourceStatus } from './source-status.mjs';
import { hasNoLegalAccess } from './source-blocks.mjs';
import { todayMeasures } from './catalog-measures.mjs';

/**
 * @param {{ database: any }} repository
 * @param {{ since?: string | null, sources: string[] }} options
 */
export function todaySummary(repository, { since = null, sources }) {
  const db = repository.database;
  const last = db
    .prepare('SELECT scanned_at, summary_json FROM scan_runs ORDER BY scanned_at DESC LIMIT 1')
    .get();
  /** @type {any} */
  let summary = {};
  try {
    summary = last ? JSON.parse(last.summary_json) : {};
  } catch {}
  const validSince =
    since && !Number.isNaN(Date.parse(since)) ? new Date(since).toISOString() : null;
  // Without a previous visit (first start, other browser) "new" means: new in the last scan.
  const scope = validSince ? 'visit' : last ? 'scan' : 'none';
  const newFilters =
    scope === 'visit'
      ? { since: validSince, sort: 'newest' }
      : scope === 'scan'
        ? { scan: last.scanned_at, scanChange: 'new', sort: 'newest' }
        : null;
  const priceFilters =
    scope === 'visit'
      ? { priceChangedSince: validSince, sort: 'newest' }
      : scope === 'scan'
        ? { scan: last.scanned_at, scanChange: 'price', sort: 'newest' }
        : null;
  const schedule = getScanSchedule(repository);
  const errors = Array.isArray(summary.errors) ? summary.errors : [];
  return {
    since: validSince,
    scope,
    newOffers: newFilters
      ? { count: countCatalogOffers(repository, newFilters), filters: newFilters }
      : null,
    priceChanges: priceFilters
      ? { count: countCatalogOffers(repository, priceFilters), filters: priceFilters }
      : null,
    queue: reviewQueueSummary(repository),
    measures: todayMeasures(repository),
    sources: sourceStatus(repository, sources),
    lastScan: last
      ? {
          at: last.scanned_at,
          found: Number(summary.found || 0),
          newOffers: Number(summary.newOffers || 0),
          priceChanges: Number(summary.priceChanges || 0),
          failedSources: [
            ...new Set(errors.map((/** @type {any} */ error) => error?.source).filter(Boolean)),
          ].filter((source) => !hasNoLegalAccess(source)),
          queries: Array.isArray(summary.context?.queries) ? summary.context.queries.length : null,
          durationMs: Number.isFinite(summary.context?.durationMs)
            ? Number(summary.context.durationMs)
            : null,
          filters: { scan: last.scanned_at },
        }
      : null,
    nextScan: {
      enabled: schedule.enabled === true,
      profile: schedule.profile || null,
      at: toIso(nextRunAt(schedule)),
      quickAt: toIso(nextQuickRunAt(schedule)),
    },
  };
}

/** @param {number | null} time */
function toIso(time) {
  return time === null || !Number.isFinite(time) ? null : new Date(time).toISOString();
}
