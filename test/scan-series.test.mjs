import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCWORLD_TITLES } from '../app/views/scan-series.js';
import { MAX_SCAN_QUERIES } from '../app/core/scan-limits.js';
import { searchOffers, validateSearchInput } from '../scan-engine.mjs';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { putScanProfile, listScanProfiles } from '../scan-profiles-api.mjs';

test('a complete series can be saved as a profile and every title is scanned', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    putScanProfile(repository, 'Świat Dysku', { queries: DISCWORLD_TITLES, sources: ['Empik'] });
    const profile = listScanProfiles(repository)[0];
    assert.deepEqual(profile.queries, DISCWORLD_TITLES);
    const scanned = [];
    const result = await searchOffers(profile, {
      scanner: async (task) => {
        scanned.push(task.title);
        return { offers: [], rejected: {}, pagination: { state: 'end' } };
      },
    });
    assert.deepEqual(scanned, DISCWORLD_TITLES);
    assert.equal(result.results.length, 41);
  } finally {
    repository.close();
  }
});

test('scan and profile limits accept 200 phrases and reject 201 without truncation', () => {
  const queries = Array.from({ length: MAX_SCAN_QUERIES }, (_, index) => `Tytuł ${index + 1}`);
  assert.equal(
    validateSearchInput({ queries, sources: ['Empik'] }).queries.length,
    MAX_SCAN_QUERIES,
  );
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    putScanProfile(repository, 'Duża seria', { queries, sources: ['Empik'] });
    assert.equal(listScanProfiles(repository)[0].queries.length, MAX_SCAN_QUERIES);
    const tooMany = [...queries, 'Nadmiarowy tytuł'];
    assert.throws(
      () => validateSearchInput({ queries: tooMany, sources: ['Empik'] }),
      /INVALID_QUERIES/,
    );
    assert.throws(
      () => putScanProfile(repository, 'Za dużo', { queries: tooMany, sources: ['Empik'] }),
      /INVALID_SCAN_PROFILE/,
    );
  } finally {
    repository.close();
  }
});
