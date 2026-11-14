// Stage 2 of the 11.2026 review: the "Kolejka" view, the batch grid and rejecting with a rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { QUEUE_TYPES, queueTypeOf, rowKeyAction } from '../app/views/queue.js';
import { batchCardFacts, batchPayload } from '../app/views/review-batch.js';
import { ruleRequest, suggestedPhrase } from '../app/views/reject-rule.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('one queue, four types; the catalogue checks share one section', () => {
  assert.deepEqual(
    QUEUE_TYPES.map((type) => [type.id, type.view]),
    [
      ['review', 'review'],
      ['sets', 'sets'],
      ['conflicts', 'checks'],
      ['duplicates', 'checks'],
    ],
  );
  assert.equal(queueTypeOf('review'), 'review');
  assert.equal(queueTypeOf('checks', 'duplicates'), 'duplicates');
  assert.equal(queueTypeOf('checks', 'other'), 'conflicts');
  assert.equal(queueTypeOf('offers'), null);
});

test('shared keys over a list of rows: ↑/↓ and J/K move, S skips, Enter acts, X dismisses', () => {
  assert.deepEqual(rowKeyAction('ArrowDown', -1, 3), { index: 0, press: null });
  assert.deepEqual(rowKeyAction('j', 0, 3), { index: 1, press: null });
  assert.deepEqual(rowKeyAction('s', 2, 3), { index: 2, press: null });
  assert.deepEqual(rowKeyAction('k', 0, 3), { index: 0, press: null });
  assert.deepEqual(rowKeyAction('Enter', 1, 3), { index: 1, press: 'primary' });
  assert.deepEqual(rowKeyAction('x', -1, 3), { index: 0, press: 'dismiss' });
  assert.deepEqual(rowKeyAction('q', 1, 3), { index: 1, press: null });
  assert.deepEqual(rowKeyAction('Enter', 0, 0), { index: -1, press: null });
});

test('the batch sends exactly what one-by-one decisions would', () => {
  const items = [
    { jobId: 'a', kind: 'edition', editionId: 'e1', workId: 'w1' },
    { jobId: 'b', kind: 'edition', editionId: null, workId: 'w2' },
    { jobId: 'c', kind: 'isbn', isbn: '9788375780641' },
  ];
  assert.deepEqual(batchPayload('quick', items), {
    items: [
      { jobId: 'a', editionId: 'e1' },
      { jobId: 'b', workId: 'w2' },
      { jobId: 'c', isbn: '9788375780641' },
    ],
  });
  assert.deepEqual(batchPayload('add', [{ jobId: 'x' }, { jobId: 'y' }]), { jobIds: ['x', 'y'] });
  assert.deepEqual(
    batchCardFacts({ kind: 'add', publisher: 'Copernicus', year: 2012, isbn: '978' }),
    ['nowe wydanie', 'Copernicus', '2012', 'ISBN 978'],
  );
  assert.deepEqual(batchCardFacts({ kind: 'edition', editions: 3, editionId: null, year: 2020 }), [
    'z katalogu',
    '2020',
    'wydanie nieustalone',
  ]);
});

test('reject with a rule: phrase suggestion and request body', () => {
  assert.equal(suggestedPhrase('Talia kart Magic: the Gathering 2024'), 'Talia kart Magic');
  assert.deepEqual(ruleRequest('seller', { offerId: 'o1' }), { kind: 'seller', offerId: 'o1' });
  assert.equal(ruleRequest('phrase', { offerId: 'o1', phrase: 'ab' }), null);
  assert.deepEqual(ruleRequest('price_above', { offerId: 'o1', price: '300,50' }), {
    kind: 'price_above',
    value: 300.5,
    offerId: 'o1',
  });
  assert.equal(ruleRequest('price_below', { price: '0' }), null);
});

test('the queue is wired: navigation, batch grid in review, rules in settings, sets dismissal', async () => {
  const [app, review, sets, html, controls] = await Promise.all(
    [
      '../app/app.js',
      '../app/views/review.js',
      '../app/views/sets.js',
      '../app/index.html',
      '../app/views/trading-controls.js',
    ].map(read),
  );
  assert.match(app, /if \(name === 'queue'\) name = QUEUE_TYPES\.find/);
  assert.match(app, /const navName = QUEUE_VIEWS\.includes\(name\) \? 'queue' : name;/);
  assert.match(html, /<section class="view" id="view-checks" data-title="Kolejka" hidden>/);
  assert.match(review, /if \(batch\.wanted\(state\.reviewBucket\) && !bulk\.isSelecting\(\)\)/);
  assert.match(review, /r: \(\) => press\('#rejectWithRule'\)/);
  assert.doesNotMatch(review, /openSurePlan|reviewSureOpen/);
  assert.match(html, /<div id="rejectionRules">/);
  assert.match(sets, /data-set-dismiss="/);
  assert.match(sets, /x: \(\) => activeId && !active\(\)\?\.dismissedAt && dismiss\(activeId\)/);
  assert.match(controls, /Cofnij całą partię/);
});
