import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { findDuplicateWorkGroups } from '../work-grouping.mjs';
import { listDistinctDecisions, markDistinct, undoDistinct } from '../distinct-works.mjs';
import { mergeWorkGroup, recentReviewDecisions, apiRoute } from '../api-routes.mjs';

function twoWorks(repository) {
  for (const id of ['w1', 'w2']) {
    repository.createWork({
      id,
      title: 'Nemezis',
      authors: ['James Swallow'],
      verificationStatus: 'verified',
    });
    repository.createEdition({
      id: 'e' + id,
      workId: id,
      title: 'Nemezis',
      verificationStatus: 'verified',
    });
  }
}

test('"To różne książki" hides the group, is listed, can be undone and blocks merging', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    twoWorks(repository);
    assert.equal(findDuplicateWorkGroups(repository).length, 1);
    const { decisionId } = markDistinct(repository, ['w2', 'w1']);
    assert.equal(findDuplicateWorkGroups(repository).length, 0);
    assert.throws(() => mergeWorkGroup(repository, 'w1', ['w2']), /NOT_A_DUPLICATE_GROUP/);
    const [listed] = listDistinctDecisions(repository);
    assert.equal(listed.id, decisionId);
    assert.deepEqual(listed.works.map((work) => work.id).sort(), ['w1', 'w2']);
    assert.equal(listed.undone, false);
    // The route lists it for "Ostatnie decyzje".
    const routed = await apiRoute({
      repo: repository,
      method: 'GET',
      path: '/api/catalog/work-duplicates/distinct',
    });
    assert.equal(routed.items.length, 1);
    undoDistinct(repository, decisionId);
    assert.equal(findDuplicateWorkGroups(repository).length, 1);
    assert.equal(listDistinctDecisions(repository)[0].undone, true);
    assert.throws(() => undoDistinct(repository, decisionId), /DECISION_NOT_FOUND/);
    assert.ok(Array.isArray(recentReviewDecisions(repository)));
  } finally {
    repository.close();
  }
});

test('a third work with the same key brings the group back (not every pair is distinct)', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    twoWorks(repository);
    markDistinct(repository, ['w1', 'w2']);
    repository.createWork({
      id: 'w3',
      title: 'Nemezis',
      authors: ['James Swallow'],
      verificationStatus: 'verified',
    });
    repository.createEdition({
      id: 'ew3',
      workId: 'w3',
      title: 'Nemezis',
      verificationStatus: 'verified',
    });
    assert.equal(findDuplicateWorkGroups(repository).length, 1);
    assert.throws(() => markDistinct(repository, ['w1']), /INVALID_CATALOG_FIELDS/);
    assert.throws(() => markDistinct(repository, ['w1', 'nope']), /WORK_NOT_FOUND/);
  } finally {
    repository.close();
  }
});
