import assert from 'node:assert/strict';
import test from 'node:test';

import {
  catalogTitle,
  displayName,
  parseBnMarc,
  seriesKind,
  seriesName,
  trimPunctuation,
} from '../bn-marc.mjs';
import { looksLikeBundle } from '../bundle-detection.mjs';
import { createBnAdapter } from '../metadata-sources/bn.mjs';
import { KINSLAYER } from '../fixtures/metadata/bn-kinslayer.mjs';

const f = (tag, subfields, ind1 = ' ', ind2 = ' ') => ({ [tag]: { ind1, ind2, subfields } });

test('MARC separates title, people with roles, publisher and physical details', () => {
  const details = parseBnMarc(KINSLAYER);
  assert.equal(details.title, 'Zabójca krasnoludów');
  assert.equal(details.originalTitle, 'Kinslayer');
  assert.deepEqual(details.authors, ['David Guymer']);
  assert.deepEqual(
    details.contributors.map((person) => [person.name, person.role]),
    [
      ['David Guymer', 'author'],
      ['Jacek Czuba', 'translator'],
    ],
    'the publisher (710) is not a person',
  );
  assert.equal(details.publisher, 'Copernicus Corporation');
  assert.equal(details.placeOfPublication, 'Warszawa');
  assert.equal(details.publicationYear, 2021);
  assert.equal(details.binding, 'oprawa miękka');
  assert.equal(details.pageCount, 399);
  assert.equal(details.heightCm, 20);
  assert.equal(details.originalLanguage, 'angielski');
  assert.deepEqual(details.genres, ['Fantasy']);
});

test('series statements are classified and keep their volume numbers', () => {
  const series = parseBnMarc(KINSLAYER).series.map((entry) => [
    entry.name,
    entry.kind,
    entry.volume,
  ]);
  assert.deepEqual(series, [
    ['Gotrek i Felix', 'cycle', null],
    ['Fantasy', 'publisher_line', null],
    ['Przygody Gotreka i Felixa', 'cycle', 13],
    ['Warhammer 40.000', 'universe', null],
    ['Herezja Horusa', 'cycle', 30],
  ]);
  assert.equal(seriesName('Świat Dysku / Terry Pratchett ;'), 'Świat Dysku');
  assert.equal(seriesName('Warhammer 40.000 - Copernicus Corporation'), 'Warhammer 40.000');
  assert.equal(seriesName('Black Library = Czarna Biblioteka'), 'Czarna Biblioteka');
  assert.equal(seriesKind('Czarna Biblioteka'), 'publisher_line');
  assert.equal(seriesKind('Wielka kolekcja'), 'publisher_line');
  assert.equal(seriesKind('Discworld series'), 'universe');
  assert.equal(seriesKind('Trylogia klingi i łowcy'), 'cycle');
});

test('title keeps subtitle and part number in record order', () => {
  const record = {
    marc: {
      fields: [
        f(
          '245',
          [{ a: 'World of Warcraft :' }, { b: 'kronika.' }, { n: 'T. 1 /' }, { c: 'Chris Metzen' }],
          '1',
          '0',
        ),
      ],
    },
  };
  assert.equal(catalogTitle(parseBnMarc(record)), 'World of Warcraft : kronika. T. 1');
  const parallel = { marc: { fields: [f('245', [{ a: 'Mort =' }, { b: 'Mort /' }])] } };
  assert.equal(catalogTitle(parseBnMarc(parallel)), 'Mort', 'a parallel title is not a subtitle');
});

test('"Tekst" and "Scenariusz" mark the author of a comic, so the work gets an author', () => {
  const comic = (role) => ({
    marc: {
      fields: [
        f('100', [{ a: 'Abnett, Dan' }, { e: role }]),
        f('245', [{ a: 'Witamy w Badrock /' }]),
        f('700', [{ a: 'Więckowski, Jacek' }, { e: 'Tłumaczenie' }]),
      ],
    },
  });
  for (const role of ['Tekst', 'Scenariusz', 'Autor'])
    assert.deepEqual(parseBnMarc(comic(role)).authors, ['Dan Abnett'], role);
  assert.deepEqual(parseBnMarc(comic('Redakcja')).authors, [], 'an editor is not an author');
});

test('names are shown given name first and keep initials', () => {
  assert.equal(displayName('Werner, C. L.'), 'C. L. Werner');
  assert.equal(displayName('Sanders, Rob.'), 'Rob Sanders');
  assert.equal(displayName('Pratchett, Terry'), 'Terry Pratchett');
  assert.equal(trimPunctuation('Copernicus Corporation,'), 'Copernicus Corporation');
  assert.equal(parseBnMarc({ title: 'no marc' }), null);
});

test('BN adapter takes title, authors, publisher and binding from MARC', async () => {
  const adapter = createBnAdapter({
    requester: async () => ({
      status: 'found',
      payload: { bibs: [KINSLAYER] },
      url: 'https://bn.test',
    }),
  });
  const result = await adapter.lookup('9788382320084');
  assert.equal(result.status, 'found');
  const [record] = result.records;
  assert.equal(record.title, 'Zabójca krasnoludów');
  assert.deepEqual(record.authors, ['David Guymer']);
  assert.equal(record.publisher, 'Copernicus Corporation');
  assert.equal(record.binding, 'oprawa miękka');
  assert.equal(record.originalTitle, 'Kinslayer');
});

test('listings of several books are recognised, single volumes are not', () => {
  for (const title of [
    'Terry Pratchett - Świat dysku 6 tomów',
    'Terry Pratchett – Wielka Kolekcja Świat Dysku (tomy 1–4)',
    'World of Warcraft Kroniki TOM 1-3',
    'Czarodzicielstwo + Kosiarz',
    'Trylogia Sigmara 3 x Warhammer',
    'Dragonlance mroczny uczeń 1 i 2 tom',
    'Zestaw Książek z Uniwersum Forgotten Realms',
  ])
    assert.equal(looksLikeBundle(title), true, title);
  for (const title of [
    'Forgotten Realms - Trylogia Klingi Łowcy',
    'Wielka Kolekcja Świat Dysku tom 12',
    'Zabójca krasnoludów t. 1',
    'Warhammer 40000 Herezja Horusa Wojna bez końca',
  ])
    assert.equal(looksLikeBundle(title), false, title);
});
