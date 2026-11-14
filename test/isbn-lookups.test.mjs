import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { findLcRecord, parseLcBook } from '../metadata-sources/lubimyczytac.mjs';
import { lookupUnknownIsbns } from '../isbn-lookups.mjs';
import { offerEditionDraft, createEditionFromOffer } from '../offer-editions.mjs';

const book = (id, name, isbn, extra = '') =>
  `<html><script type="application/ld+json">{"@context":"http://schema.org","@type":"Book","name":"${name}","isbn":"${isbn}","datePublished":"2009-01-01","url":"https://lubimyczytac.pl/ksiazka/${id}/x","numberOfPages":"384","isPartOfSeries":{"@type":"BookSeries","name":"Eisenhorn","position":"3"},"author":{"@type":"Person","name":"Dan Abnett"}}</script>
   <span>Wydawnictwo: <a href="https://lubimyczytac.pl/wydawnictwo/1910/copernicus-corporation">Copernicus Corporation</a></span>${extra}</html>`;
const pages = {
  'https://lubimyczytac.pl/szukaj/ksiazki?phrase=Hereticus%20Abnett':
    '<a href="/ksiazka/1/hereticus-inny">x</a><a href="/ksiazka/60887/hereticus">y</a>',
  'https://lubimyczytac.pl/ksiazka/1/hereticus-inny': book(1, 'Hereticus', '9780000000002'),
  'https://lubimyczytac.pl/ksiazka/60887/hereticus': book(60887, 'Hereticus', '9788361656043'),
};
const read = async (url) => {
  if (!(url in pages)) throw Error('UNEXPECTED ' + url);
  return pages[url];
};

test('a lubimyczytac.pl page counts only with the same ISBN', async () => {
  const record = await findLcRecord(
    { isbn: '978-83-61656-04-3', title: 'Hereticus', authors: ['Dan Abnett'] },
    { read },
  );
  assert.deepEqual(
    {
      title: record.title,
      isbn: record.isbn,
      publisher: record.publisher,
      year: record.publicationYear,
      cycle: record.cycle,
      url: record.url,
    },
    {
      title: 'Hereticus',
      isbn: '9788361656043',
      publisher: 'Copernicus Corporation',
      year: 2009,
      cycle: { name: 'Eisenhorn', volume: 3 },
      url: 'https://lubimyczytac.pl/ksiazka/60887/x',
    },
  );
  assert.equal(parseLcBook('<html>no data</html>'), null);
});

test('an ISBN unknown to every source gets the record in the draft; the edition takes publisher, year and cycle', async () => {
  const repository = new SqliteCatalogRepository(':memory:');
  try {
    const db = repository.database;
    const offer = repository.upsertOffer({
      source: 'Vinted',
      normalizedUrl: 'https://www.vinted.pl/items/7-hereticus',
      originalTitle: 'Hereticus - Dan Abnett',
      currentPrice: 7000,
      observedIsbn: '9788361656043',
      at: '2026-11-08T10:00:00Z',
    });
    const job = repository.putIdentificationJob({
      offerId: offer.id,
      status: 'review_required',
      at: '2026-11-08T10:00:00Z',
    });
    db.prepare('UPDATE identification_jobs SET result_json=? WHERE id=?').run(
      JSON.stringify({
        decision: 'review_required',
        reason: ['isbn_not_found_in_metadata_sources'],
      }),
      job.id,
    );
    const report = await lookupUnknownIsbns(repository, {
      draftOf: (id) => offerEditionDraft(repository, id),
      find: (query) => findLcRecord(query, { read }),
    });
    assert.deepEqual(report, { checked: 1, found: 1, errors: 0, paused: false });
    // Asked once: the next pass has nothing to do.
    assert.equal(
      (
        await lookupUnknownIsbns(repository, {
          draftOf: () => assert.fail(),
          find: () => assert.fail(),
        })
      ).checked,
      0,
    );
    const draft = offerEditionDraft(repository, job.id);
    assert.equal(draft.title, 'Hereticus');
    assert.deepEqual(draft.authors, ['Dan Abnett']);
    assert.equal(draft.record.publisher, 'Copernicus Corporation');
    const created = createEditionFromOffer(repository, job.id, {
      title: draft.title,
      authors: draft.authors,
      isbn: draft.isbn,
    });
    const edition = db
      .prepare('SELECT publisher, publication_year FROM editions WHERE id=?')
      .get(created.editionId);
    assert.deepEqual(
      { ...edition },
      { publisher: 'Copernicus Corporation', publication_year: 2009 },
    );
    const cycle = db
      .prepare('SELECT name, volume, kind, source FROM edition_series WHERE edition_id=?')
      .get(created.editionId);
    assert.deepEqual(
      { ...cycle },
      { name: 'Eisenhorn', volume: 3, kind: 'cycle', source: 'lubimyczytac' },
    );
  } finally {
    repository.close?.();
  }
});
