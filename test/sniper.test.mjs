import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import {
  createScanScheduler,
  getScanSchedule,
  nextSniperRunAt,
  saveSniper,
  SNIPER_BATCH,
} from '../scan-schedule.mjs';
import { createLocalAppServer } from '../local-app.mjs';

const targets = Array.from({ length: 14 }, (_, i) => ({ phrase: `Tytuł ${i}` }));

test('the sniper is off by default and validates its interval', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    assert.equal(getScanSchedule(repo).sniper.enabled, false);
    assert.equal(nextSniperRunAt(getScanSchedule(repo)), null);
    assert.throws(
      () => saveSniper(repo, { enabled: true, everyMinutes: 5 }),
      /INVALID_SNIPER_INTERVAL/,
    );
    assert.deepEqual(
      {
        enabled: saveSniper(repo, { enabled: true, everyMinutes: 15 }).enabled,
        every: getScanSchedule(repo).sniper.everyMinutes,
      },
      { enabled: true, every: 15 },
    );
  } finally {
    repo.close();
  }
});

test('the sniper scans the newest Vinted listings for a batch of targets, in turn', async () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    saveSniper(repo, { enabled: true, everyMinutes: 20 });
    const calls = [];
    let clock = Date.parse('2026-11-20T12:00:00Z');
    const scheduler = createScanScheduler({
      getRepository: () => repo,
      runScan: async (input) => (calls.push(input), 200),
      getTargets: () => targets,
      now: () => clock,
    });
    const first = await scheduler.tick();
    assert.equal(first.sniper, true);
    assert.equal(first.result, 'ok');
    assert.deepEqual(calls[0], {
      queries: targets.slice(0, SNIPER_BATCH).map((target) => target.phrase),
      sources: ['Vinted'],
      mode: 'newest',
    });
    assert.deepEqual(await scheduler.tick(), { skipped: 'not-due' });
    clock += 20 * 60_000;
    await scheduler.tick();
    // The next run continues where the last one stopped and wraps around.
    assert.deepEqual(calls[1].queries, [
      ...targets.slice(SNIPER_BATCH).map((target) => target.phrase),
      ...targets
        .slice(0, SNIPER_BATCH - (targets.length - SNIPER_BATCH))
        .map((target) => target.phrase),
    ]);
    assert.equal(getScanSchedule(repo).sniper.lastResult, 'ok');
    assert.equal(getScanSchedule(repo).sniper.lastPhrases.length, SNIPER_BATCH);
  } finally {
    repo.close();
  }
});

test('the sniper waits for a running scan and does nothing without targets', async () => {
  const repo = new SqliteCatalogRepository(':memory:');
  try {
    saveSniper(repo, { enabled: true, everyMinutes: 20 });
    const busy = createScanScheduler({
      getRepository: () => repo,
      runScan: async () => 409,
      getTargets: () => targets,
    });
    assert.deepEqual(await busy.tick(), { skipped: 'scan-running' });
    assert.equal(
      getScanSchedule(repo).sniper.lastRunAt,
      null,
      'not recorded: tried again next minute',
    );
    const calls = [];
    const empty = createScanScheduler({
      getRepository: () => repo,
      runScan: async (input) => (calls.push(input), 200),
      getTargets: () => [],
    });
    assert.equal((await empty.tick()).result, 'no-targets');
    assert.deepEqual(calls, []);
  } finally {
    repo.close();
  }
});

test('GET and PUT /api/sniper', async () => {
  const repo = new SqliteCatalogRepository(':memory:');
  const server = createLocalAppServer({ catalogProvider: () => ({ repository: repo }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(null)));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const status = await (await fetch(`${base}/api/sniper`)).json();
    assert.equal(status.enabled, false);
    assert.equal(status.targets, 0);
    const saved = await fetch(`${base}/api/sniper`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ enabled: true, everyMinutes: 30 }),
    });
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.enabled, true);
    assert.equal(body.everyMinutes, 30);
    const alerts = await (await fetch(`${base}/api/deals/alerts`)).json();
    assert.deepEqual(alerts, { unseen: 0, items: [] });
  } finally {
    await new Promise((resolve) => server.close(() => resolve(null)));
    repo.close();
  }
});
