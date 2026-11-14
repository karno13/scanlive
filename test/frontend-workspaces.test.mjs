import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
const shellScript = await readFile(new URL('../app/app.js', import.meta.url), 'utf8');
const scannerScript = await readFile(new URL('../app/views/scanner.js', import.meta.url), 'utf8');
// Static coverage spans the shell and the scanner module after refactoring.
const reviewScript = await readFile(new URL('../app/views/review.js', import.meta.url), 'utf8');
const catalogScript = await readFile(new URL('../app/views/catalog.js', import.meta.url), 'utf8');
const offersScript = await readFile(new URL('../app/views/offers.js', import.meta.url), 'utf8');
const script = [shellScript, scannerScript, reviewScript, catalogScript, offersScript].join('\n');

// Stage 1 of the 11.2026 review: "Dziś" is the start view; the scan form is the "Skan" view.
test('desktop shell starts on Dziś and keeps every workspace in order', () => {
  const views = [...html.matchAll(/class="nav-item(?: active)?"[^>]+data-view="([^"]+)"/g)].map(
    (match) => match[1],
  );
  // Stage 2: "Kolejka" replaces "Do weryfikacji" and "Zestawy" (their screens are its tabs).
  assert.deepEqual(views, ['today', 'queue', 'catalog', 'offers', 'scanner', 'settings']);
  for (const id of ['view-review', 'view-sets', 'view-checks'])
    assert.match(html, new RegExp('id="' + id + '" data-title="Kolejka"'));
  assert.match(html, /class="view active" id="view-today" data-title="Dziś"/);
  assert.match(html, /class="view" id="view-scanner" data-title="Źródła" hidden/);
  assert.doesNotMatch(html, /data-view="history"/);
});

test('scanner state is module-owned and navigation does not recreate it', () => {
  const compact = script.replace(/\s+/g, '');
  for (const expression of [
    'scan:{running:false',
    'if(state.scan.running)return',
    'showView(button.dataset.view)',
    'readSearchStream',
  ])
    assert.ok(compact.includes(expression), expression);
});

