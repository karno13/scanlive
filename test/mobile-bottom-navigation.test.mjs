import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { appStyleRules } from '../app-styles.mjs';

// Stage 1 of the 11.2026 review: Dziś takes the scan form's place; "Nowy skan" on Dziś opens it.
test('mobile bottom navigation reaches every BookFlip view', async () => {
  const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../app/app.js', import.meta.url), 'utf8');
  const nav = html.match(/<nav class="mobile-bottom-nav"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav);
  // Stage 2: one "Kolejka" entry; sets are a tab inside it.
  // „Okazje” took the place of „Źródła” (2026-11-15): source state and the scan are on Dziś.
  for (const view of ['today', 'queue', 'catalog', 'offers', 'deals', 'settings'])
    assert.match(nav, new RegExp('data-view="' + view + '"'));
  assert.match(html, /id="todayScan">Nowy skan</);
  assert.match(nav, /class="mobile-nav-item active" data-view="today"/);
  assert.match(app, /\.nav-item, \.mobile-nav-item/);
  assert.match(nav, /aria-label="Nawigacja mobilna"/);
  assert.doesNotMatch(nav, /data-view="(?:review|sets)"/);
  assert.match(app, /if \(name === 'settings'\)/);
});
// Layout and visible focus are checked in the browser (scripts/browser-smoke.mjs); the safe area of
// a notched phone cannot be emulated there, so this rule is checked on the parsed stylesheets.
test('mobile navigation keeps clear of the safe area at the bottom of the screen', async () => {
  const rules = await appStyleRules();
  assert.ok(
    rules.some(
      (rule) =>
        rule.selectors.some((selector) => /\.mobile-bottom-nav$/.test(selector)) &&
        rule.declarations.some(({ value }) => value.includes('env(safe-area-inset-bottom')),
    ),
  );
});
