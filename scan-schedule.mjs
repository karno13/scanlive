// Recurring scans of a saved profile, so the catalogue stays fresh without opening the app.
// The scheduler only decides *when*; the scan itself goes through the same endpoint (and the same
// single-scan guard, rate limits and safeguards) as a scan started from the interface.
import { request as httpRequest } from 'node:http';
import { listScanProfiles } from './scan-profiles-api.mjs';
import { NEWEST_ORDER_SOURCES } from './marketplaces.mjs';
import { hasNoLegalAccess, scannableSources } from './source-blocks.mjs';
import { sniperTargets } from './market-index.mjs';

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

// Snajper: the newest Vinted listings for the works the market index rates best (market-index.mjs),
// a few phrases per run, every few minutes, so a deal is seen while it is still for sale. Off until
// the owner turns it on in „Okazje”. Same scan endpoint, gate and limits as every other scan.
export const SNIPER_BATCH = 10;
export const SNIPER_MINUTES = [15, 20, 30, 60];
const SNIPER_SOURCE = 'Vinted';
function sniperSchedule(saved = {}) {
  return {
    enabled: saved.enabled === true,
    everyMinutes: SNIPER_MINUTES.includes(saved.everyMinutes) ? saved.everyMinutes : 20,
    lastRunAt: saved.lastRunAt ?? null,
    lastResult: saved.lastResult ?? null,
    cursor: Number.isInteger(saved.cursor) && saved.cursor >= 0 ? saved.cursor : 0,
    lastPhrases: Array.isArray(saved.lastPhrases) ? saved.lastPhrases.map(String) : [],
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
    sniper: sniperSchedule(saved.sniper),
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

/** Turns the sniper on or off and sets its interval; the rest of the schedule stays. */
export function saveSniper(repository, input, now = Date.now()) {
  const current = getScanSchedule(repository);
  const everyMinutes = Number(input?.everyMinutes ?? current.sniper.everyMinutes);
  if (!SNIPER_MINUTES.includes(everyMinutes)) fail('INVALID_SNIPER_INTERVAL');
  store(
    repository,
    { ...current, sniper: { ...current.sniper, enabled: input?.enabled === true, everyMinutes } },
    now,
  );
  return getScanSchedule(repository).sniper;
}

/** When the next sniper run is due, or null when it is off. */
export function nextSniperRunAt(schedule) {
  if (!schedule.sniper?.enabled) return null;
  const last = schedule.sniper.lastRunAt ? Date.parse(schedule.sniper.lastRunAt) : 0;
  return last + schedule.sniper.everyMinutes * 60_000;
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

// The runner answers with the HTTP status, or { status, error } when it read the body: a 409 is
// either another scan in progress (try again next minute) or this scan cancelled by the owner.
function scanReply(reply) {
  const { status, error = null } = typeof reply === 'number' ? { status: reply } : reply;
  return { status, cancelled: status === 409 && error === 'SCAN_CANCELLED' };
}

export function createScanScheduler({
  getRepository,
  runScan,
  getTargets = (repository) => sniperTargets(repository),
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
    // The full scan has priority; the quick one runs in between, the sniper in the gaps left.
    if (due === null || now() < due) {
      const quickDue = nextQuickRunAt(schedule);
      if (quickDue !== null && now() >= quickDue) return quickTick(repository, schedule);
      const sniperDue = nextSniperRunAt(schedule);
      if (sniperDue !== null && now() >= sniperDue) return sniperTick(repository, schedule);
      return {
        skipped: due === null && quickDue === null && sniperDue === null ? 'off' : 'not-due',
      };
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
          const { status, cancelled } = scanReply(
            await runScan({ queries: profile.queries, sources: plan.sources }),
          );
          // A cancelled scan counts as this run: starting it again a minute later would make
          // "Anuluj" useless (2026-11-20: the same profile restarted after every cancel).
          if (status === 409 && !cancelled) return { skipped: 'scan-running' };
          const success = status >= 200 && status < 300;
          problems = success ? scanProblems(repository, startedAt) : [];
          result = cancelled
            ? 'cancelled'
            : success
              ? problems.length
                ? 'partial'
                : 'ok'
              : `http-${status}`;
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
        const { status, cancelled } = scanReply(
          await runScan({ queries: profile.queries, sources: plan.sources, mode: 'newest' }),
        );
        if (status === 409 && !cancelled) return { skipped: 'scan-running' };
        result = cancelled ? 'cancelled' : status >= 200 && status < 300 ? 'ok' : `http-${status}`;
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

  async function sniperTick(repository, schedule) {
    running = true;
    let result;
    let phrases = [];
    let cursor = schedule.sniper.cursor;
    try {
      const targets = getTargets(repository);
      const plan = sourcesToScan(repository, [SNIPER_SOURCE], now());
      if (!targets.length) result = 'no-targets';
      else if (!plan.sources.length) result = 'source-down';
      else {
        const start = cursor % targets.length;
        phrases = [...targets.slice(start), ...targets.slice(0, start)]
          .slice(0, SNIPER_BATCH)
          .map((target) => target.phrase);
        cursor = (start + phrases.length) % targets.length;
        const { status, cancelled } = scanReply(
          await runScan({ queries: phrases, sources: plan.sources, mode: 'newest' }),
        );
        if (status === 409 && !cancelled) return { skipped: 'scan-running' };
        result = cancelled ? 'cancelled' : status >= 200 && status < 300 ? 'ok' : `http-${status}`;
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
        sniper: {
          ...fresh.sniper,
          lastRunAt: new Date(now()).toISOString(),
          lastResult: result,
          cursor,
          lastPhrases: phrases,
        },
      },
      now(),
    );
    onEvent({ type: 'sniper_scan', phrases: phrases.length, result });
    return { ran: true, sniper: true, result, phrases };
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

/** POSTs to this server's own scan endpoint exactly like the browser does; resolves { status, error }. */
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
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (text += chunk));
          res.on('end', () => {
            let error = null;
            try {
              error = JSON.parse(text)?.error ?? null;
            } catch {}
            resolve({ status: res.statusCode, error });
          });
        },
      );
      req.on('error', reject);
      req.end(body);
    });
}
