// Screenshots of views at 1440×900 and 390×844 in both themes, with two checks per shot: no
// horizontal page scroll, and (at 390 px) no visible touch target lower than 44 px.
//   node scripts/ux-shots.mjs <port> <label> [view,view:state,...]
// A view is a sidebar data-view; ":open" opens its first list item, ":more" also opens the review
// "Więcej" menu. Writes artifacts/ux-shots/<label>/<view>-<width>-<theme>.png and report.json.
// Needs playwright (see CLAUDE.md); run against a server on a copy of the data.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { settle, trackRequests } from './page-settle.mjs';

const [port = '4399', label = 'run', list = 'scanner,review:open,catalog,sets,offers,settings'] =
  process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const dir = `artifacts/ux-shots/${label}`;
await mkdir(dir, { recursive: true });
const sizes = (process.env.SHOT_SIZES || '1440x900,390x844')
  .split(',')
  .map((size) => size.split('x').map(Number));
const themes = (process.env.SHOT_THEMES || 'light,dark').split(',');

const openFirst = {
  review: '#reviewList .review-item',
  catalog: '#catalogList [data-catalog-id]',
  sets: '#setList [data-set-id]',
  offers:
    '#offersTableBody tr[data-open-offer] td:nth-child(3), #offersMobileList [data-mobile-offer-id]',
};

const browser = await chromium.launch();
const report = [];
let failed = false;
try {
  for (const [width, height] of sizes)
    for (const theme of themes) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme });
      page.__inflight = trackRequests(page);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript((value) => {
        try {
          localStorage.setItem('bookflip.theme', value);
        } catch {}
      }, theme);
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await settle(page);
      for (const entry of list.split(',')) {
        const [view, state] = entry.split(':');
        await page.evaluate((name) => {
          const button =
            document.querySelector(`.sidebar [data-view="${name}"]`) ||
            document.querySelector(`.mobile-bottom-nav [data-view="${name}"]`);
          button?.click();
        }, view);
        await page.waitForTimeout(500);
        await settle(page);
        if (state && openFirst[view]) {
          await page
            .locator(openFirst[view])
            .first()
            .click()
            .catch(() => {});
          await page.waitForTimeout(600);
          await settle(page);
        }
        // Queue tabs: ':sets', ':conflicts', ':duplicates' pick the Kolejka type; ':quick', ':add' the review tab.
        if (['sets', 'conflicts', 'duplicates', 'review'].includes(state)) {
          await page.locator('#queueTypes [data-queue-type="' + state + '"]').click();
          await page.waitForTimeout(500);
          await settle(page);
        }
        if (['quick', 'add'].includes(state)) {
          await page.locator('[data-review-tab="' + state + '"]').click();
          await page.waitForTimeout(800);
          await settle(page);
        }
        // ':tile' clicks the first Dziś tile (it opens a filtered list).
        if (state === 'tile') {
          await page.locator('#todayBody .today-tile').first().click();
          await page.waitForTimeout(500);
          await settle(page);
        }
        if (state === 'more') {
          await page
            .locator('#reviewDetail .rv-more > summary')
            .click()
            .catch(() => {});
          await page.waitForTimeout(200);
        }
        const checks = await page.evaluate((phone) => {
          const visible = (element) => {
            const box = element.getBoundingClientRect();
            if (!box.width || !box.height) return false;
            const style = getComputedStyle(element);
            if (style.visibility === 'hidden' || style.display === 'none') return false;
            return (
              box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth
            );
          };
          const small = phone
            ? [
                ...document.querySelectorAll(
                  'button, a[href], summary, select, input:not([type=hidden]), [role="tab"]',
                ),
              ]
                .filter(visible)
                .filter((element) => !element.closest('[hidden], .sr-only, dialog:not([open])'))
                .filter((element) => {
                  // A checkbox inside its label counts as the label's target.
                  if (
                    element.matches('input[type=checkbox], input[type=radio]') &&
                    element.closest('label')
                  )
                    return false;
                  // Links inside a sentence are exempt (WCAG 2.5.8 inline exception).
                  if (
                    element.matches('a') &&
                    element.closest('p') &&
                    element.closest('p').textContent.trim().length >
                      element.textContent.trim().length + 10
                  )
                    return false;
                  const box = element.getBoundingClientRect();
                  return box.height < 44 - 0.5;
                })
                .map((element) => {
                  const box = element.getBoundingClientRect();
                  const name = element.id
                    ? '#' + element.id
                    : element.tagName.toLowerCase() + '.' + [...element.classList].join('.');
                  return `${name} ${Math.round(box.width)}×${Math.round(box.height)} "${(element.textContent || element.value || '').trim().slice(0, 30)}"`;
                })
            : [];
          return { overflow: document.documentElement.scrollWidth > innerWidth, small };
        }, width <= 600);
        const file = `${view}${state ? '-' + state : ''}-${width}-${theme}.png`;
        await page.screenshot({ path: `${dir}/${file}` });
        const row = {
          view: entry,
          width,
          theme,
          overflow: checks.overflow,
          smallTargets: checks.small,
        };
        if (checks.overflow || checks.small.length) failed = true;
        report.push(row);
        if (state === 'more') await page.keyboard.press('Escape');
        // Phone detail views cover the list: go back before the next view.
        await page.evaluate(() => document.querySelector('.detail-back:not([hidden])')?.click());
      }
      if (errors.length) {
        failed = true;
        report.push({ width, theme, errors });
      }
      await page.close();
    }
} finally {
  await browser.close();
}
await writeFile(`${dir}/report.json`, JSON.stringify(report, null, 2) + '\n');
for (const row of report)
  if (row.errors || row.overflow || row.smallTargets?.length) console.log(JSON.stringify(row));
console.log(
  failed
    ? 'Problems found (see report.json).'
    : `OK: ${report.length} shots, no overflow, no small targets.`,
);
process.exitCode = failed ? 1 : 0;
