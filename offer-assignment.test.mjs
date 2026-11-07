import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogResolver } from './catalog-resolver.mjs';
import { reassignOffer, unassignOffer } from './offer-assignment.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

const ISBN = '9780306406157';

function setup() {
  const repository = new SqliteCatalogRepository(':memory:');
  for (const [work, edition, title] of [['w1', 'e1', 'Theoretical Physics'], ['w2', 'e2', 'Other Book']]) {
    repository.createWork({ id: work, title, authors: ['Georg Joos'], verificationStatus: 'verified' });
    repository.createEdition({ id: edition, workId: work, title, verificationStatus: 'verified' });
  }
  repository.attachIdentifier('e1', 'isbn13', ISBN, { verificationStatus: 'verified' });
  repository.upsertOffer({ id: 'o1', source: 'fixture', normalizedUrl: 'https://example.test/o1', originalTitle: 'Theoretical Physics', observedIsbn: ISBN });
  repository.assignOfferToEdition('o1', 'e1', { id: 'auto', method: 'structured_isbn', status: 'active' });
  return repository;
}

const active = (repository) => repository.database.prepare("SELECT edition_id, method FROM offer_matches WHERE offer_id='o1' AND status='active'").get();

test('an offer can be moved to another edition as a manual decision', () => {
  const repository = setup();
  try {
    const result = reassignOffer(repository, 'o1', 'e2');
    assert.deepEqual(result, { offerId: 'o1', editionId: 'e2', previousEditionId: 'e1', changed: true });
    assert.deepEqual({ ...active(repository) }, { edition_id: 'e2', method: 'manual' });
    const job = repository.database.prepare("SELECT status FROM identification_jobs WHERE offer_id='o1'").get();
    assert.equal(job.status, 'completed');
    assert.equal(repository.database.prepare("SELECT action FROM review_decisions WHERE offer_id='o1'").get().action, 'approved');
    assert.equal(reassignOffer(repository, 'o1', 'e2').changed, false);
    assert.throws(() => reassignOffer(repository, 'o1', 'missing'), /EDITION_NOT_FOUND/);
  } finally {
    repository.close();
  }
});

test('removing an assignment sends the offer to review and the resolver does not put it back', async () => {
  const repository = setup();
  try {
    assert.deepEqual(unassignOffer(repository, 'o1'), { offerId: 'o1', removedEditionId: 'e1' });
    assert.equal(active(repository), undefined);
    assert.equal(repository.database.prepare("SELECT status FROM identification_jobs WHERE offer_id='o1'").get().status, 'review_required');
    const resolver = new CatalogResolver({ repository, lookupMetadata: async () => assert.fail('no lookup needed') });
    const result = await resolver.resolve({ offerId: 'o1' });
    assert.equal(result.decision, 'review_required');
    assert.deepEqual(result.reason, ['operator_rejected_edition']);
    assert.equal(active(repository), undefined);
    assert.throws(() => unassignOffer(repository, 'o1'), /MATCH_NOT_FOUND/);
    // The operator can still assign it back by hand.
    assert.equal(reassignOffer(repository, 'o1', 'e1').changed, true);
  } finally {
    repository.close();
  }
});

test('offers marked as sets are edited in the sets view, not here', () => {
  const repository = setup();
  try {
    repository.database.prepare("INSERT INTO offer_sets(offer_id, created_at, updated_at) VALUES('o1', '2026-01-01', '2026-01-01')").run();
    assert.throws(() => unassignOffer(repository, 'o1'), /OFFER_IS_SET/);
  } finally {
    repository.close();
  }
});
