// Stage 0 of the 11.2026 review: a view reads its data when it is first opened, one click sends
// each request once, and trading requests are never sent with trading mode off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('startup reads no list data: lists load on the first visit of their view', async () => {
  const app = await read('../app/app.js');
  const startup = app.slice(app.indexOf('const startupView = viewFromSearch'));
  const boot = startup.slice(0, startup.indexOf('.catch('));
  assert.doesNotMatch(boot, /loadHistory\(\)/, 'no /api/history/brief at startup');
  assert.doesNotMatch(boot, /loadCatalogData\(\)/, 'no works/jobs/offers lists at startup');
  assert.match(boot, /loadCatalogStatus\(\)/, 'navigation counts come from the status');
  assert.match(boot, /ensureViewData\(startupView\)/);
  assert.match(app, /void ensureViewData\(name\);/);
  assert.match(app, /const viewKinds = \{ catalog: 'works', review: 'jobs', offers: 'offers' \};/);
  // A refresh reloads the lists already read plus the open view's, not all three.
  assert.match(
    app,
    /const wanted = kinds \|\| \[\.\.\.new Set\(\[\.\.\.loadedKinds, viewKinds\[state\.activeView\]\]/,
  );
  // Catalogue tools read their data when Katalog is opened.
  // Stage 2: the suspect assignments and duplicates are also opened from "Kolejka".
  assert.match(app, /if \(name === 'catalog' \|\| name === 'checks'\) mountCatalogTools\(\);/);
  assert.doesNotMatch(app, /^mountDuplicates\(/m);
});

test('the suggestion requests of one review job are shared between the two renders of a click', async () => {
  const review = await read('../app/views/review.js');
  assert.match(review, /function jobJson\(jobId, kind\)/);
  for (const kind of ['local-candidates', 'offer-edition', 'proposals'])
    assert.ok(review.includes(`jobJson(job.id, '${kind}')`), kind);
  assert.doesNotMatch(
    review,
    /json\(`\/api\/identification-jobs\/\$\{encodeURIComponent\(job\.id\)\}\/(?:local-candidates|proposals)`\)/,
  );
  assert.doesNotMatch(
    review,
    /await json\(`\/api\/identification-jobs\/\$\{encodeURIComponent\(job\.id\)\}\/offer-edition`\);/,
  );
});

test('trading requests wait for trading mode', async () => {
  const offers = await read('../app/views/offers.js');
  const sets = await read('../app/views/set-trading.js');
  const controls = await read('../app/views/trading-controls.js');
  assert.match(
    offers,
    /if \(tradingMode\(\)\) try \{\s*const \[saved,defaults\]=await Promise\.all\(\[json\('\/api\/offer-scenarios\//,
  );
  assert.match(
    sets,
    /if \(document\.body\.classList\.contains\('trading-mode'\)\) void mountCosts\(\);/,
  );
  assert.match(
    controls,
    /if\(!settingsLoaded && document\.body\.classList\.contains\('trading-mode'\)\) \{\s*settingsLoaded=true;/,
  );
});
