import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { settle } from './page-settle.mjs';

const dir = 'artifacts/ux-review/acceptance';
await mkdir(dir, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1440, 1920, 1100, 390])
    for (const theme of ['light', 'dark']) {
      console.log('Sprawdzam', width, theme);
      const height = width === 1920 ? 1080 : width === 390 ? 844 : 900;
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('http://127.0.0.1:4399', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => Number(document.querySelector('#catalogWorks')?.textContent) > 0,
      );
      await settle(page);
      const go = async (view) => {
        await page.evaluate(
          (v) => document.querySelector(`.sidebar [data-view="${v}"]`).click(),
          view,
        );
        await page.waitForTimeout(400);
        await settle(page);
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
          false,
          `${view}: overflow`,
        );
      };
      const bounds = async (selector) => {
        const value = await page.waitForFunction((s) => {
          const e = document.querySelector(s);
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return r.width && r.height ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
        }, selector);
        return value.jsonValue();
      };
      await go('review');
      await page.locator('#reviewList .review-item').first().click();
      await page.locator('#reviewDetail .lean-review-primary-actions').waitFor();
      const selected = () =>
        page
          .locator('#reviewList .review-item[aria-current="true"]')
          .getAttribute('data-review-id');
      const first = await selected();
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction(
        (id) =>
          document.querySelector('#reviewList .review-item[aria-current="true"]')?.dataset
            .reviewId !== id,
        first,
      );
      if (width === 390) {
        await page.locator('#reviewDetail').evaluate((e) => {
          const start = new Event('touchstart', { bubbles: true });
          Object.defineProperty(start, 'touches', { value: [{ clientX: 30, clientY: 200 }] });
          e.dispatchEvent(start);
          const end = new Event('touchend', { bubbles: true });
          Object.defineProperty(end, 'changedTouches', { value: [{ clientX: 240, clientY: 200 }] });
          e.dispatchEvent(end);
        });
      } else await page.keyboard.press('ArrowUp');
      await page.waitForFunction(
        (id) =>
          document.querySelector('#reviewList .review-item[aria-current="true"]')?.dataset
            .reviewId === id,
        first,
      );
      await page.locator('#reviewDetail .lean-review-primary-actions').waitFor();
      const actions = await bounds('#reviewDetail .lean-review-primary-actions');
      assert.ok(actions.y + actions.height <= height);
      if (width > 900) {
        assert.ok((await bounds('#reviewList')).y <= 260);
        await page.locator('#reviewFocusToggle').click();
        assert.ok(await page.locator('body').evaluate((e) => e.classList.contains('review-focus')));
        await page.keyboard.press('f');
        assert.equal(
          await page.locator('body').evaluate((e) => e.classList.contains('review-focus')),
          false,
        );
        await page.locator('#reviewSelectToggle').click();
        assert.equal(
          await page.locator('#reviewSelectToggle').getAttribute('aria-pressed'),
          'true',
        );
        await page.locator('#reviewSelectToggle').click();
        await page.locator('[data-review-tab="quick"]').click();
        await page.locator('#reviewSureOpen').waitFor();
        const sure = await bounds('#reviewSureOpen');
        assert.ok(
          sure.x + sure.width <= width && sure.y < 260,
          'sure action stays in the tabs row',
        );
      } else {
        const approval = await bounds('#approveReview');
        assert.ok(
          approval.y > 0 && approval.y + approval.height < (await bounds('.mobile-bottom-nav')).y,
        );
        assert.ok((await bounds('#reviewDetail .rv-head-side > a')).height >= 44);
      }
      await page.screenshot({ path: `${dir}/review-${width}-${theme}.png` });
      await go('catalog');
      if (width === 390) assert.ok((await bounds('#catalogList')).y <= 330);
      await page.locator('#catalogList [data-catalog-id]').first().click();
      await page.locator('#catalogDetail h3').first().waitFor();
      if (width === 390) {
        const title = await bounds('#catalogDetail h3');
        assert.ok(title.y > 0 && title.y + title.height < height);
      }
      await page.locator('#catalogDetail [data-edition-detail]').first().click();
      await page.locator('#backToWork').click();
      await page.locator('#catalogDetail [data-edition-detail]').first().waitFor();
      await page.screenshot({ path: `${dir}/catalog-detail-${width}-${theme}.png` });
      await go('offers');
      if (width > 900) {
        assert.equal(await page.locator('#offersTableBody tr').count(), 50);
        await page.locator('[data-offer-sort="price-asc"]').click();
        await page.waitForFunction(
          () => document.querySelector('#offerSort').value === 'price-asc',
        );
        await page.waitForFunction(
          () =>
            document
              .querySelector('[data-offer-sort="price-asc"]')
              .closest('th')
              .getAttribute('aria-sort') === 'ascending',
        );
        assert.equal(
          await page
            .locator('[data-offer-sort="price-asc"]')
            .locator('..')
            .getAttribute('aria-sort'),
          'ascending',
        );
        await page.locator('#offersTableBody tr').first().locator('td').nth(2).click();
      } else await page.locator('#offersMobileList [data-mobile-offer-id]').first().click();
      await page.locator('#offerDrawerContent .detail-actions').waitFor();
      const drawerActions = await bounds('#offerDrawerContent .detail-actions');
      assert.ok(drawerActions.y + drawerActions.height < height);
      await page.screenshot({ path: `${dir}/drawer-${width}-${theme}.png` });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#offerDrawer').isVisible(), false);
      await page.locator('[data-offer-layout="groups"]').click();
      await page.locator('.offer-group-head').first().waitFor();
      await page.locator('[data-offer-layout="list"]').click();
      await go('settings');
      const prefWidth = (await bounds('#prefTheme')).width;
      assert.ok(prefWidth <= 261);
      const advanced = await page.locator('.settings-grid > details').first().boundingBox();
      assert.ok(advanced.height < 100);
      if (width === 390) {
        assert.equal(await page.locator('.mobile-bottom-nav [data-view="sets"]').isVisible(), true);
        const labelOverflow = await page
          .locator('.mobile-bottom-nav')
          .evaluate((e) =>
            [
              ...e.querySelectorAll('.mobile-nav-item:not(.mobile-secondary) > span:last-child'),
            ].some((e) => e.scrollWidth > e.parentElement.clientWidth),
          );
        assert.equal(labelOverflow, false, 'navigation labels fit');
      }
      assert.deepEqual(errors, []);
      results.push({
        width,
        height,
        theme,
        actionsBottom: Math.round(actions.y + actions.height),
        settingsSelectWidth: Math.round(prefWidth),
        passed: true,
      });
      await page.close();
    }
} finally {
  await browser.close();
}
await writeFile(`${dir}/results.json`, JSON.stringify(results, null, 2) + '\n');
console.log(results);
