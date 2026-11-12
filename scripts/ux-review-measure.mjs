import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const stage = process.argv[2] || 'before';
const views = (process.argv[3] || 'review').split(',');
const dir = `artifacts/ux-review/${stage}`;
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 390])
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({
        viewport: { width, height: width === 390 ? 844 : 900 },
        colorScheme: theme,
      });
      await page.goto('http://127.0.0.1:4399', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => Number(document.querySelector('#catalogWorks')?.textContent) > 0,
      );
      for (const view of views) {
        await page.evaluate(
          (v) => document.querySelector(`.sidebar [data-view="${v}"]`).click(),
          view,
        );
        await page.waitForTimeout(700);
        if (view === 'review') await page.locator('#reviewList .review-item').first().click();
        if (view === 'sets' && width > 900) {
          const sets = await page.request
            .get('http://127.0.0.1:4399/api/sets')
            .then((r) => r.json());
          const target =
            sets.items.find((s) => s.editions.length === 9) ||
            sets.items.find((s) => s.editions.length >= 6);
          if (target) await page.locator(`[data-set-id="${target.offerId}"]`).click();
        }
        await page.waitForTimeout(300);
        const metrics = await page.evaluate((view) => {
          const box = (s) => {
            const e = document.querySelector(s);
            if (!e) return null;
            const r = e.getBoundingClientRect();
            return {
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
              height: Math.round(r.height),
              scroll: e.scrollHeight,
              client: e.clientHeight,
            };
          };
          const rows = (s) =>
            [...document.querySelectorAll(s)].filter((e) => {
              const r = e.getBoundingClientRect();
              let bottom = innerHeight;
              for (let parent = e.parentElement; parent; parent = parent.parentElement)
                if (['auto', 'hidden', 'scroll'].includes(getComputedStyle(parent).overflowY))
                  bottom = Math.min(bottom, parent.getBoundingClientRect().bottom);
              return r.width && r.top >= 0 && r.bottom <= bottom;
            }).length;
          return {
            view,
            overflow: document.documentElement.scrollWidth > innerWidth,
            pageHeight: document.documentElement.scrollHeight,
            list: box(
              view === 'review'
                ? '#reviewList'
                : view === 'catalog'
                  ? '#catalogList'
                  : view === 'sets'
                    ? '.sets-sidebar'
                    : '.offers-table-wrap',
            ),
            actions: box('#reviewDetail .lean-review-primary-actions'),
            approve: box('#approveReview'),
            reviewRows: rows('#reviewList .review-item'),
            catalogRows: rows('#catalogList .catalog-row'),
            offerRows: rows('#offersTableBody tr'),
            setMembers: rows('#setMembers .is-member'),
            member: box('#setMembers .is-member'),
            offerRow: box('#offersTableBody tr'),
            cards: rows('#offersMobileList .mobile-offer'),
          };
        }, view);
        results.push({ width, theme, ...metrics });
        await page.screenshot({ path: `${dir}/${view}-${width}-${theme}.png` });
        if (view === 'scanner' && /stage6-4|stage6-5|final/.test(stage)) {
          await page.locator('#queryStats').evaluate((e) => {
            e.open = true;
          });
          await page.locator('#queryStatsBody table').first().waitFor();
          await page.locator('#queryStats').scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${dir}/scanner-insights-${width}-${theme}.png` });
          await page.locator('#queryStats').evaluate((e) => {
            e.open = false;
          });
        }
      }
      await page.close();
    }
} finally {
  await browser.close();
}
await writeFile(`${dir}/metrics.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results));
