import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Stage 1 of the 11.2026 review: Dziś takes the scan form's place; "Nowy skan" on Dziś opens it.
test('mobile bottom navigation reaches every BookFlip view', async () => {
  const html = await readFile(new URL('./app/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('./app/app.js', import.meta.url), 'utf8');
  const nav = html.match(/<nav class="mobile-bottom-nav"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav);
  // Stage 2: one "Kolejka" entry; sets are a tab inside it.
  for (const view of ['today', 'queue', 'catalog', 'offers', 'settings'])
    assert.match(nav, new RegExp('data-view="' + view + '"'));
  assert.match(html, /id="todayScan">Nowy skan</);
  assert.match(nav, /class="mobile-nav-item active" data-view="today"/);
  assert.match(app, /\.nav-item, \.mobile-nav-item/);
  assert.match(nav, /aria-label="Nawigacja mobilna"/);
  assert.doesNotMatch(nav, /data-view="(?:review|sets)"/);
  assert.match(app, /if \(name === 'settings'\)/);
});
test('mobile navigation supports safe area and visible focus', async () => {
  const css = (
    await Promise.all(
      ['app.css'].map((file) => readFile(new URL('./app/' + file, import.meta.url), 'utf8')),
    )
  ).join('\n');
  assert.match(css, /\.mobile-bottom-nav\{display:grid/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.sidebar\{display:none/);
});
