import assert from 'node:assert/strict';
import test from 'node:test';
import { putScanProfile } from '../scan-profiles-api.mjs';
import {
  createScanScheduler,
  getScanSchedule,
  localScanRunner,
  nextRunAt,
  saveScanSchedule,
} from '../scan-schedule.mjs';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { createLocalAppServer } from '../local-app.mjs';
import { createProductionCatalog } from '../catalog-production.mjs';
import { awaitScan } from '../scan-cancellation.mjs';

function setup() {
  const repo = new SqliteCatalogRepository(':memory:');
  putScanProfile(repo, 'Fantasy', { queries: ['Warcraft', 'Świat Dysku'], sources: ['Vinted'] });
  return repo;
}

test('the schedule is off by default and validates interval and profile', () => {
  const repo = setup();
  assert.equal(getScanSchedule(repo).enabled, false);
  assert.throws(
    () => saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 0 }),
    /INVALID_SCHEDULE_INTERVAL/,
  );
  assert.throws(
    () => saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 999 }),
    /INVALID_SCHEDULE_INTERVAL/,
  );
  assert.throws(
    () => saveScanSchedule(repo, { enabled: true, profile: 'Nie ma', everyHours: 24 }),
    /SCHEDULE_PROFILE_NOT_FOUND/,
  );
  const saved = saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 12 });
  assert.deepEqual([saved.enabled, saved.profile, saved.everyHours], [true, 'Fantasy', 12]);
});

test('next run is due immediately when never run, then every N hours', () => {
  const repo = setup();
  const schedule = saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 6 });
  assert.equal(nextRunAt(schedule), 6 * 3_600_000, 'epoch + 6h, i.e. long overdue');
  assert.equal(nextRunAt({ ...schedule, enabled: false }), null);
  const ran = { ...schedule, lastRunAt: '2026-11-07T10:00:00.000Z' };
  assert.equal(nextRunAt(ran), Date.parse('2026-11-07T16:00:00.000Z'));
});

test('a due scan runs the saved profile once and records the attempt', async () => {
  const repo = setup();
  saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 6 });
  let clock = Date.parse('2026-11-07T12:00:00Z');
  const calls = [];
  const scheduler = createScanScheduler({
    getRepository: () => repo,
    runScan: async (input) => (calls.push(input), 200),
    now: () => clock,
  });
  assert.deepEqual(await scheduler.tick(), { ran: true, result: 'ok', skipped: [], problems: [] });
  assert.deepEqual(calls, [{ queries: ['Warcraft', 'Świat Dysku'], sources: ['Vinted'] }]);
  assert.equal(getScanSchedule(repo).lastRunAt, '2026-11-07T12:00:00.000Z');
  assert.deepEqual(await scheduler.tick(), { skipped: 'not-due' });
  clock += 6 * 3_600_000;
  assert.equal((await scheduler.tick()).ran, true);
  assert.equal(calls.length, 2);
});

test('a manual scan in progress (409) is retried later without recording a run', async () => {
  const repo = setup();
  saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 1 });
  const scheduler = createScanScheduler({
    getRepository: () => repo,
    runScan: async () => 409,
    now: () => Date.now(),
  });
  assert.deepEqual(await scheduler.tick(), { skipped: 'scan-running' });
  assert.equal(getScanSchedule(repo).lastRunAt, null);
});

test('a scheduled scan the owner cancels is recorded and not started again a minute later', async () => {
  const catalog = createProductionCatalog({
    databasePath: ':memory:',
    fetcher: async () => {
      throw Error('NETWORK_NOT_ALLOWED');
    },
  });
  const repo = catalog.repository;
  putScanProfile(repo, 'Fantasy', { queries: ['Warcraft'], sources: ['Empik'] });
  saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 12 });
  let started;
  const startedPromise = new Promise((resolve) => (started = resolve));
  let scans = 0;
  // The scan waits until it is cancelled, like a long category read.
  const search = async (input, options) => {
    scans += 1;
    started();
    await awaitScan(new Promise(() => {}), options.signal);
  };
  const server = createLocalAppServer({ catalogProvider: () => catalog, search });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  const clock = Date.parse('2026-11-20T18:00:00Z');
  const scheduler = createScanScheduler({
    getRepository: () => repo,
    runScan: localScanRunner(port),
    now: () => clock,
  });
  try {
    const run = scheduler.tick();
    await startedPromise;
    const stop = await fetch(base + '/api/search/cancel', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
    });
    assert.equal(stop.status, 202);
    assert.equal((await run).result, 'cancelled');
    assert.equal(getScanSchedule(repo).lastRunAt, '2026-11-20T18:00:00.000Z');
    assert.deepEqual(await scheduler.tick(), { skipped: 'not-due' });
    assert.equal(scans, 1);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    catalog.close();
  }
});

