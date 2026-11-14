import assert from 'node:assert/strict';
import test from 'node:test';

import { listScanProfiles, putScanProfile } from '../scan-profiles-api.mjs';
import {
  ALL_PROFILES,
  createScanScheduler,
  getScanSchedule,
  nextProfile,
  saveScanSchedule,
} from '../scan-schedule.mjs';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { STARTER_SOURCES, ensureStarterProfiles } from '../starter-profiles.mjs';

test('first run creates the niche profiles without blocked sources and a rotating schedule, once', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    assert.deepEqual(ensureStarterProfiles(repository).created, ['Uniwersa', 'Autorzy i cykle']);
    const profiles = listScanProfiles(repository);
    assert.equal(profiles.length, 2);
    assert.ok(
      profiles.every(
        (profile) => !profile.sources.includes('Allegro') && !profile.sources.includes('OLX'),
      ),
    );
    assert.deepEqual(profiles[0].sources, STARTER_SOURCES);
    const schedule = getScanSchedule(repository);
    assert.equal(schedule.enabled, true);
    assert.equal(schedule.profile, ALL_PROFILES);
    assert.equal(schedule.everyHours, 12);
    assert.equal(ensureStarterProfiles(repository).skipped, true);
  } finally {
    repository.close();
  }
});

test('an operator who already has profiles gets none added', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    putScanProfile(repository, 'Mój', { queries: ['Wiedźmin'], sources: ['Vinted'] });
    assert.deepEqual(ensureStarterProfiles(repository).created, []);
    assert.equal(listScanProfiles(repository).length, 1);
    assert.equal(getScanSchedule(repository).enabled, false);
  } finally {
    repository.close();
  }
});

test('the rotating schedule scans one profile per run, in turn', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    putScanProfile(repository, 'A', { queries: ['a1'], sources: ['Vinted'] });
    putScanProfile(repository, 'B', { queries: ['b1'], sources: ['Vinted'] });
    let clock = Date.parse('2026-11-07T00:00:00.000Z');
    saveScanSchedule(repository, { enabled: true, profile: ALL_PROFILES, everyHours: 1 }, clock);
    const scanned = [];
    const scheduler = createScanScheduler({
      getRepository: () => repository,
      runScan: async (input) => {
        scanned.push(input.queries[0]);
        return 200;
      },
      now: () => clock,
    });
    for (let run = 0; run < 3; run++) {
      await scheduler.tick();
      clock += 3_600_000;
    }
    assert.deepEqual(scanned, ['a1', 'b1', 'a1']);
    assert.equal(nextProfile([], null), null);
  } finally {
    repository.close();
  }
});