test('frontend uses SQLite catalog APIs', () => {
  for (const endpoint of [
    '/api/sources',
    '/api/history',
    '/api/catalog/status',
    '/api/catalog/works',
    '/api/identification-jobs',
    '/api/offers',
    '/api/catalog/lookup-preview',
    '/api/catalog/lookup-confirm',
    '/api/catalog',
    '/api/search?stream=1',
  ])
    assert.ok(script.includes(endpoint));
  assert.match(script, /id="rejectReview"/);
  assert.doesNotMatch(script, /id="reviewRejectReason"/);
  assert.match(script, /decideReview\('excluded'/);
  assert.match(script, /state\.catalogPreview/);
});

test('review catalog picker filters by typed title or ISBN before selection', () => {
  assert.match(script, /id=\"reviewBookSearch\"/);
  assert.match(script, /renderReviewBookChoices\(event\.target\.value\)/);
  assert.match(script, /work\.title[\s\S]*edition\.identifiers/);
  assert.match(script, /dataset\.reviewEditionId/);
});

test('catalog loads beyond the first SQLite page without silent JSON substitution', () => {
  const compact = script.replace(/\s+/g, '');
  for (const expression of [
    'asyncfunctionloadCatalogPage(kind,{reset=false,pageNumber=null}={})',
    'newURLSearchParams({limit:String(limit),offset:String(offset)})',
    'INCOMPLETE_CATALOG_PAGE',
    'data-load-catalog-kind',
    'catalogPageSize=250',
    'CATALOG_CHANGED_DURING_PAGINATION',
    'functionallOffers(){returnstate.sqliteOffers;}',
    'NieudałosięwczytaćkataloguSQLite',
  ])
    assert.ok(compact.includes(expression), expression);
  assert.doesNotMatch(script, /CATALOG_PAGE_LIMIT_EXCEEDED|state\.sqliteOffers\.length\s*\?/);
});

test('book-centric UI exposes comparison and mobile offers without external images', () => {
  assert.match(script, /comparison-candidate/);
  assert.match(script, /reviewCandidateMarkup\(offer, suggested\)/);
  assert.match(script, /offersMobileList/);
  assert.match(script, /data-mobile-offer-id/);
  assert.match(html, /id="offersMobileList"/);
});

// Stage 1: "Nowe z ostatniego skanu" repeated the last-scan card; Dziś counts new offers and
// price changes once and opens Oferty with the same filters.
test('the scan view no longer repeats the last scan as a preview list', () => {
  assert.doesNotMatch(html, /id="scannerOfferList"|class="panel scanner-discover"/);
  assert.doesNotMatch(script, /function renderScannerOffers|function refreshScannerOffers/);
  assert.match(script, /async function openOffers\(filters = \{\}\)/);
  assert.match(
    script,
    /since: state\.offerSince \|\| '', priceChangedSince: state\.offerPriceSince \|\| ''/,
  );
  assert.match(html, /id="offerScope" hidden/);
});

test('review compares observed ISBN against candidate edition and warns on conflicts', () => {
  assert.match(script, /function normalizedIsbn\(value\)/);
  assert.match(script, /function reviewCandidateMarkup\(offer, suggested\)/);
  assert.match(script, /RÓŻNE ISBN — sprawdź wydanie/);
  assert.match(script, /Konflikt ISBN — wybierz wydanie ręcznie/);
  assert.match(script, /input\.dataset\.editionId = ''/);
});

test('desktop workspace preserves functional scanner controls and adds editorial shell', () => {
  for (const id of ['sourceGrid', 'startSearch', 'scanRun', 'scanRunSources'])
    assert.ok(html.includes('id=\"' + id + '\"'));
});

test('edition price statistics reflect saved asking prices without projecting ROI', () => {
  assert.match(script, /function offerPriceSummary\(offers = \[\]\)/);
  assert.match(script, /function priceStats\(prices\)/);
  assert.match(script, /sorted\.length % 2/);
  assert.match(script, /offerPriceSummaryMarkup\(row\.offers\)/);
  assert.match(script, /Nie są to ceny sprzedaży ani prognoza zysku/);
});
test('review requires explicit edition decision with bibliographic context', () => {
  assert.match(script, /Sprawdź ISBN/);
  assert.match(script, /Pozycja z katalogu/);
  assert.match(script, /id="approveReview"/);
});

test('offer drawer reports price observations without treating them as sales', () => {
  assert.match(script, /function priceEvidenceMarkup\(offer\)/);
  assert.match(script, /Obserwacje cen/);
  assert.match(script, /Minimum historyczne/);
  assert.match(script, /Mediana obserwacji/);
  assert.match(script, /Wielokrotne odczyty tej samej ceny nie są niezależnymi transakcjami/);
  assert.match(script, /priceEvidenceMarkup\(offer\)/);
});

test('resale simulator requires user costs and a manually assumed resale price', () => {
  assert.match(script, /function scenarioCalculatorMarkup\(offer\)/);
  assert.match(script, /function calculateScenario\(\)/);
  assert.match(script, /scenarioPurchase/);
  assert.match(script, /scenarioShipping/);
  assert.match(script, /scenarioOther/);
  assert.match(script, /scenarioResale/);
  assert.match(script, /Uzupełnij wszystkie pola/);
  assert.match(script, /Przed podatkiem, bez gwarancji sprzedaży/);
});

test('covers use ISBN checksum and show neutral spine until real image loads', () => {
  const compact = script.replace(/\s+/g, '');
  for (const expression of [
    'functionvalidCoverIsbn(value)',
    'functioncoverPreviewMarkup(identifiers=[])',
    'src="${isbnCover(isbn)}"',
    'naturalWidth>1',
  ])
    assert.ok(compact.includes(expression), expression);
});

// Stage 1: the live channel replaced the "Odśwież" button; a failed list read still says so.
test('no manual refresh: the live channel re-reads everything after a reconnection', () => {
  const compact = script.replace(/\s+/g, '');
  assert.doesNotMatch(html, /id="refreshView"/);
  assert.doesNotMatch(script, /refreshView/);
  for (const expression of [
    'asyncfunctionloadCatalogData({kinds=null}={})',
    'returnfalse;',
    'NieudałosięwczytaćkataloguSQLite',
    'onReconnect:()=>{voidloadCatalogStatus();',
    'if(loadedKinds.size)voidloadCatalogData();',
  ])
    assert.ok(compact.includes(expression), expression);
});

test('price evidence shares one numeric validator with edition summary', () => {
  const compact = script.replace(/\s+/g, '');
  for (const expression of [
    "returnpriceStats(offers.filter(item=>isPurchasable(item)&&(!item.currency||item.currency==='PLN')).map((item)=>item.currentPrice))",
    'conststats=priceStats(observations.map((item)=>item.price))',
    'Number.isFinite(value)&&value>=0',
  ])
    assert.ok(compact.includes(expression), expression);
  assert.doesNotMatch(script, /const first = prices\.length/);
});

test('catalog search sends debounced SQLite queries beyond loaded pages', () => {
  const compact = script.replace(/\s+/g, '');
  for (const kind of ['works', 'jobs', 'offers'])
    assert.ok(compact.includes("scheduleGlobalCatalogSearch('" + kind + "')"));
  for (const expression of [
    'for(const[key,value]ofObject.entries(filters))if(value)params.set(key,value)',
    'catalogAbortControllers.get(kind)?.abort()',
    'newURLSearchParams({limit:String(limit),offset:String(offset)})',
    'state.catalogPages[kind]={total:data.total,offset:offset+data.items.length,query,filters,}',
  ])
    assert.ok(compact.includes(expression), expression);
});

test('review and catalog DOM rendering is bounded despite loading many SQLite pages', () => {
  const compact = script.replace(/\s+/g, '');
  for (const expression of [
    'visibleRows:{works:100,jobs:100}',
    'functionvisibleCatalogRows(kind,rows)',
    'rows.slice(0,visible)',
    'state.visibleRows[kind]+=100',
    "visibleCatalogRows('works',rows).map((row)",
    'data-show-loaded-kind',
    // The review queue is paged on the server: 50 decisions at a time, more on demand.
    'constreviewPageSize=50',
    "view:'list'",
    'functionloadMoreReview()',
  ])
    assert.ok(compact.includes(expression), expression);
});

test('filter and sort controls query the full SQLite catalogue instead of only loaded rows', () => {
  const compact = script.replace(/\s+/g, '');
  for (const expression of [
    'functioncatalogFilters(kind)',
    'for(const[key,value]ofObject.entries(filters))if(value)params.set(key,value)',
    "page.filters||{query:page.query||''}",
  ])
    assert.ok(compact.includes(expression), expression);
  for (const kind of ['works', 'jobs', 'offers'])
    assert.ok(compact.includes("scheduleGlobalCatalogSearch('" + kind + "')"));
});

test('active navigation exposes current page to assistive technology', () => {
  assert.match(script, /button\.setAttribute\('aria-current', 'page'\)/);
  assert.match(script, /button\.removeAttribute\('aria-current'\)/);
  assert.match(html, /class="nav-list" aria-label="Główna nawigacja"/);
});
