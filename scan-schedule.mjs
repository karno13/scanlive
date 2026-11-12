// Recurring scans of a saved profile, so the catalogue stays fresh without opening the app.
// The scheduler only decides *when*; the scan itself goes through the same endpoint (and the same
// single-scan guard, rate limits and safeguards) as a scan started from the interface.
import { request as httpRequest } from 'node:http';
import { listScanProfiles } from './scan-profiles-api.mjs';
import { NEWEST_ORDER_SOURCES } from './marketplaces.mjs';
import { hasNoLegalAccess, scannableSources } from './source-blocks.mjs';

const KEY = 'scan_schedule';
// Schedule value meaning "every saved profile in turn": one profile per run, alphabetical.
export const ALL_PROFILES = '__all__';
const MIN_HOURS = 1;
const MAX_HOURS = 168;
// Quick scan of the newest listings: its own interval, off by default.
const QUICK_DEFAULT_HOURS = 2;
const QUICK_MAX_HOURS = 24;

function quickSchedule(saved = {}) {
  return {
    enabled: saved.enabled === true,
    everyHours: Number.isInteger(saved.everyHours) ? saved.everyHours : QUICK_DEFAULT_HOURS,
    lastRunAt: saved.lastRunAt ?? null,
    lastResult: saved.lastResult ?? null,
    lastProfile: typeof saved.lastProfile === 'string' ? saved.lastProfile : null,
  };
}

function fail(code, statusCode = 400) {
  throw Object.assign(Error(code), { statusCode });
}

export function getScanSchedule(repository) {
  const row = repository.database
    .prepare('SELECT value_json FROM app_preferences WHERE key=?')
    .get(KEY);
  const saved = row ? JSON.parse(row.value_json) : {};
  return {
    enabled: saved.enabled === true,
    profile: typeof saved.profile === 'string' ? saved.profile : '',
    everyHours: Number.isFinite(saved.everyHours) ? saved.everyHours : 24,
    lastRunAt: saved.lastRunAt ?? null,
    lastResult: saved.lastResult ?? null,
    lastProfile: typeof saved.lastProfile === 'string' ? saved.lastProfile : null,
    // Sources left out of the last run (failed recently) and sources that failed during it.
    lastSkipped: Array.isArray(saved.lastSkipped) ? saved.lastSkipped : [],
    lastProblems: Array.isArray(saved.lastProblems) ? saved.lastProblems : [],
    quick: quickSchedule(saved.quick),
  };
}

// A source that failed its last check is left out of scheduled scans for this long, then tried
// again once so that it can come back on its own (health is updated by every scan that uses it).
export const DEAD_SOURCE_PAUSE_MS = 24 * 3_600_000;

/** The profile's sources minus those that failed their last check less than a day ago. */
export function sourcesToScan(repository, allSources, at = Date.now()) {
  // Allegro and OLX have no legal access (source-blocks.mjs): never part of a scheduled scan.
  const sources = scannableSources(allSources);
  let rows = [];
  try {
    rows = repository.database
      .prepare('SELECT source,status,last_checked_at FROM source_health')
      .all();
  } catch {
    return { sources: [...sources], skipped: [] };
  }
  const dead = new Set(
    rows
      .filter(
        (row) =>
          row.status === 'failed' &&
          at - Date.parse(row.last_checked_at || '') < DEAD_SOURCE_PAUSE_MS,
      )
      .map((row) => row.source),
  );
  return {
    sources: sources.filter((source) => !dead.has(source)),
    skipped: sources.filter((source) => dead.has(source)),
  };
}

/** Sources that reported errors in the scan saved at or after `since` (not the ones without legal access). */
export function scanProblems(repository, since) {
  try {
    const row = repository.database
      .prepare(
        'SELECT summary_json FROM scan_runs WHERE scanned_at>=? ORDER BY scanned_at DESC LIMIT 1',
      )
      .get(since);
    const errors = row ? JSON.parse(row.summary_json).errors || [] : [];
    return [
      ...new Set(
        errors.map((error) => error.source).filter((source) => source && !hasNoLegalAccess(source)),
      ),
    ].sort();
  } catch {
    return [];
  }
}

function store(repository, value, now) {
  repository.database
    .prepare(
      'INSERT INTO app_preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at',
    )
    .run(KEY, JSON.stringify(value), new Date(now).toISOString());
}

export function saveScanSchedule(repository, input, now = Date.now()) {
  const enabled = input?.enabled === true;
  const profile = typeof input?.profile === 'string' ? input.profile : '';
  const everyHours = Number(input?.everyHours);
  if (!Number.isInteger(everyHours) || everyHours < MIN_HOURS || everyHours > MAX_HOURS)
    fail('INVALID_SCHEDULE_INTERVAL');
  const current = getScanSchedule(repository);
  const quick = { ...current.quick };
  if (input?.quick !== undefined) {
    const hours = Number(input.quick?.everyHours ?? quick.everyHours);
    if (!Number.isInteger(hours) || hours < MIN_HOURS || hours > QUICK_MAX_HOURS)
      fail('INVALID_QUICK_SCAN_INTERVAL');
    quick.enabled = input.quick?.enabled === true;
    quick.everyHours = hours;
  }
  const profiles = listScanProfiles(repository);
  if (
    (enabled || quick.enabled) &&
    !(profile === ALL_PROFILES ? profiles.length : profiles.some((item) => item.name === profile))
  )
    fail('SCHEDULE_PROFILE_NOT_FOUND');
  store(repository, { ...current, enabled, profile, everyHours, quick }, now);
  return getScanSchedule(repository);
}

