// Cycle and volume for works no bibliographic record describes (edition-series.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { seriesFromListing, seriesFromListings, inferListingSeries, storeSeriesStatements } from './edition-series.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { catalogSeries } from './catalog-series.mjs';
import { parseOnixProduct } from './metadata-sources/e-isbn.mjs';

test('listing titles give the cycle and its volume, without the book title, authors or universe names', () => {
  const read = (listing, context) => seriesFromListing(listing, context);
  assert.deepEqual(read('Duchy Gaunta. Tom 2. Komisarz Gaunt', { titles: ['Komisarz Gaunt'] }), { cycle: 'Duchy Gaunta', volume: 2 });
  assert.deepEqual(read('Stacja Ocalenie - Dan Abnett Warhammer 40k Duchy Gaunta tom 13', { titles: ['Stacja Ocalenie'], authors: ['Abnett, Dan'] }), { cycle: 'Duchy Gaunta', volume: 13 });
  assert.deepEqual(read('Zahartowana we Krwi Warhammer Wampirzyca Ulrika Tom II Nathan Long', { titles: ['Zahartowana we krwi'], authors: ['Nathan Long'] }), { cycle: 'Wampirzyca Ulrika', volume: 2 });
  assert.deepEqual(read('Prospero w płomieniach – Dan Abnett | Herezja Horusa tom 15 | Warhammer'), { cycle: 'Herezja Horusa', volume: 15 });
  assert.deepEqual(read('Kolor magii. Świat Dysku. Tom 1'), { universe: 'Świat Dysku', volume: 1 });
  assert.deepEqual(read('Piekło Pocztowe Część 2 Tom 35 Świat Dysku', { titles: ['Piekło pocztowe'] }), { universe: 'Świat Dysku', volume: 35 });
  assert.equal(read('Trylogia Sigmara TOM 1-3'), null, 'a bundle range is no volume');
  assert.equal(read('Fourth Wing. Empireum. Tom 1,5'), null);
  assert.equal(read('Kolekcja świat dysku Tom I Straż Straż'), null, 'a newspaper collection is no cycle');
});

test('the cycle and number most listings agree on win; a tie on the number leaves it empty', () => {
  const disc = ['Blask fantastyczny. Świat Dysku. Tom 2', 'Blask fantastyczny Świat Dysku Tom 2', 'Blask fantastyczny Świat Dysku Tom 11'];
  assert.deepEqual(seriesFromListings(disc, { titles: ['Blask fantastyczny'] }), { kind: 'universe', name: 'Świat Dysku', volume: 2, votes: 3 });
  const tie = ['Duchy Gaunta tom 3 Nekropolia', 'Duchy Gaunta tom 4 Nekropolia'];
  assert.deepEqual(seriesFromListings(tie, { titles: ['Nekropolia'] }), { kind: 'cycle', name: 'Duchy Gaunta', volume: null, votes: 2 });
});

test('listing series are stored for undescribed works only and appear in the series view, marked as read from listings', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  const work = repo.createWork({ id: 'w1', title: 'Komisarz Gaunt', authors: ['Abnett, Dan'] });
  const edition = repo.createEdition({ id: 'e1', workId: work.id, title: 'Komisarz Gaunt' });
  const described = repo.createWork({ id: 'w2', title: 'Pierwszy i jedyny', authors: ['Abnett, Dan'] });
  const describedEdition = repo.createEdition({ id: 'e2', workId: described.id, title: 'Pierwszy i jedyny' });
  storeSeriesStatements(repo, describedEdition.id, [{ name: 'Duchy Gaunta', kind: 'cycle', volume: 1 }], 'bn');
  for (const [n, editionId, title] of [[1, 'e1', 'Duchy Gaunta. Tom 2. Komisarz Gaunt'], [2, 'e1', 'Komisarz Gaunt Duchy Gaunta tom 2'], [3, 'e2', 'Pierwszy i jedyny Duchy Gaunta tom 7']]) {
    const offer = repo.upsertOffer({ source: 'Vinted', normalizedUrl: 'https://www.vinted.pl/items/' + n, originalTitle: title, currentPrice: 1000 });
    repo.assignOfferToEdition(offer.id, editionId, { method: 'structured_isbn', status: 'active', createdBy: 'test' });
  }
  assert.deepEqual(inferListingSeries(repo), { works: 1, stored: 1 });
  const rows = repo.database.prepare('SELECT edition_id, name, volume, source FROM edition_series ORDER BY edition_id').all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { edition_id: 'e1', name: 'Duchy Gaunta', volume: 2, source: 'listing' },
    { edition_id: 'e2', name: 'Duchy Gaunta', volume: 1, source: 'bn' },
  ]);
  const works = catalogSeries(repo).flatMap((universe) => universe.cycles.flatMap((cycle) => cycle.works));
  assert.deepEqual(works.map((item) => [item.id, item.volume, item.guessed]).sort(), [['w1', 2, true], ['w2', 1, false]]);
  assert.deepEqual(inferListingSeries(repo), { works: 1, stored: 1 }, 'recomputing does not duplicate');
  repo.close();
});

test('the e-ISBN record carries the publisher series statement', () => {
  const product = '<Product><RecordReference>r1</RecordReference><ProductIdentifier><ProductIDType>15</ProductIDType><IDValue>9788382320459</IDValue></ProductIdentifier>' +
    '<DescriptiveDetail><Collection><CollectionType>10</CollectionType><TitleDetail><TitleType>01</TitleType><TitleElement><TitleElementLevel>02</TitleElementLevel><PartNumber>13</PartNumber><TitleText>Duchy Gaunta</TitleText></TitleElement></TitleDetail></Collection>' +
    '<TitleDetail><TitleType>01</TitleType><TitleElement><TitleElementLevel>01</TitleElementLevel><TitleText>Stacja Ocalenie</TitleText></TitleElement></TitleDetail></DescriptiveDetail></Product>';
  const parsed = parseOnixProduct(product);
  assert.equal(parsed.title, 'Stacja Ocalenie');
  assert.deepEqual(parsed.series, [{ name: 'Duchy Gaunta', part: '13' }]);
  const repo = new SqliteCatalogRepository(':memory:');
  repo.createWork({ id: 'w', title: 'Stacja Ocalenie' });
  repo.createEdition({ id: 'e', workId: 'w', title: 'Stacja Ocalenie' });
  storeSeriesStatements(repo, 'e', parsed.series, 'e_isbn');
  assert.deepEqual({ ...repo.database.prepare('SELECT name, kind, volume FROM edition_series').get() }, { name: 'Duchy Gaunta', kind: 'cycle', volume: 13 });
  repo.close();
});
