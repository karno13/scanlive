import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCWORLD_TITLES, scanSeriesOptions, installScanSeries } from './scan-series.js';

test('Discworld is available without catalogue data and contains every main novel', () => {
  const series = scanSeriesOptions()[0];
  assert.equal(series.titles.length, 41);
  assert.equal(new Set(series.titles).size, 41);
  assert.equal(series.titles[0], 'Kolor magii');
  assert.equal(series.titles.at(-1), 'Pasterska korona');
});

test('catalogue data cannot add series to the agreed lists', () => {
  const options = scanSeriesOptions({ universes: [
    { name: 'Świat Dysku', cycles: [] },
    { name: 'Poza seriami', cycles: [{ works: [{ title: 'Niepowiązana' }] }] },
    { name: 'Diuna', cycles: [{ name: 'Kroniki', works: [
      { title: 'Diuna / Dune' }, { title: 'diuna / Dune' },
    ], missingTitles: { 2: 'Mesjasz Diuny' } }] },
  ] });
  assert.deepEqual(options.map((option) => option.name), ['Świat Dysku', 'Herezja Horusa', 'Gotrek i Felix']);
});

test('selecting a series fills the editable scanner form without network access', (t) => {
  class Element extends EventTarget {
    value = '';
    textContent = '';
    children = [];
    replaceChildren(...children) { this.children = children; }
    add(child) { this.children.push(child); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new Element() } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  const elements = new Map(['#scanSeries', '#queries', '#scanSeriesNote'].map((id) => [id, new Element()]));
  const input = elements.get('#queries');
  const picker = elements.get('#scanSeries');
  input.value = 'Stara fraza';
  let inputs = 0;
  input.addEventListener('input', () => inputs++);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => assert.fail('Series selection must not fetch data');
  t.after(() => { globalThis.fetch = previousFetch; });
  installScanSeries({
    $: (id) => elements.get(id), toast: assert.fail,
    json: () => assert.fail('Series selection must not read the catalogue'),
  });
  picker.dispatchEvent(new Event('focus'));
  assert.equal(picker.children.length, 4);
  picker.value = 'discworld';
  picker.dispatchEvent(new Event('change'));
  assert.deepEqual(input.value.split('\n'), DISCWORLD_TITLES);
  assert.equal(inputs, 1);
  assert.equal(picker.value, 'discworld');
  assert.match(elements.get('#scanSeriesNote').textContent, /Wstawiono 41 tytułów/);
  for (const series of scanSeriesOptions().slice(1)) {
    picker.value = series.id;
    picker.dispatchEvent(new Event('change'));
    assert.deepEqual(input.value.split('\n'), series.titles);
    assert.match(elements.get('#scanSeriesNote').textContent, new RegExp(series.name));
  }
  assert.equal(inputs, 3);
});