test('a scan already in progress is told apart from a cancelled one by the answer', async () => {
  const repo = setup();
  saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 1 });
  const scheduler = createScanScheduler({
    getRepository: () => repo,
    runScan: async () => ({ status: 409, error: 'SCAN_ALREADY_RUNNING' }),
    now: () => Date.now(),
  });
  assert.deepEqual(await scheduler.tick(), { skipped: 'scan-running' });
  assert.equal(getScanSchedule(repo).lastRunAt, null);
});

test('a failing scan is recorded, so a broken profile is not retried every minute', async () => {
  const repo = setup();
  saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 1 });
  const events = [];
  const scheduler = createScanScheduler({
    getRepository: () => repo,
    runScan: async () => {
      throw new Error('ECONNREFUSED');
    },
    now: () => Date.parse('2026-11-07T12:00:00Z'),
    onEvent: (event) => events.push(event),
  });
  const outcome = await scheduler.tick();
  assert.match(outcome.result, /^error:ECONNREFUSED/);
  assert.equal(getScanSchedule(repo).lastRunAt, '2026-11-07T12:00:00.000Z');
  assert.equal(events[0].type, 'scheduled_scan');
  assert.deepEqual(await scheduler.tick(), { skipped: 'not-due' });
});

test('an enabled schedule whose profile was deleted records "profile-missing" and does nothing else', async () => {
  const repo = setup();
  saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 1 });
  repo.database.prepare("DELETE FROM scan_profiles WHERE name='Fantasy'").run();
  let scans = 0;
  const scheduler = createScanScheduler({
    getRepository: () => repo,
    runScan: async () => (scans++, 200),
    now: () => Date.now(),
  });
  assert.equal((await scheduler.tick()).result, 'profile-missing');
  assert.equal(scans, 0);
});

test('scheduled scans leave out sources that failed less than a day ago and report partial runs', async () => {
  const repo = setup();
  saveScanSchedule(repo, { enabled: true, profile: 'Fantasy', everyHours: 6 });
  const db = repo.database;
  db.prepare("UPDATE scan_profiles SET sources_json=? WHERE name='Fantasy'").run(
    JSON.stringify(['Vinted', 'Allegro Lokalnie', 'Tezeusz.pl']),
  );
  const clock = Date.parse('2026-11-07T12:00:00Z');
  const insert = db.prepare(
    'INSERT INTO source_health(source,last_checked_at,last_success_at,last_error_at,last_error,status) VALUES(?,?,?,?,?,?)',
  );
  insert.run(
    'Allegro Lokalnie',
    '2026-11-07T08:00:00.000Z',
    null,
    '2026-11-07T08:00:00.000Z',
    'SOURCE_CAPTCHA',
    'failed',
  );
  insert.run(
    'Tezeusz.pl',
    '2026-11-05T08:00:00.000Z',
    null,
    '2026-11-05T08:00:00.000Z',
    'SOURCE_HTTP_403',
    'failed',
  );
  const calls = [];
  const scheduler = createScanScheduler({
    getRepository: () => repo,
    runScan: async (input) => {
      calls.push(input);
      db.prepare('INSERT INTO scan_runs(scanned_at,summary_json,created_at) VALUES(?,?,?)').run(
        '2026-11-07T12:00:01.000Z',
        JSON.stringify({
          errors: [{ source: 'Tezeusz.pl', query: 'Warcraft', code: 'SOURCE_HTTP_403' }],
        }),
        '2026-11-07T12:00:01.000Z',
      );
      return 200;
    },
    now: () => clock,
  });
  const outcome = await scheduler.tick();
  // Allegro failed 4 h ago: paused. OLX failed 2 days ago: tried again.
  assert.deepEqual(calls[0].sources, ['Vinted', 'Tezeusz.pl']);
  assert.deepEqual(outcome, {
    ran: true,
    result: 'partial',
    skipped: ['Allegro Lokalnie'],
    problems: ['Tezeusz.pl'],
  });
  assert.deepEqual(getScanSchedule(repo).lastSkipped, ['Allegro Lokalnie']);
  assert.deepEqual(getScanSchedule(repo).lastProblems, ['Tezeusz.pl']);
});
