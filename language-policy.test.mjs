import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { getPolishOnly, setPolishOnly, rejectForeignEditions } from './language-policy.mjs';
import { tradingRoute } from './trading-api.mjs';
import { searchOffers } from './local-app.mjs';

function queue(repository) {
  const db = repository.database;
  const add = (n, reason) => {
    const offer = repository.upsertOffer({ source: 'Empik', normalizedUrl: `https://www.empik.com/b${n},p${n},ksiazka-p`, originalTitle: 'Fourth Wing ' + n, currentPrice: 5000, at: '2026-11-08T10:00:00Z' });
    repository.putIdentificationJob({ offerId: offer.id, status: 'review_required', at: '2026-11-08T10:00:00Z' });
    db.prepare('UPDATE identification_jobs SET result_json=? WHERE offer_id=?').run(JSON.stringify({ decision: 'review_required', reason: [reason] }), offer.id);
    return offer.id;
  };
  return { foreign: add(1, 'foreign_edition'), rulebook: add(2, 'game_rulebook'), other: add(3, 'isbn_not_found_in_metadata_sources') };
}
const statusOf = (repository, offerId) => repository.database.prepare('SELECT status FROM identification_jobs WHERE offer_id=?').get(offerId).status;

test('"Tylko polskie wydania" is on by default and rejects foreign editions waiting in review', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const ids = queue(repository);
    assert.equal(getPolishOnly(repository), true);
    assert.deepEqual(rejectForeignEditions(repository), { rejected: 1 });
    assert.equal(statusOf(repository, ids.foreign), 'completed');
    assert.equal(statusOf(repository, ids.rulebook), 'review_required');
    assert.equal(statusOf(repository, ids.other), 'review_required');
    const decision = repository.database.prepare('SELECT action, created_by FROM review_decisions WHERE offer_id=?').get(ids.foreign);
    assert.deepEqual({ ...decision }, { action: 'excluded', created_by: 'auto_polish_only' });
  } finally {
    repository.close?.();
  }
});

test('switched off, foreign editions stay in review; switching on through the API rejects them', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const ids = queue(repository);
    setPolishOnly(repository, false);
    assert.deepEqual(rejectForeignEditions(repository), { rejected: 0 });
    assert.deepEqual(await tradingRoute({ repo: repository, method: 'GET', path: '/api/scan-language' }), { polishOnly: false });
    assert.deepEqual(await tradingRoute({ repo: repository, method: 'PUT', path: '/api/scan-language', input: { polishOnly: true } }), { polishOnly: true, rejected: 1 });
    assert.equal(statusOf(repository, ids.foreign), 'completed');
  } finally {
    repository.close?.();
  }
});

test('the scan asks sources for Polish books only while the switch is on', async () => {
  const languages = [];
  const scanner = async (task) => (languages.push(task.language), { offers: [], pagination: { state: 'end' } });
  await searchOffers({ queries: ['Fourth Wing'], sources: ['Empik'] }, { scanner });
  await searchOffers({ queries: ['Fourth Wing'], sources: ['Empik'], polishOnly: false }, { scanner });
  assert.deepEqual(languages, ['pl', null]);
});
