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
import {
  MEASURE_PROFILE,
  STARTER_PROFILES,
  STARTER_SOURCES,
  ensureStarterProfiles,
  upgradeStarterProfiles,
} from '../starter-profiles.mjs';

test('first run creates the niche profiles without blocked sources and a rotating schedule, once', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    assert.deepEqual(ensureStarterProfiles(repository).created, [
      'Uniwersa',
      'Autorzy i cykle',
      'Pomiar: szeroki rynek',
    ]);
    const profiles = listScanProfiles(repository);
    assert.equal(profiles.length, 3);
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

test('starter profiles still holding the first version get the current phrases and sources, once', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const v1Sources = ['Vinted', 'Allegro Lokalnie', 'Tezeusz.pl', 'Empik', 'Dedalus.pl'];
    putScanProfile(repository, 'Uniwersa', {
      queries: [
        'Warhammer',
        'Warcraft',
        'Forgotten Realms',
        'Dragonlance',
        'Świat Dysku',
        'Terry Pratchett',
      ],
      sources: v1Sources,
    });
    // Edited by the operator (one phrase added): stays as it is.
    putScanProfile(repository, 'Autorzy i cykle', {
      queries: ['Dan Abnett', 'Moja fraza'],
      sources: v1Sources,
    });
    repository.database
      .prepare(
        "INSERT INTO app_preferences(key,value_json,updated_at) VALUES('starter_profiles_v1','{}','x')",
      )
      .run();
    assert.deepEqual(ensureStarterProfiles(repository).upgrade.upgraded, ['Uniwersa']);
    const byName = (name) => listScanProfiles(repository).find((p) => p.name === name);
    const [authors, universes] = [byName('Autorzy i cykle'), byName('Uniwersa')];
    assert.deepEqual(universes.queries, STARTER_PROFILES[0].queries);
    assert.deepEqual(universes.sources, STARTER_SOURCES);
    assert.ok(!universes.sources.includes('Dedalus.pl'));
    assert.deepEqual(authors.queries, ['Dan Abnett', 'Moja fraza']);
    // Once: an operator who puts the old version back keeps it.
    putScanProfile(repository, 'Uniwersa', { queries: ['Warhammer'], sources: v1Sources });
    assert.equal(ensureStarterProfiles(repository).upgrade.skipped, true);
    assert.deepEqual(byName('Uniwersa').queries, ['Warhammer']);
  } finally {
    repository.close();
  }
});

test('a fresh install gets the current profiles and nothing to upgrade later', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    ensureStarterProfiles(repository);
    assert.equal(upgradeStarterProfiles(repository).skipped, true);
    const universes = listScanProfiles(repository).find((p) => p.name === 'Uniwersa');
    assert.deepEqual(universes.queries, STARTER_PROFILES[0].queries);
  } finally {
    repository.close();
  }
});

test('the broad-market measurement profile is added once to an existing install, Vinted only', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    putScanProfile(repository, 'Uniwersa', { queries: ['Warhammer'], sources: ['Vinted'] });
    repository.database
      .prepare(
        "INSERT INTO app_preferences(key,value_json,updated_at) VALUES('starter_profiles_v1','{}','x')",
      )
      .run();
    assert.equal(ensureStarterProfiles(repository).measure.created, true);
    const measure = listScanProfiles(repository).find((p) => p.name === MEASURE_PROFILE.name);
    assert.deepEqual(measure.sources, ['Vinted']);
    // Deleted by the operator: not created again.
    repository.database.prepare('DELETE FROM scan_profiles WHERE name=?').run(MEASURE_PROFILE.name);
    assert.equal(ensureStarterProfiles(repository).measure.skipped, true);
    assert.equal(listScanProfiles(repository).length, 1);
  } finally {
    repository.close();
  }
});

test('an operator with own profiles on first run gets no measurement profile either', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    putScanProfile(repository, 'Mój', { queries: ['Wiedźmin'], sources: ['Vinted'] });
    ensureStarterProfiles(repository);
    ensureStarterProfiles(repository);
    assert.deepEqual(
      listScanProfiles(repository).map((p) => p.name),
      ['Mój'],
    );
  } finally {
    repository.close();
  }
});
