import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanRun, sourceState, problemLabel, isRetryableError } from './scan-run.js';
import { phrasesOf, stalePhrases } from './scan-profiles.js';
import { describeResult, scheduleHeadline } from './scan-schedule.js';

test('phrases are split by line only, so a title with a comma stays whole', () => {
  assert.deepEqual(phrasesOf('Ogniem i mieczem, tom 1\nDiuna\n\nDiuna'), ['Ogniem i mieczem, tom 1', 'Diuna']);
});

test('a phrase is stale when it found offers before but nothing new lately', () => {
  const items = [{ query: 'Warcraft', offers: 40, fresh: 0 }, { query: 'Diuna', offers: 10, fresh: 3 }];
  assert.deepEqual(stalePhrases(['warcraft', 'Diuna', 'Nowa fraza'], items), ['warcraft']);
});

test('the schedule says when a run was partial and which sources it skipped', () => {
  assert.equal(describeResult({ lastResult: 'partial', lastProblems: ['OLX'], lastSkipped: ['Allegro'] }), 'częściowo udany — błędy: OLX; pominięto niedziałające: Allegro');
  assert.equal(scheduleHeadline({ enabled: false }), 'Automatyczny skan: wyłączony');
  assert.match(scheduleHeadline({ enabled: true, everyHours: 12, profile: '__all__', lastResult: 'partial' }), /co 12 h \(wszystkie profile po kolei\).*z błędami/);
});

test('a source state comes from its counters: dead, partial, ok, running', () => {
  assert.equal(sourceState({ status: 'partial', errors: 7, offers: 0 }).label, 'nie działa');
  assert.equal(sourceState({ status: 'partial', errors: 1, offers: 40 }).label, 'częściowo');
  assert.equal(sourceState({ status: 'completed', errors: 0, offers: 824 }).label, 'OK');
  assert.equal(sourceState({ status: 'running' }).label, 'skanuje…');
  assert.equal(problemLabel('SOURCE_HTTP_429'), 'za dużo zapytań (429)');
});

test('the run panel shows the server numbers even when this tab did not start the scan', async () => {
  const elements = new Map();
  const $ = (selector) => {
    if (!elements.has(selector)) elements.set(selector, { dataset: {}, style: {}, textContent: '', innerHTML: '', hidden: true, addEventListener() {} });
    return elements.get(selector);
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      status: 'completed', startedAt: '2026-11-08T14:27:33Z', finishedAt: '2026-11-08T14:38:25Z',
      summary: { offers: 885, newOffers: 35 },
      progress: { completed: 49, total: 49, percent: 100 }, telemetry: {},
      diagnostics: { totalTasks: 49, offersSeen: 901, sources: {
        Vinted: { completed: 7, offers: 824, errors: 0, status: 'completed' },
        OLX: { completed: 7, offers: 0, errors: 7, status: 'partial', lastError: 'SOURCE_HTTP_403' },
      } },
    }),
  });
  const run = createScanRun({ $ });
  await run.refresh();
  assert.equal($('#scanRun').hidden, false);
  assert.match($('#scanRunSources').innerHTML, /<td>824<\/td>/);
  assert.match($('#scanRunSources').innerHTML, /nie działa/);
  assert.match($('#scanRunTotals').innerHTML, /<strong>35<\/strong>/);
  assert.match($('#scanRunAdvice').innerHTML, /OLX/);
  assert.equal($('#progressMessage').textContent, 'Zapisano 885 ofert');
  // 49 tasks in 652 s: the estimate before the next scan uses ~13 s per task.
  assert.equal(Math.round(run.secondsPerTask()), 13);
  // A bot check is not offered for retry; the advice says so.
  assert.match($('#scanRunAdvice').innerHTML, /pomija ten problem/);
});

test('only passing errors are retried: not bot checks, not tasks skipped after one', () => {
  assert.equal(isRetryableError({ code: 'SOURCE_HTTP_503' }), true);
  assert.equal(isRetryableError({ code: 'SOURCE_HTTP_429' }), true);
  assert.equal(isRetryableError({ code: 'SOURCE_HTTP_429', blocked: true }), false);
  assert.equal(isRetryableError({ code: 'SOURCE_CAPTCHA' }), false);
  assert.equal(isRetryableError({ code: 'SOURCE_HTTP_403' }), false);
  assert.equal(isRetryableError({ code: 'SOURCE_TIMEOUT', skipped: true }), false);
  assert.equal(isRetryableError({ code: 'SOURCE_HTTP_404' }), false);
});
