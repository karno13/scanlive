// Playwright's "networkidle" never comes while the page keeps its live event stream (/api/events)
// open. trackRequests() counts the page's other requests; settle() waits until none has been in
// flight for a moment.
const LONG_LIVED = /\/api\/events(?:$|\?)/;

export function trackRequests(page) {
  const inflight = new Set();
  const done = (request) => inflight.delete(request);
  page.on('request', (request) => {
    if (!LONG_LIVED.test(request.url())) inflight.add(request);
  });
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) inflight.clear();
  });
  return inflight;
}

/** Waits until no tracked request is running for `quietMs` (at most `timeoutMs`). */
export async function settle(page, { quietMs = 400, timeoutMs = 15_000 } = {}) {
  const inflight = page.__inflight || (page.__inflight = trackRequests(page));
  const start = Date.now();
  let quietSince = inflight.size ? 0 : Date.now();
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(100);
    if (inflight.size) quietSince = 0;
    else if (!quietSince) quietSince = Date.now();
    else if (Date.now() - quietSince >= quietMs) return;
  }
}

/** Opens a URL and waits for the page and its first requests. */
export async function gotoSettled(page, url) {
  page.__inflight ||= trackRequests(page);
  await page.goto(url, { waitUntil: 'load' });
  await settle(page);
}
