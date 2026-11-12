// @ts-check
// Per source: does it work, since when it does not, and why — from source_health (last check of
// each source) and the scan_runs summaries (which scan first failed after the last success).
import { blockedSources, hasNoLegalAccess, NO_LEGAL_ACCESS } from './source-blocks.mjs';

const RANK = { down: 0, never: 0, unknown: 1, ok: 2, no_access: 3 };

const REASONS = {
  SOURCE_CAPTCHA: 'serwis żąda CAPTCHA (blokada automatów)',
  SOURCE_HTTP_403: 'serwis odmawia dostępu (HTTP 403)',
  SOURCE_HTTP_429: 'serwis prosi o wolniejsze zapytania (HTTP 429)',
  SOURCE_TIMEOUT: 'serwis nie odpowiada w czasie',
  SOURCE_NETWORK: 'brak połączenia z serwisem',
  SOURCE_PARSE: 'zmieniony układ strony — wyniki nieczytelne',
};

/** Polish description of a source error code. */
export function sourceReason(code) {
  if (!code) return null;
  if (REASONS[code]) return REASONS[code];
  const http = /^SOURCE_HTTP_(\d{3})$/.exec(code);
  if (http) return `błąd serwisu (HTTP ${http[1]})`;
  return 'błąd odczytu (' + code + ')';
}

/**
 * @typedef {{ source: string, state: 'ok' | 'down' | 'never' | 'unknown' | 'no_access', lastSuccessAt: string | null,
 *   lastCheckedAt: string | null, downSince: string | null, reasonCode: string | null, reason: string | null }} SourceState
 */

/**
 * State of each known source, working ones last. A source is down when its last check failed or
 * every recent scan that asked it was refused; "never" when it has not worked once.
 * @param {{ database: any }} repository
 * @param {string[]} sources
 * @returns {SourceState[]}
 */
export function sourceStatus(repository, sources) {
  const db = repository.database;
  /** @type {Map<string, any>} */
  const health = new Map(
    db
      .prepare('SELECT * FROM source_health')
      .all()
      .map((/** @type {any} */ row) => [row.source, row]),
  );
  /** @type {Record<string, string>} */
  const blocked = blockedSources(repository);
  const runs = db
    .prepare('SELECT scanned_at, summary_json FROM scan_runs ORDER BY scanned_at')
    .all()
    .map((/** @type {any} */ row) => {
      try {
        const summary = JSON.parse(row.summary_json);
        return {
          at: row.scanned_at,
          errors: new Map(
            (Array.isArray(summary.errors) ? summary.errors : [])
              .filter((/** @type {any} */ error) => error?.source)
              .map((/** @type {any} */ error) => [error.source, error.code]),
          ),
        };
      } catch {
        return { at: row.scanned_at, errors: new Map() };
      }
    });
  const all = [...new Set([...sources, ...health.keys()])];
  return (
    all
      .map((source) => {
        if (hasNoLegalAccess(source))
          return {
            source,
            state: /** @type {const} */ ('no_access'),
            lastSuccessAt: null,
            lastCheckedAt: null,
            downSince: null,
            reasonCode: 'NO_LEGAL_ACCESS',
            reason: NO_LEGAL_ACCESS[source],
          };
        const row = health.get(source);
        if (!row && !blocked[source])
          return {
            source,
            state: /** @type {const} */ ('unknown'),
            lastSuccessAt: null,
            lastCheckedAt: null,
            downSince: null,
            reasonCode: null,
            reason: null,
          };
        const down = Boolean(blocked[source]) || row?.status === 'failed';
        const lastSuccessAt = row?.last_success_at || null;
        const reasonCode = down ? blocked[source] || row?.last_error || null : null;
        // The first failed scan after the last success (or ever, when it never worked).
        const firstFailure = down
          ? runs.find((run) => (!lastSuccessAt || run.at > lastSuccessAt) && run.errors.has(source))
          : null;
        /** @type {SourceState['state']} */
        const state = down ? (lastSuccessAt ? 'down' : 'never') : 'ok';
        return {
          source,
          state,
          lastSuccessAt,
          lastCheckedAt: row?.last_checked_at || null,
          downSince: down ? firstFailure?.at || row?.last_error_at || null : null,
          reasonCode,
          reason: sourceReason(reasonCode),
        };
      })
      // Not working first, then not yet checked, working last.
      .sort((a, b) => RANK[a.state] - RANK[b.state] || a.source.localeCompare(b.source, 'pl'))
  );
}
