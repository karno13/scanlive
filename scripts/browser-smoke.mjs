import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { gotoSettled, settle } from './page-settle.mjs';

// Review, sets and the catalogue checks are tabs of "Kolejka" (review 11.2026, stage 2): open the
// queue from the navigation, then its tab. Returns the navigation button that must be current.
const QUEUE_TAB = { review: 'review', sets: 'sets', checks: 'conflicts' };
async function goTo(target, view, nav) {
  const navView = QUEUE_TAB[view] ? 'queue' : view;
  const button = target.locator(`${nav} [data-view="${navView}"]`);
  await button.click();
  if (QUEUE_TAB[view])
    await target.locator(`#queueTypes [data-queue-type="${QUEUE_TAB[view]}"]`).click();
  return button;
}

/**
 * Runs in the page: visible elements with their own text (and form controls) whose colour has less
 * than 3:1 contrast against the background they actually sit on (backgrounds of the ancestors,
 * alpha blended). Returns "selector "text" ratio" lines.
 */
function lowContrastText() {
  const parse = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const blend = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const luminance = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const background = (element) => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      // Gradients and photos: the colour underneath is unknown, skip the element.
      if (style.backgroundImage !== 'none') return null;
      const color = parse(style.backgroundColor);
      if (color && color.a > 0) {
        layers.push(color);
        if (color.a >= 1) break;
      }
    }
    let result = dark ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) result = blend(layers[i], result);
    return result;
  };
  const found = [];
  for (const element of document.querySelectorAll('body *')) {
    const control = ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'].includes(element.tagName);
    const text = [...element.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent.trim())
      .join('')
      .trim();
    if (!text && !(control && (element.value || element.placeholder))) continue;
    if (!element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) continue;
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const style = getComputedStyle(element);
    if (Number(style.opacity) < 0.5 || element.closest('.cover, img')) continue;
    const under = background(element);
    const color = parse(style.color);
    if (!under || !color) continue;
    const ink = blend(color, under);
    const [high, low] = [luminance(ink), luminance(under)].sort((a, b) => b - a);
    const ratio = (high + 0.05) / (low + 0.05);
    if (ratio < 3)
      found.push(
        `${element.tagName.toLowerCase()}.${[...element.classList].join('.')} "${(text || element.value || element.placeholder).slice(0, 30)}" ${ratio.toFixed(2)}`,
      );
  }
  return found;
}