/** The profile after `last` in name order (wrapping), for the rotating schedule. */
export function nextProfile(profiles, last) {
  if (!profiles.length) return null;
  const index = profiles.findIndex((item) => item.name === last);
  return profiles[(index + 1) % profiles.length];
}

/** When the next quick scan (newest listings) is due, or null when it is off. */
export function nextQuickRunAt(schedule) {
  if (!schedule.quick?.enabled || !schedule.profile) return null;
  const last = schedule.quick.lastRunAt ? Date.parse(schedule.quick.lastRunAt) : 0;
  return last + schedule.quick.everyHours * 3_600_000;
}

/** When the next scan is due, or null when the schedule is off. */
export function nextRunAt(schedule) {
  if (!schedule.enabled || !schedule.profile) return null;
  const last = schedule.lastRunAt ? Date.parse(schedule.lastRunAt) : 0;
  return last + schedule.everyHours * 3_600_000;
}

export function createScanScheduler({
  getRepository,
  runScan,
  now = Date.now,
  checkEveryMs = 60_000,
  onEvent = () => {},
  setTimer = setInterval,
  clearTimer = clearInterval,
}) {
  let timer = null;
  let running = false;

  async function tick() {
    if (running) return { skipped: 'busy' };
    const repository = getRepository();
    if (!repository) return { skipped: 'no-catalog' };
    const schedule = getScanSchedule(repository);
    const due = nextRunAt(schedule);
    // The full scan has priority; the quick one runs in between, when it is due itself.
    if (due === null || now() < due) {
      const quickDue = nextQuickRunAt(schedule);
      if (quickDue !== null && now() >= quickDue) return quickTick(repository, schedule);
      return { skipped: due === null && quickDue === null ? 'off' : 'not-due' };
    }
    const profiles = listScanProfiles(repository);
    const profile =
      schedule.profile === ALL_PROFILES
        ? nextProfile(profiles, schedule.lastProfile)
        : profiles.find((item) => item.name === schedule.profile);
    running = true;
    let result;
    let skipped = [];
    let problems = [];
    try {
      if (!profile) result = 'profile-missing';
      else {
        const plan = sourcesToScan(repository, profile.sources, now());
        skipped = plan.skipped;
        if (!plan.sources.length) result = 'all-sources-down';
        else {
          const startedAt = new Date(now()).toISOString();
          const status = await runScan({ queries: profile.queries, sources: plan.sources });
          // 409: a manual scan is already running. Try again on the next check instead of doubling up.
          if (status === 409) return { skipped: 'scan-running' };
          const success = status >= 200 && status < 300;
          problems = success ? scanProblems(repository, startedAt) : [];
          result = success ? (problems.length ? 'partial' : 'ok') : `http-${status}`;
        }
      }
    } catch (error) {
      result = `error:${String(error?.message ?? error).slice(0, 60)}`;
    } finally {
      running = false;
    }
    // Record the attempt even on failure so that a broken profile cannot be retried every minute.
    const fresh = getScanSchedule(repository);
    store(
      repository,
      {
        ...fresh,
        lastRunAt: new Date(now()).toISOString(),
        lastResult: result,
        lastProfile: profile?.name ?? fresh.lastProfile,
        lastSkipped: skipped,
        lastProblems: problems,
      },
      now(),
    );
    onEvent({
      type: 'scheduled_scan',
      profile: profile?.name ?? schedule.profile,
      result,
      skipped,
      problems,
    });
    return { ran: true, result, skipped, problems };
  }

  async function quickTick(repository, schedule) {
    const profiles = listScanProfiles(repository);
    const profile =
      schedule.profile === ALL_PROFILES
        ? nextProfile(profiles, schedule.quick.lastProfile)
        : profiles.find((item) => item.name === schedule.profile);
    running = true;
    let result;
    try {
      const sortable = (profile?.sources || []).filter((source) =>
        NEWEST_ORDER_SOURCES.has(source),
      );
      const plan = sourcesToScan(repository, sortable, now());
      if (!profile) result = 'profile-missing';
      else if (!sortable.length) result = 'no-sortable-source';
      else if (!plan.sources.length) result = 'all-sources-down';
      else {
        const status = await runScan({
          queries: profile.queries,
          sources: plan.sources,
          mode: 'newest',
        });
        if (status === 409) return { skipped: 'scan-running' };
        result = status >= 200 && status < 300 ? 'ok' : `http-${status}`;
      }
    } catch (error) {
      result = `error:${String(error?.message ?? error).slice(0, 60)}`;
    } finally {
      running = false;
    }
    const fresh = getScanSchedule(repository);
    store(
      repository,
      {
        ...fresh,
        quick: {
          ...fresh.quick,
          lastRunAt: new Date(now()).toISOString(),
          lastResult: result,
          lastProfile: profile?.name ?? fresh.quick.lastProfile,
        },
      },
      now(),
    );
    onEvent({ type: 'scheduled_quick_scan', profile: profile?.name ?? schedule.profile, result });
    return { ran: true, quick: true, result };
  }

  return {
    tick,
    start() {
      if (!timer) timer = setTimer(() => void tick().catch(() => {}), checkEveryMs);
      timer?.unref?.();
    },
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}

/** POSTs to this server's own scan endpoint exactly like the browser does. */
export function localScanRunner(port) {
  return (input) =>
    new Promise((resolve, reject) => {
      const body = JSON.stringify(input);
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/api/search',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            Origin: `http://127.0.0.1:${port}`,
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end(body);
    });
}
