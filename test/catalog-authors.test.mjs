import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { createLocalAppServer } from '../local-app.mjs';
import { authorName, catalogAuthors } from '../catalog-authors.mjs';
import { listCatalogWorks } from '../catalog-api.mjs';

function catalogue() {
  const repository = new SqliteCatalogRepository(':memory:');
  repository.createWork({
    id: 'hp1',
    title: 'Harry Potter i Kamień Filozoficzny',
    authors: ['Rowling, J. K.'],
  });
  repository.createWork({
    id: 'hp2',
    title: 'Harry Potter i Komnata Tajemnic',
    authors: ['J. K. Rowling'],
  });
  repository.createWork({
    id: 'hp3',
    title: 'Harry Potter i więzień Azkabanu',
    authors: ['Rowling, J.K'],
  });
  repository.createWork({ id: 'mort', title: 'Mort', authors: ['Pratchett, Terry (1948-2015)'] });
  repository.createWork({ id: 'none', title: 'Antologia', authors: [] });
  return repository;
}

test('an author name is one person whatever the spelling', () => {
  assert.equal(authorName('Pratchett, Terry (1948-2015)'), 'Terry Pratchett');
  assert.equal(authorName('Rowling, J.K'), 'J.K Rowling');
  assert.equal(authorName('Andrzej Sapkowski'), 'Andrzej Sapkowski');
});

test('authors are listed once with their number of works, most works first', () => {
  const repository = catalogue();
  try {
    const { items } = catalogAuthors(repository);
    assert.equal(items.length, 2);
    assert.equal(items[0].works, 3);
    assert.match(items[0].name, /Rowling$/);
    assert.deepEqual(items[1], { name: 'Terry Pratchett', works: 1 });
  } finally {
    repository.close();
  }
});

test('the works list filters by author in any spelling; an unknown author finds nothing', () => {
  const repository = catalogue();
  try {
    const ids = (author) =>
      listCatalogWorks(repository, { author })
        .items.map((work) => work.id)
        .sort();
    assert.deepEqual(ids('J. K. Rowling'), ['hp1', 'hp2', 'hp3']);
    assert.deepEqual(ids('rowling, j.k.'), ['hp1', 'hp2', 'hp3']);
    assert.deepEqual(ids('Terry Pratchett'), ['mort']);
    assert.deepEqual(ids('Brandon Sanderson'), []);
    assert.equal(listCatalogWorks(repository, { author: '' }).items.length, 5);
  } finally {
    repository.close();
  }
});

test('GET /api/catalog/authors and /api/catalog/works?author=', async () => {
  const repository = catalogue();
  const server = createLocalAppServer({ catalogProvider: () => ({ repository }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(null)));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const authors = await (await fetch(`${base}/api/catalog/authors`)).json();
    assert.equal(authors.items.length, 2);
    const works = await (
      await fetch(`${base}/api/catalog/works?author=${encodeURIComponent('Pratchett, Terry')}`)
    ).json();
    assert.deepEqual(
      works.items.map((work) => work.id),
      ['mort'],
    );
  } finally {
    await new Promise((resolve) => server.close(() => resolve(null)));
    repository.close();
  }
});
