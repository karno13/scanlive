import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fallbackActions, isbnLike } from '../app/views/palette.js';

test('ISBN-like text: 10 or 13 characters after removing spaces and dashes', () => {
  assert.equal(isbnLike('978-83-7578-064-1'), '9788375780641');
  assert.equal(isbnLike('83 7578 064 X'), '837578064X');
  assert.equal(isbnLike('Diuna'), null);
  assert.equal(isbnLike('12345'), null);
  assert.equal(isbnLike('1234567890123'), null, '13 digits must start with 978/979');
});

test('no palette hit: scan the phrase, search offers, search the catalogue', () => {
  assert.deepEqual(fallbackActions(''), []);
  assert.deepEqual(
    fallbackActions('  Herezja Horusa ').map((item) => [item.kind, item.label]),
    [
      ['scan', 'Skanuj «Herezja Horusa»'],
      ['offers', 'Szukaj w ofertach'],
      ['catalog', 'Szukaj w katalogu'],
    ],
  );
  const isbn = fallbackActions('978-83-7578-064-1');
  assert.equal(isbn[0].kind, 'isbn');
  assert.equal(isbn[0].label, 'Dodaj książkę przez ISBN');
  assert.match(isbn[0].hint, /9788375780641/);
});

test('the palette never ends on a bare "Brak wyników" and the app wires every fallback', async () => {
  const palette = await readFile(new URL('../app/views/palette.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../app/app.js', import.meta.url), 'utf8');
  assert.match(palette, /items = withFallback\(staticItems\(query\), query\)/);
  assert.match(palette, /items = withFallback\(staticItems\(input\.value\), input\.value\)/);
  assert.match(app, /onFallback: \(kind, text, isbn\) =>/);
  for (const kind of ["kind === 'isbn'", "kind === 'scan'", "kind === 'offers'"])
    assert.ok(app.includes(kind), kind);
});
