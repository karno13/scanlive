import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { assignEmpikReferences, EMPIK_AUTO_AUTHOR } from '../empik-references.mjs';
import { reopenReviewDecision } from '../api-routes.mjs';

test('Empik automation assigns unknown edition and undo prevents another automatic decision', () => {
  const r = new SqliteCatalogRepository(':memory:');
  try {
    r.createWork({ id: 'w', title: 'Illidan', authors: ['William King'] });
    r.createEdition({ id: 'e', workId: 'w', title: 'Illidan' });
    r.upsertOffer({
      id: 'o',
      source: 'Empik',
      normalizedUrl: 'https://www.empik.com/test',
      originalTitle: 'Illidan',
    });
    r.putIdentificationJob({ id: 'j', offerId: 'o', status: 'review_required' });
    assert.equal(assignEmpikReferences(r).assigned, 1);
    const d = r.database.prepare('SELECT * FROM review_decisions').get();
    assert.equal(d.created_by, EMPIK_AUTO_AUTHOR);
    assert.equal(
      r.database.prepare('SELECT is_unknown FROM editions WHERE id=?').get(d.edition_id).is_unknown,
      1,
    );
    assert.equal(assignEmpikReferences(r).assigned, 0);
    reopenReviewDecision(r, d.id);
    assert.equal(assignEmpikReferences(r).assigned, 0);
    assert.equal(
      r.database.prepare("SELECT count(*) n FROM offer_matches WHERE status='active'").get().n,
      0,
    );
  } finally {
    r.close();
  }
});
