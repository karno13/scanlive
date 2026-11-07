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
  for (const [source, code] of perRun[0]) if (perRun.every((codes) => codes.has(source))) blocked[source] = code;
  return blocked;
}
