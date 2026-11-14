// @ts-check
// Sources that refused automated reads in every recent scan (Allegro answers with a CAPTCHA, OLX
// with HTTP 403). Shown honestly in the scanner instead of being retried silently; BookFlip never
// tries to get around such a block.
const BLOCK_CODES = new Set(['SOURCE_CAPTCHA', 'SOURCE_HTTP_403', 'SOURCE_FORBIDDEN_UNREADABLE']);

export function blockedSources(repository, { recentRuns = 3 } = {}) {
  const runs = repository.database
    .prepare('SELECT summary_json FROM scan_runs ORDER BY scanned_at DESC LIMIT ?')
    .all(Math.max(1, recentRuns))
    .map((row) => {
      try {
        return JSON.parse(row.summary_json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (!runs.length) return {};
  const perRun = runs.map((run) => {
    const codes = new Map();
    for (const error of Array.isArray(run.errors) ? run.errors : [])
      if (error?.source && BLOCK_CODES.has(error.code)) codes.set(error.source, error.code);
    return codes;
  });
  const blocked = {};
  // Blocked only when every recent scan that asked the source was refused.
  for (const [source, code] of perRun[0])
    if (perRun.every((codes) => codes.has(source))) blocked[source] = code;
  return blocked;
}

/**
 * Sources BookFlip does not read because there is no legal way in (docs/SOURCES-ACCESS-2026-11.md):
 * Allegro answers automated search with a CAPTCHA and has no public offer search in its API; OLX
 * answers 403 and its partner API is for one's own adverts only. They are not scanned, not counted
 * as failures and not shown in red — a stated fact, not an error.
 */
export const NO_LEGAL_ACCESS = Object.freeze({
  Allegro: 'brak legalnego dostępu do wyszukiwania ofert (REST API nie ma wyszukiwarki ofert)',
  OLX: 'brak legalnego dostępu do wyszukiwania ofert (API partnera służy tylko do własnych ogłoszeń)',
});

/** @param {unknown} source */
export const hasNoLegalAccess = (source) =>
  Object.prototype.hasOwnProperty.call(NO_LEGAL_ACCESS, String(source));

/** The sources without the ones that have no legal access. @param {string[]} sources */
export const scannableSources = (sources) => sources.filter((source) => !hasNoLegalAccess(source));
