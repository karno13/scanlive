import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublisher, normalizeStoredPublishers } from './publisher-names.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

test('one spelling per publisher: quotes, "Wydaw", legal forms and known variants', () => {
  const cases = {
    '"ISA"': 'ISA', Isa: 'ISA', '"IAS"': 'ISA',
    'Dom Wydawniczy "Rebis"': 'Dom Wydawniczy Rebis', REBIS: 'Dom Wydawniczy Rebis',
    'Zysk i S-ka. Wydaw': 'Zysk i S-ka', 'Zysk i S-ka Wydawnictwo': 'Zysk i S-ka',
    'Wydawnictwo MAG': 'Mag', '"Mag"': 'Mag',
    'Proszynski Media': 'Prószyński Media', 'Prószyński i s-ka': 'Prószyński i S-ka',
    'Grupa Wydawnicza Filia sp. z o.o.': 'Filia', 'Wydawnictwo Egmont Polska Sp. z o.o.': 'Egmont Polska',
    'Fabryka Słów Wydawnictwo': 'Fabryka Słów', 'Insignis Media': 'Insignis',
    'Little, Brown Book Group Limited': 'Little, Brown Book Group Limited',
    'Społeczny Instytut Wydawniczy Znak': 'Społeczny Instytut Wydawniczy Znak',
    'n/a': null, '': null,
  };
  for (const [raw, expected] of Object.entries(cases)) assert.equal(normalizePublisher(raw), expected, raw);
  assert.equal(normalizePublisher(null), null);
});

test('stored publishers are re-spelled, except on editions the operator edited', () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const work = repository.createWork({ title: 'Kryształowy relikt', authors: ['R. A. Salvatore'] });
    const db = repository.database;
    const a = repository.createEdition({ workId: work.id, title: 'Kryształowy relikt', publisher: '"ISA"' });
    assert.equal(db.prepare('SELECT publisher FROM editions WHERE id=?').get(a.id).publisher, 'ISA');
    const b = repository.createEdition({ workId: work.id, title: 'Kryształowy relikt (2)' });
    const c = repository.createEdition({ workId: work.id, title: 'Kryształowy relikt (3)' });
    db.prepare('UPDATE editions SET publisher=? WHERE id=?').run('Zysk i S-ka. Wydaw', b.id);
    db.prepare("UPDATE editions SET publisher=?, verification_status='manual' WHERE id=?").run('"Mój wydawca"', c.id);
    assert.deepEqual(normalizeStoredPublishers(repository), { changed: 1 });
    assert.equal(db.prepare('SELECT publisher FROM editions WHERE id=?').get(b.id).publisher, 'Zysk i S-ka');
    assert.equal(db.prepare('SELECT publisher FROM editions WHERE id=?').get(c.id).publisher, '"Mój wydawca"');
  } finally {
    repository.close?.();
  }
});
