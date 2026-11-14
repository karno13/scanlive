import assert from 'node:assert/strict';
import test from 'node:test';

import { createProductionCatalog } from '../catalog-production.mjs';
import { universeOf } from '../catalog-series.mjs';
import { seriesKind } from '../bn-marc.mjs';
import { matchesTopic } from '../search-policy.mjs';
import {
  DEFAULT_UNIVERSES,
  currentUniverses,
  deleteUniverse,
  listUniverses,
  saveUniverse,
  setUniverses,
} from '../universes.mjs';
import { mainTitle } from '../work-grouping.mjs';

function catalog() {
  return createProductionCatalog({
    databasePath: ':memory:',
    fetcher: async () => assert.fail('no network'),
  });
}

test('the table starts with the universes the code used until now', () => {
  const store = catalog();
  try {
    const stored = listUniverses(store.repository).items;
    assert.deepEqual(
      stored,
      DEFAULT_UNIVERSES.map((u) => ({ ...u, names: u.names.filter((name) => name !== u.name) })),
    );
  } finally {
    store.close();
    setUniverses(DEFAULT_UNIVERSES);
  }
});

test('a universe added in the catalogue strips branding, files the series view and widens topics', () => {
  const store = catalog();
  try {
    assert.equal(mainTitle('Wiedźmin: Ostatnie życzenie'), 'Wiedźmin: Ostatnie życzenie');
    saveUniverse(store.repository, {
      name: 'Wiedźmin',
      names: ['The Witcher'],
      lines: [],
      markers: ['Geralt'],
    });
    assert.equal(mainTitle('Wiedźmin: Ostatnie życzenie'), 'Ostatnie życzenie');
    assert.equal(mainTitle('Krew elfów (THE WITCHER)'), 'Krew elfów');
    assert.equal(universeOf('Geralt z Rivii — opowiadania'), 'Wiedźmin');
    assert.equal(seriesKind('The Witcher'), 'universe');
    assert.equal(
      matchesTopic(
        { mode: 'discovery', category: 'Wiedźmin', searchQuery: 'Wiedźmin' },
        'The Witcher Sword of destiny',
      ),
      true,
    );

    // One spelling belongs to one universe.
    assert.throws(
      () => saveUniverse(store.repository, { name: 'Wiedźmin', names: ['Discworld'] }),
      /UNIVERSE_NAME_TAKEN/,
    );
    // Renamed in place; removed again.
    saveUniverse(store.repository, {
      previousName: 'Wiedźmin',
      name: 'Saga o wiedźminie',
      names: ['Wiedźmin', 'The Witcher'],
    });
    assert.ok(currentUniverses().some((u) => u.name === 'Saga o wiedźminie'));
    assert.ok(!currentUniverses().some((u) => u.name === 'Wiedźmin'));
    deleteUniverse(store.repository, 'Saga o wiedźminie');
    assert.equal(mainTitle('Wiedźmin: Ostatnie życzenie'), 'Wiedźmin: Ostatnie życzenie');
    assert.throws(
      () => deleteUniverse(store.repository, 'Saga o wiedźminie'),
      /UNIVERSE_NOT_FOUND/,
    );
  } finally {
    store.close();
    setUniverses(DEFAULT_UNIVERSES);
  }
});

test('built-in spellings keep working: "40.000", brackets, lines after the universe', () => {
  assert.equal(mainTitle('Warhammer 40.000: Duchy Gaunta'), 'Duchy Gaunta');
  assert.equal(mainTitle('Blask fantastyczny (ŚWIAT DYSKU)'), 'Blask fantastyczny');
  assert.equal(seriesKind('Warhammer 40 000 Black Library'), 'universe');
  assert.equal(seriesKind('Czarna Biblioteka'), 'publisher_line');
  assert.equal(seriesKind('Herezja Horusa'), 'cycle');
  assert.equal(universeOf('Herezja Horusa t. 4'), 'Warhammer');
});
