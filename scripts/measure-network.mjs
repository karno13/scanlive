// Network measurement of the UI on a running server (a copy of the data, see CLAUDE.md):
// requests and bytes at startup, after a tour through every view and after a plain reload.
//   node scripts/measure-network.mjs <port> <label> [--legacy]
// --legacy emulates the server before stage 0 of the 11.2026 review: no thumbnails, no gzip and no
// revalidation (thumb=1, Accept-Encoding and If-None-Match are stripped from the requests).
// Needs playwright (see CLAUDE.md). Writes artifacts/network/<label>.json.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { settle, trackRequests } from './page-settle.mjs';

const [port = '4399', label = 'run'] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const legacy = process.argv.includes('--legacy');
const base = `http://127.0.0.1:${port}`;
const views = (process.env.MEASURE_VIEWS || 'scanner,review,catalog,sets,offers,settings').split(
  ',',
);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.__inflight = trackRequests(page);
if (legacy)
  await page.route('**/*', (route) => {
    const request = route.request();
    const headers = { ...request.headers() };
    delete headers['accept-encoding'];
    delete headers['if-none-match'];
    const url = request.url().replace(/([?&])thumb=1(&|$)/, (_, lead, tail) => (tail ? lead : ''));
    return route.continue({ url, headers });
  });

let log = [];
page.on('requestfinished', async (request) => {
  const response = await request.response();
  const sizes = await request.sizes().catch(() => ({ responseBodySize: 0 }));
  // Chromium adds Accept-Encoding below the route layer: in legacy mode count the decoded body,
  // which is what the old server (no gzip) sent.
  if (legacy && response)
    sizes.responseBodySize = (await response.body().catch(() => Buffer.alloc(0))).length;
  const url = new URL(request.url());
  log.push({
    path: url.pathname + (url.pathname.startsWith('/api/') ? url.search : ''),
    status: response?.status() || 0,
    bytes: sizes.responseBodySize,
    kind: /^\/api\/(image|cover|offers\/[^/]+\/image)/.test(url.pathname)
      ? 'image'
      : url.pathname.startsWith('/api/')
        ? 'api'
        : 'static',
  });
});
const quiet = async () => {
  await settle(page);
  await page.waitForTimeout(1200);
  await settle(page);
};
const summary = (entries) => {
  const by = (kind) => entries.filter((entry) => entry.kind === kind);
  const sum = (list) => list.reduce((total, entry) => total + Math.max(0, entry.bytes), 0);
  return {
    requests: entries.length,
    apiRequests: by('api').length,
    apiBytes: sum(by('api')),
    staticRequests: by('static').length,
    staticBytes: sum(by('static')),
    imageRequests: by('image').length,
    imageBytes: sum(by('image')),
    images: by('image')
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 8)
      .map((entry) => `${entry.bytes} ${entry.path.slice(0, 120)}`),
    api: by('api').map((entry) => `${entry.status} ${entry.bytes} ${entry.path}`),
  };
};

const result = { label, legacy };
await page.goto(base + (process.env.MEASURE_START || '/'), { waitUntil: 'domcontentloaded' });
await quiet();
result.startup = summary(log);
log = [];
for (const view of views) {
  await page.evaluate(
    (name) => document.querySelector(`.sidebar [data-view="${name}"]`)?.click(),
    view,
  );
  await quiet();
  // Scroll the list so lazy thumbnails of the first screenful load.
  await page.mouse.wheel(0, 1200);
  await quiet();
}
result.tour = summary(log);
log = [];
await page.reload({ waitUntil: 'domcontentloaded' });
await quiet();
result.reload = summary(log);
await browser.close();
await mkdir('artifacts/network', { recursive: true });
await writeFile(`artifacts/network/${label}.json`, JSON.stringify(result, null, 2) + '\n');
const short = (part) => ({ ...part, api: undefined });
console.log(
  JSON.stringify(
    { startup: short(result.startup), tour: short(result.tour), reload: short(result.reload) },
    null,
    1,
  ),
);