const directory = await mkdtemp(join(tmpdir(), 'bookflip-smoke-'));
const dbPath = join(directory, 'fixture.sqlite');
const port = 4391;
const url = `http://127.0.0.1:${port}`;
let server;
let browser;
try {
  const repo = new SqliteCatalogRepository(dbPath);
  try {
    const work = repo.createWork({ title: 'Solaris', authors: ['Stanisław Lem'] });
    const edition = repo.createEdition({ workId: work.id, title: 'Solaris', publisher: 'Testowe' });
    repo.attachIdentifier(edition.id, 'isbn13', '9780306406157', { source: 'smoke-test' });
    const offer = repo.upsertOffer({
      source: 'smoke-test',
      normalizedUrl: 'https://example.test/book',
      originalTitle: 'Solaris - egzemplarz testowy',
      currentPrice: 2500,
      observedIsbn: '9780306406157',
    });
    repo.putIdentificationJob({ offerId: offer.id, status: 'review_required' });
    const mobileWork = repo.createWork({
      title: 'Durotan: oficjalny prequel filmu',
      authors: ['Christie Golden'],
    });
    repo.createEdition({
      workId: mobileWork.id,
      title: mobileWork.title,
      publisher: 'Insignis Media',
    });
    const mobileOffer = repo.upsertOffer({
      source: 'smoke-test',
      normalizedUrl: 'https://example.test/durotan',
      originalTitle: 'Durotan: oficjalny prequel filmu',
      currentPrice: 10644,
    });
    repo.putIdentificationJob({ offerId: mobileOffer.id, status: 'review_required' });
  } finally {
    repo.close();
  }
  server = spawn(process.execPath, ['local-app.mjs', '--no-open'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      BOOKFLIP_LOCAL_PORT: String(port),
      BOOKFLIP_CATALOG_DB: dbPath,
      BOOKFLIP_CATALOG_AUTO_RESOLVE: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  server.stdout.on('data', (data) => {
    logs += String(data);
  });
  server.stderr.on('data', (data) => {
    logs += String(data);
  });
  let online = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) break;
    try {
      const response = await fetch(url + '/api/catalog/status');
      if (response.ok) {
        online = true;
        break;
      }
    } catch {}
    await pause(150);
  }
  assert.ok(online, 'Server did not start: ' + logs);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  // The purchase scenario and target price live in trading mode (off by default).
  await page.addInitScript(() => localStorage.setItem('bookflip.tradingMode', '1'));
  const errors = [];
  const diagnostics = [];
  page.on('pageerror', (error) => errors.push(error.stack || error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') diagnostics.push('console: ' + msg.text());
  });
  page.on('requestfailed', (request) =>
    diagnostics.push('request failed: ' + request.url() + ' ' + request.failure()?.errorText),
  );
  page.on('response', (response) => {
    if (response.status() >= 400)
      diagnostics.push('HTTP ' + response.status() + ': ' + response.url());
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(
      () => document.querySelector('#catalogWorks')?.textContent === '2',
      null,
      { timeout: 9000 },
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      catalog: document.querySelector('#catalogWorks')?.textContent,
      connection: document.querySelector('#connectionLabel')?.textContent,
      toasts: document.querySelector('#toastRegion')?.textContent,
    }));
    throw new Error(
      'Catalog boot smoke failed: ' +
        JSON.stringify({ state, errors, diagnostics, logs, reason: error.message }),
    );
  }
  // "Dziś" is the start view; the scan form is "Skan" (review 11.2026, stage 1).
  assert.equal(await page.locator('#view-today').isVisible(), true, 'start view is Dziś');
  await page.locator('#todayBody .today-tile').first().waitFor();
  for (const view of [
    'today',
    'scanner',
    'review',
    'sets',
    'checks',
    'catalog',
    'offers',
    'deals',
    'settings',
  ]) {
    await goTo(page, view, '.sidebar');
    await assert.equal(await page.locator(`#view-${view}`).isVisible(), true, `view ${view}`);
    assert.equal(
      await page.locator('.view:visible').count(),
      1,
      `only ${view} is visible on desktop`,
    );
    assert.equal(await page.locator('.view:visible').getAttribute('id'), 'view-' + view);
  }
  assert.equal(
    await page.locator('.mobile-bottom-nav').isVisible(),
    false,
    'phone navigation hidden on desktop',
  );
  // Exercise real P0 flows instead of merely checking that views appear.
  // Edition buttons must work before the slower series editor has finished loading.
  await page.route('**/api/catalog/series', async (route) => {
    await pause(1200);
    await route.continue();
  });
  await page.locator('.sidebar [data-view="catalog"]').click();
  await page.locator('#catalogList [data-catalog-id]').first().click();
  await page.locator('#catalogDetail [data-edition-detail]').first().click();
  try {
    await page.locator('#backToWork').waitFor({ state: 'visible', timeout: 6000 });
  } catch (error) {
    throw new Error(
      'Edition detail failed: ' +
        (await page.locator('#catalogDetail').textContent()) +
        ' / ' +
        error.message,
    );
  }
  await page.locator('#backToWork').click();
  await page.locator('#catalogDetail [data-edition-detail]').first().waitFor();
  await page.unrouteAll({ behavior: 'wait' });

  await page.locator('.sidebar [data-view="offers"]').click();
  await page
    .locator('#offersTableBody [data-offer-id]')
    .filter({ hasText: 'Solaris' })
    .first()
    .click();
  await page.locator('#offerDrawerContent .offer-workspace').waitFor();
  await page.locator('.scenario-calculator > summary').click();
  assert.equal(
    await page.locator('#scenarioPurchase').inputValue(),
    '25',
    '2500 grosze displays as 25 PLN',
  );
  await page.locator('#scenarioShipping').fill('5');
  await page.locator('#scenarioOther').fill('2');
  await page.locator('#scenarioResale').fill('40');
  const scenario = await page.locator('#scenarioResult').textContent();
  assert.match(scenario, /32,00/, 'purchase + delivery + costs in PLN');
  assert.match(scenario, /8,00/, 'profit in PLN');
  await page.locator('#scenarioResale').fill('20');
  assert.match(
    await page.locator('#scenarioResult').textContent(),
    /[-−]12,00/,
    'loss stays signed',
  );
  await page.locator('#saveScenario').click();
  await page.waitForFunction(() =>
    document.querySelector('#scenarioSaveStatus')?.textContent?.includes('Zapisano'),
  );
  await page.locator('.offer-workspace input[type="number"]').fill('30');
  await page.locator('.offer-workspace button').click();
  await page.waitForFunction(() =>
    document
      .querySelector('.offer-workspace small[role="status"]')
      ?.textContent?.includes('Zapisano'),
  );
  const workspace = await (await page.request.get(url + '/api/offer-workspace')).json();
  assert.equal(workspace.items.length, 1);
  assert.equal(workspace.items[0].targetReached, false, 'target signal requires watched offer');
  await page.locator('.offer-workspace input[type="checkbox"]').check();
  await page.locator('.offer-workspace button').click();
  await page.waitForFunction(async () => {
    const r = await fetch('/api/offer-workspace');
    return (await r.json()).items?.[0]?.targetReached === true;
  });

  // P1: scanner profiles must be durable across a browser reload.
  await page.locator('#closeOfferDrawer').click();
  await page.locator('.sidebar [data-view="scanner"]').click();
  await page.locator('#queries').fill('Solaris');
  await page.locator('#sourceGrid input[type="checkbox"]').first().check();
  await page.locator('.scan-profiles > summary').click();
  await page
    .locator('.scan-profiles input[aria-label="Nazwa nowego profilu"]')
    .fill('Profil testowy');
  await page.locator('.scan-profiles button').filter({ hasText: 'Zapisz nowy profil' }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.scan-profiles select option')].some(
      (o) => o.value === 'Profil testowy',
    ),
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.scan-profiles select option')].some(
      (o) => o.value === 'Profil testowy',
    ),
  );
  const stored = await (await page.request.get(url + '/api/offer-workspace')).json();
  assert.equal(stored.items[0].targetReached, true, 'target price survives reload');
  await goTo(page, 'review', '.sidebar');
  // Lists load when their view opens (review 11.2026, stage 0).
  await page.locator('#reviewList .review-item').first().waitFor();
  await assert.equal(
    (await page.locator('#reviewList .review-item').count()) > 0,
    true,
    'nonempty review',
  );
  // Elements with the hidden attribute stay hidden whatever layout rule targets them (the pinned
  // review buttons: only one of "Zatwierdź" and "Utwórz wydanie i przypisz" shows).
  const hiddenButVisible = (target) =>
    target.evaluate(() =>
      [...document.querySelectorAll('[hidden]')]
        .filter((element) => element.checkVisibility())
        .map((element) => element.id || element.className || element.tagName),
    );
  await page.locator('#reviewList .review-item').filter({ hasText: 'Solaris' }).first().click();
  await page.locator('#reviewDetail #approveReview').waitFor();
  assert.equal(
    (await page.locator('#reviewDetail #approveReview:visible').count()) +
      (await page.locator('#reviewDetail #createOfferEdition:visible').count()),
    1,
    'one primary review button',
  );
  assert.deepEqual(await hiddenButVisible(page), [], 'desktop review: hidden elements stay hidden');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const view of ['today', 'review', 'sets', 'catalog', 'offers', 'settings']) {
    const navView = QUEUE_TAB[view] ? 'queue' : view;
    assert.equal(
      await page.locator(`.mobile-bottom-nav [data-view="${navView}"]`).isVisible(),
      true,
      `mobile destination ${view} should be reachable`,
    );
    const tab = await goTo(page, view, '.mobile-bottom-nav');
    assert.equal(await page.locator(`#view-${view}`).isVisible(), true, `mobile view ${view}`);
    assert.equal(
      await page.locator('.view:visible').count(),
      1,
      `only ${view} is visible on phone`,
    );
    assert.equal(await tab.getAttribute('aria-current'), 'page', `current mobile tab ${view}`);
  }
  assert.equal(
    await page.locator('.sidebar').isVisible(),
    false,
    'desktop sidebar hidden on phone',
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    true,
    'no horizontal page overflow on phone',
  );
  // Phone form fields: 16 px text (iOS Safari zooms into smaller ones) and 44 px touch height.
  for (const view of ['review', 'sets', 'catalog', 'offers', 'settings']) {
    await goTo(page, view, '.mobile-bottom-nav');
    await settle(page);
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '.view:not([hidden]) :is(input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea)',
        ),
      ]
        .filter((field) => field.checkVisibility())
        .filter(
          (field) =>
            parseFloat(getComputedStyle(field).fontSize) < 16 ||
            field.getBoundingClientRect().height < 43.5,
        )
        .map(
          (field) =>
            `#${field.id} ${getComputedStyle(field).fontSize} ${Math.round(field.getBoundingClientRect().height)}px`,
        ),
    );
    assert.deepEqual(small, [], `phone ${view}: form fields of 16 px text and 44 px height`);
    assert.deepEqual(
      await hiddenButVisible(page),
      [],
      `phone ${view}: hidden elements stay hidden`,
    );
  }
  // Phone offer drawer: disclosures are 44 px touch targets with a visible keyboard focus.
  await goTo(page, 'offers', '.mobile-bottom-nav');
  await page
    .locator('#offersMobileList [data-mobile-offer-id]')
    .filter({ hasText: 'Solaris' })
    .first()
    .click();
  const disclosure = page
    .locator('#offerDrawerContent .detail-disclosure > summary')
    .filter({ hasText: 'Jak interpretować historię cen?' });
  await disclosure.waitFor();
  assert.ok((await disclosure.boundingBox()).height >= 43.5, 'drawer disclosure is 44 px tall');
  await page.keyboard.press('Shift');
  await disclosure.focus();
  const ring = await disclosure.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  assert.ok(
    ring.style !== 'none' && ring.width >= 2,
    'visible keyboard focus: ' + JSON.stringify(ring),
  );
  await page.locator('#closeOfferDrawer').click();
  assert.deepEqual(errors, [], 'Unexpected frontend exceptions');

  // Reduced motion: nothing animates or transitions.
  const calm = await browser.newContext({ reducedMotion: 'reduce' });
  const still = await calm.newPage();
  await gotoSettled(still, url);
  const moving = await still.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((element) => {
        const style = getComputedStyle(element);
        return (
          style.animationName !== 'none' ||
          style.transitionDuration.split(',').some((duration) => parseFloat(duration) > 0)
        );
      })
      .map((element) => element.tagName + '.' + [...element.classList].join('.')),
  );
  assert.deepEqual(moving, [], 'prefers-reduced-motion: no animation or transition');
  await calm.close();

  // Both themes, every view, desktop and phone, with every disclosure open: no text may sit on a
  // background it barely differs from (the dark theme once had white tiles under light text).
  for (const colorScheme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({
        colorScheme,
        viewport: { width, height: width === 390 ? 844 : 900 },
      });
      const themed = await context.newPage();
      await gotoSettled(themed, url);
      const views = ['today', 'offers', 'review', 'sets', 'checks', 'catalog', 'settings'];
      // The scan form is not in the phone bar; Dziś opens it.
      if (width > 900) views.splice(1, 0, 'scanner');
      for (const view of views) {
        await goTo(themed, view, width > 900 ? '.sidebar' : '.mobile-bottom-nav');
        await settle(themed);
        await themed.evaluate(() =>
          document.querySelectorAll('.view:not([hidden]) details').forEach((d) => (d.open = true)),
        );
        await themed.waitForTimeout(150);
        if (view === 'review' && width === 390) {
          // Overlay disclosures must close before selecting a row underneath them.
          await themed.evaluate(() =>
            document.querySelectorAll('.review-toolbar details').forEach((d) => {
              d.open = false;
            }),
          );
          await themed.locator('#reviewList .review-item').filter({ hasText: 'Durotan' }).click();
          await themed.locator('#reviewDetail .rv-cand-body').first().waitFor();
          const dimensions = await themed.evaluate(() => {
            const body = document
              .querySelector('#reviewDetail .rv-cand-body')
              .getBoundingClientRect();
            const actions = document
              .querySelector('#reviewDetail .lean-review-primary-actions')
              .getBoundingClientRect();
            return {
              textWidth: body.width,
              actionsHeight: actions.height,
              overflow: document.documentElement.scrollWidth > innerWidth,
            };
          });
          assert.ok(
            dimensions.textWidth >= 180,
            'proposal text must not collapse into a narrow column',
          );
          assert.ok(
            dimensions.actionsHeight < 230,
            'decision actions must not become vertical letter columns',
          );
          assert.equal(dimensions.overflow, false);
          await mkdir('artifacts/mobile-review', { recursive: true });
          await themed.screenshot({
            path: 'artifacts/mobile-review/' + colorScheme + '.png',
            fullPage: true,
          });
        }
        const low = await themed.evaluate(lowContrastText);
        assert.deepEqual(low, [], `${colorScheme} ${width}px ${view}: text below 3:1 contrast`);
      }
      await context.close();
    }
  }
  console.log('Browser smoke passed: every view and queue tab, nonempty SQLite, no JS page errors');
} finally {
  if (browser) await browser.close();
  if (server) {
    server.kill();
    await pause(250);
  }
  await rm(directory, { recursive: true, force: true });
}
