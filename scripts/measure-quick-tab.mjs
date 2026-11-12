// How many actions (clicks + key presses) it takes to settle the "Szybkie" review tab, on a server
// running against a COPY of the data (decisions are saved!).
//   node scripts/measure-quick-tab.mjs <port> single|dialog|batch
// single: offer by offer (Enter when an edition is preselected, else 1 then Enter, else S);
// dialog: the "Zatwierdź pewne…" list, then the rest offer by offer;
// batch:  the card grid of stage 2, then the rest offer by offer.
import { chromium } from 'playwright';
import { settle, trackRequests } from './page-settle.mjs';

const [port = '4401', mode = 'single'] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.__inflight = trackRequests(page);
let actions = 0;
const act = async (run) => {
  actions++;
  await run();
  await settle(page, { quietMs: 300 });
};
// Enter approves only when no ordinary button has focus (review.js keeps a focused button's own
// Enter): then the visible button is clicked instead — one action either way.
const approve = async () => {
  const onButton = await page.evaluate(() =>
    Boolean(document.activeElement?.closest?.('button:not(.rv-cand),a,summary')),
  );
  if (onButton)
    await act(() =>
      page
        .locator('#approveReview:not([hidden]), #createOfferEdition:not([hidden])')
        .first()
        .click(),
    );
  else await act(() => page.keyboard.press('Enter'));
};
const quickCount = () =>
  page.evaluate(() => {
    const tab = document.querySelector('[data-review-tab="quick"] span');
    return tab ? Number(tab.textContent) : 0;
  });
try {
  await page.goto(base + '/?view=review', { waitUntil: 'load' });
  await settle(page);
  const before = await quickCount();
  await act(() => page.locator('[data-review-tab="quick"]').click());
  if (mode === 'dialog') {
    await act(() => page.locator('#reviewSureOpen').click());
    await page.locator('[data-sure-apply]').waitFor();
    while (await page.locator('[data-sure-index]:not(:checked)').count())
      await act(() => page.locator('[data-sure-index]:not(:checked)').first().check());
    if (await page.locator('[data-sure-apply]:not([disabled])').count())
      await act(() => page.locator('[data-sure-apply]').click());
    await page.waitForTimeout(800);
  }
  if (mode === 'batch') {
    await page.locator('.rv-batch-card').first().waitFor({ timeout: 15000 });
    await act(() => page.keyboard.press('Enter'));
    await page.waitForTimeout(800);
    await settle(page);
  }
  let skipped = 0;
  for (let guard = 0; guard < 120; guard++) {
    const left = await page.locator('#reviewList .review-item').count();
    if (!left || skipped >= left) break;
    if (
      !(await page
        .locator('#reviewList .review-item.active, #reviewList .review-item[aria-current="true"]')
        .count())
    )
      await act(() => page.locator('#reviewList .review-item').nth(skipped).click());
    await page.waitForTimeout(400);
    await settle(page, { quietMs: 300 });
    if (await page.locator('#approveReview:not([disabled]):not([hidden])').count()) {
      await approve();
    } else if (await page.locator('#reviewProposals .rv-cand').count()) {
      await act(() => page.keyboard.press('1'));
      await page.waitForTimeout(600);
      await settle(page, { quietMs: 300 });
      if (await page.locator('#approveReview:not([disabled]):not([hidden])').count())
        await approve();
      else {
        await act(() => page.keyboard.press('s'));
        skipped++;
      }
    } else {
      await act(() => page.keyboard.press('s'));
      skipped++;
    }
    await page.waitForTimeout(300);
  }
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  const after = await quickCount();
  console.log(
    JSON.stringify({
      mode,
      before,
      after,
      settled: before - after,
      actions,
      leftUndecided: skipped,
    }),
  );
} finally {
  await browser.close();
}
