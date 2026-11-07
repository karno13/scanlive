// Shape of a real BN record, trimmed to the MARC fields BookFlip reads.
const f = (tag, subfields, ind1 = ' ', ind2 = ' ') => ({ [tag]: { ind1, ind2, subfields } });

export const KINSLAYER = {
  id: 1000005998182,
  isbnIssn: '9788382320084',
  title: 'Zabójca krasnoludów / Kinslayer, Warhammer Przygody Gotreka i Felixa',
  author: 'Guymer, David Czuba, Jacek Copernicus Corporation',
  publisher: 'Copernicus Corporation Copernicus Corporation,',
  publicationYear: '2021',
  language: 'polski',
  languageOfOriginal: 'angielski',
  kind: 'książka',
  marc: {
    fields: [
      { '001': 'b1000005998182' },
      f('020', [{ a: '9788382320084' }, { q: '(oprawa miękka)' }]),
      f('100', [{ a: 'Guymer, David' }, { e: 'Autor' }], '1'),
      f('245', [{ a: 'Zabójca krasnoludów /' }, { c: 'David Guymer ; [tłumaczenie: Jacek Czuba].' }], '1', '0'),
      f('246', [{ i: 'Tytuł oryginału:' }, { a: 'Kinslayer,' }, { f: '2014' }], '1'),
      f('260', [{ a: 'Warszawa :' }, { b: 'Copernicus Corporation,' }, { c: '2021.' }]),
      f('300', [{ a: '399, [1] stron :' }, { b: 'ilustracja ;' }, { c: '20 cm.' }]),
      f('490', [{ a: 'Gotrek i Felix' }], '1'),
      f('490', [{ a: 'Fantasy (Copernicus Corporation)' }], '1'),
      f('655', [{ a: 'Fantasy' }, { 2: 'DBN' }], ' ', '7'),
      f('700', [{ a: 'Czuba, Jacek' }, { e: 'Tłumaczenie' }], '1'),
      f('710', [{ a: 'Copernicus Corporation' }, { e: 'Wydawca' }], '2'),
      f('830', [{ a: 'Przygody Gotreka i Felixa' }, { v: 't. 13' }], ' ', '0'),
      f('830', [{ a: 'Warhammer 40.000.' }, { p: 'Herezja Horusa' }, { v: '30' }], ' ', '0'),
    ],
  },
};

export { f as marcField };
