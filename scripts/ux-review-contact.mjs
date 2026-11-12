import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const dir = `artifacts/ux-review/${process.argv[2]}`;
const views = (process.argv[3] || 'scanner,review,catalog,sets,offers,settings').split(',');
const browser = await chromium.launch();
try {
  for (const width of (process.argv[4] || '1440,390').split(',').map(Number)) {
    const tiles = [];
    for (const view of views)
      for (const theme of ['light', 'dark']) {
        const data = await readFile(`${dir}/${view}-${width}-${theme}.png`);
        tiles.push(
          `<figure><figcaption>${view} · ${theme}</figcaption><img src="data:image/png;base64,${data.toString('base64')}"></figure>`,
        );
      }
    const page = await browser.newPage({
      viewport: { width: width === 390 ? 1170 : 1440, height: 900 },
    });
    await page.setContent(
      `<style>body{margin:0;background:#ccc;display:grid;grid-template-columns:repeat(${width === 390 ? 6 : 3},1fr)}figure{margin:0}figcaption{font:16px system-ui;height:24px}img{display:block;width:100%}</style>${tiles.join('')}`,
    );
    await page.screenshot({ path: `${dir}/contact-${width}.png`, fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
}
