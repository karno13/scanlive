import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanRun, sourceState, problemLabel } from './scan-run.js';

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
});
