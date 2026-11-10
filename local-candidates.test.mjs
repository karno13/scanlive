import test from 'node:test';
import assert from 'node:assert/strict';
import { localEditionCandidates } from './catalog-api.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

test('offers without ISBN get catalogue editions of the same work; universe names alone do not match', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const illidan = repository.createWork({
      title: 'World of Warcraft: Illidan',
      authors: ['William King'],
    });
    repository.createEdition({
      workId: illidan.id,
      title: 'World of Warcraft: Illidan',
      publisher: 'Insignis',
      publicationYear: 2016,
    });
    const chronicle = repository.createWork({
      title: 'World of Warcraft : kronika. T. 1',
      authors: ['Chris Metzen'],
    });
    repository.createEdition({ workId: chronicle.id, title: 'Kronika', publicationYear: 2019 });
    const found = localEditionCandidates(repository, 'WORLD OF WARCRAFT ILLIDAN WILLIAM KING PL');
    assert.equal(found.length, 1);
    assert.equal(found[0].workId, illidan.id);
    assert.equal(found[0].publicationYear, 2016);
    assert.ok(found[0].score >= 0.85);
    assert.deepEqual(localEditionCandidates(repository, 'World of Warcraft: Sylvanas'), []);
  } finally {
    repository.close?.();
  }
});

test('a listing naming another catalogue author does not get a one-word title by someone else', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const smoki = repository.createWork({ title: 'Smoki', authors: ['Douglas Niles'] });
    repository.createEdition({ workId: smoki.id, title: 'Smoki', publicationYear: 2006 });
    const legendy = repository.createWork({
      title: 'Czas bliźniaków',
      authors: ['Margaret Weis', 'Tracy Hickman'],
    });
    repository.createEdition({
      workId: legendy.id,
      title: 'Czas bliźniaków',
      publicationYear: 2001,
    });
    const zabojca = repository.createWork({ title: 'Zabójca', authors: ['David Guymer'] });
    repository.createEdition({ workId: zabojca.id, title: 'Zabójca', publicationYear: 2019 });
    const kingWork = repository.createWork({ title: 'Trollslayer', authors: ['William King'] });
    repository.createEdition({ workId: kingWork.id, title: 'Trollslayer', publicationYear: 2000 });
    assert.deepEqual(
      localEditionCandidates(
        repository,
        'Książka „Smoki jesiennego zmierzchu” M. Weis, T. Hickman | Dragonlance Kroniki Tom 1',
      ),
      [],
    );
    assert.deepEqual(localEditionCandidates(repository, 'William King - Zabójca ludzi'), []);
    // A one-word title inside a long listing is not proposed without its author…
    assert.deepEqual(
      localEditionCandidates(repository, 'Zabójca Pentaków seria Warhammer Fantasy twarda oprawa'),
      [],
    );
    // …but the author confirms it, and a short listing is still enough.
    assert.equal(
      localEditionCandidates(repository, 'Zabójca David Guymer Warhammer Age of Sigmar')[0]?.workId,
      zabojca.id,
    );
    assert.equal(localEditionCandidates(repository, 'Smoki Douglas Niles')[0]?.workId, smoki.id);
  } finally {
    repository.close?.();
  }
});
