import { installDetailNavigation, openDetailView } from './core/detail-navigation.js';
import { hasUnsavedChanges, confirmDiscard, statusLabel } from './core/ux.js';
import { viewFromSearch, idFromSearch, urlForView, shouldPush } from './core/view-history.js';
import { identificationProgress } from './core/identification-progress.js';
import { installTradingControls } from './views/trading-controls.js';
import { installDashboard } from './views/dashboard.js';
import { installTodayView } from './views/today.js';
import { connectLive } from './core/live.js';
import { installQueue, QUEUE_TYPES, QUEUE_VIEWS } from './views/queue.js';
import { mountRuleSettings } from './views/reject-rule.js';
import { installSources } from './views/sources.js';
import { createScanRun } from './views/scan-run.js';
import { installScanProfiles } from './views/scan-profiles.js';
import { createScanInsights } from './views/scan-insights.js';
import { createSetsView } from './views/sets.js';
import { createReviewView } from './views/review.js';
import { createCatalogView } from './views/catalog.js';
import { mountDuplicates } from './views/duplicates.js';
import { mountCatalogNames } from './views/catalog-names.js';
import { mountCatalogSeeds } from './views/catalog-seeds.js';
import { mountTitleConflicts } from './views/title-conflicts.js';
import { mountScanSchedule } from './views/scan-schedule.js';
import { createOffersView } from './views/offers.js';
import { json } from './core/api.js';
import { escapeHtml, money, date, dateMarkup, shortTime, sourceHealthNote } from './core/formatters.js';
import { createSettingsView } from './views/settings.js';
import { createScannerView } from './views/scanner.js';
import { requestScanCancellation } from './views/scanner.js';
import { readSavedSearch, validateCatalogPage } from './frontend-utils.js';
import { installCoverFallback, coverMarkup, tidyOfferTitle } from './core/bibliography.js';
import { installPreferences } from './core/preferences.js';
import { installCommandPalette } from './views/palette.js';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  activeView: 'today',
  sources: [],
  history: null,
  catalog: null,
  catalogWorks: [],
  reviewJobs: [],
  sqliteOffers: [],
  scannerOffers: [],
  scannerTotal: 0,
  reviewDetail: null,
  catalogMode: 'manual',
  catalogPreview: null,
  catalogReturnToReview: null,
  reviewPendingEdition: null,
  scan: {
    running: false,
    startedAt: null,
    timer: null,
    total: 0,
    completed: 0,
    rows: new Map(),
    result: null,
    fingerprint: null,
    lastStart: 0,
  },
  selectedReviewId: null,
  selectedCatalogId: null,
  offerView: 'all',
  reviewScan: '',
  scanRuns: [],
  offerPage: 1,
  pageSize: matchMedia('(min-width: 901px)').matches ? 50 : 25,
  catalogPages: {
    works: { total: 0, offset: 0 },
    jobs: { total: 0, offset: 0 },
    offers: { total: 0, offset: 0 },
  },
  visibleRows: { works: 100, jobs: 100 },
};
// Any code that changes the selected item (clicks, auto-advance after a decision, restore) updates the address.
for (const key of ['selectedReviewId', 'selectedCatalogId']) {
  let value = state[key];
  Object.defineProperty(state, key, { enumerable: true, configurable: true, get: () => value, set: (next) => { value = next; queueMicrotask(syncItemUrl); } });
}

const savedSearch = readSavedSearch(localStorage);
$('#queries').value = savedSearch?.queries?.join('\n') || '';

function toast(message, action = null) {
  const node = document.createElement('div');
  node.className = 'toast';
  const copy = document.createElement('span');
  copy.textContent = message;
  node.append(copy);
  if (action?.label && typeof action.onClick === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { await action.onClick(); node.remove(); }
      catch (error) { button.disabled = false; action.onError?.(error); }
    });
    node.append(button);
  }
  $('#toastRegion').append(node);
  setTimeout(() => node.remove(), action ? 8000 : 4200);
}
function selectedSources() {
  return $$('#sourceGrid input:checked').map((input) => input.value);
}
function readQueries() {
  return [
    ...new Set(
      $('#queries')
        .value.split(/\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}
function bookFor(id) {
  return (state.history?.books || []).find((row) => row.book.id === id)?.book || null;
}
function allOffers() {
  return state.sqliteOffers;
}
function reviewOffers() {
  return state.reviewJobs;
}
// Keeps ?id= in the address equal to the item selected in the active list/detail view.
// Disabled until the startup restore has finished so a deep link is not wiped by early renders.
let itemUrlReady = false;
function selectedItemId(view) {
  if (view === 'catalog') return state.selectedCatalogId;
  if (view === 'review') return state.selectedReviewId;
  if (view === 'sets') return setsView.activeId();
  return null;
}
function syncItemUrl() {
  if (!itemUrlReady) return;
  const view = state.activeView;
  const target = urlForView(view, selectedItemId(view));
  if (location.pathname + location.search !== target) history.replaceState(history.state, '', target);
}
// Opens the item named in the URL once its data is available. Unknown ids are ignored.
// The offer drawer marks a listing as a set and opens it in the sets workspace.
document.addEventListener('bookflip-open-set', (event) => {
  if (showView('sets') === false) return;
  void restoreItem('sets', event.detail.offerId);
});
async function restoreItem(view, id) {
  if (!id) return;
  try {
    if (view === 'catalog') await catalogView.openCatalogDetail(id, { fromHistory: true });
    else if (view === 'review') { state.selectedReviewId = id; renderReview(); openDetailView('review'); }
    else if (view === 'sets') { await setsView.refreshSets(id); openDetailView('sets'); }
  } catch (error) { toast(error.message); }
}

let firstViewRender = true;
// Returns true when the view was switched, false when the user kept unsaved changes.
// options.fromHistory: called by popstate, the URL is already correct and must not be touched.
const viewScroll = new Map();
function showView(name, options = {}) {
  // "Kolejka" opens the queue type used last (review, sets or one of the catalogue checks).
  if (name === 'queue') name = QUEUE_TYPES.find((type) => type.id === state.queueType)?.view || 'review';
  if (!['today', 'scanner', 'review', 'checks', 'catalog', 'sets', 'offers', 'settings'].includes(name)) name = 'today';
  if (hasUnsavedChanges()) {
    // Ask without blocking the page; the switch continues only after the user agrees.
    void confirmDiscard().then((ok) => { if (ok) showView(name, options); });
    return false;
  }
  // Each tab keeps its own scroll position: a new tab opens at its top, not halfway down the
  // previous tab's list; coming back to a tab returns to where it was left.
  const previous = state.activeView;
  if (previous && previous !== name) viewScroll.set(previous, window.scrollY);
  state.activeView = name;
  $$('.view').forEach((view) => {
    view.hidden = view.id !== `view-${name}`;
    view.classList.toggle('active', !view.hidden);
  });
  if (previous !== name) window.scrollTo({ top: viewScroll.get(name) || 0, behavior: 'instant' });
  const navName = QUEUE_VIEWS.includes(name) ? 'queue' : name;
  $$('.nav-item, .mobile-nav-item').forEach((button) => {
    const active = button.dataset.view === navName;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#viewTitle').textContent = $(`#view-${name}`).dataset.title;
  for (const [view, id] of [['today', 'todaySince'], ['scanner', 'scanStateBadge'], ['review', 'reviewCount'], ['sets', 'setTotal'], ['offers', 'offerTotal']]) {
    const badge = document.getElementById(id);
    if (badge) { badge.hidden = view !== name; $('#viewSummary').append(badge); }
  }
  if (!options.fromHistory) {
    const current = location.pathname + location.search;
    // Reloading or re-entering the same view keeps the selected item in the address.
    const sameView = viewFromSearch(location.search) === name;
    const keepId = sameView ? idFromSearch(location.search) : null;
    if (shouldPush(current, name, firstViewRender)) history.pushState({ view: name }, '', urlForView(name));
    else history.replaceState({ view: name }, '', urlForView(name, keepId));
  }
  firstViewRender = false;
  void ensureViewData(name);
  queue?.attach(name);
  if (name === 'today') {
    void todayView?.refresh();
    refreshWorkflowDashboard?.();
  }
  if (name === 'scanner') { void scanRun?.refresh(); void sourcesView?.refresh(); }
  if (name === 'review') { renderReview(); void tradingControls?.refreshDecisions(); }
  if (name === 'catalog') renderCatalog();
  if (name === 'offers') renderOffers();
  if (name === 'settings') { renderSettings(); void tradingControls?.refreshSettings(); void ruleSettings?.refresh(); }
  if (name === 'sets') void setsView.refreshSets().catch(error => toast(error.message));
  return true;
}

// Browser back/forward between workspaces. Unsaved changes can veto the move; in that case the
// URL is restored so the address bar keeps matching what is on screen.
window.addEventListener('popstate', () => {
  const target = viewFromSearch(location.search);
  if (target === state.activeView) {
    if (target === 'catalog') {
      const id = idFromSearch(location.search);
      if (id && id !== state.selectedCatalogId) void catalogView.openCatalogDetail(id, { fromHistory: true });
      else if (!id) catalogView.closeBookPage({ fromHistory: true });
    }
    return;
  }
  if (hasUnsavedChanges()) {
    history.pushState({ view: state.activeView }, '', urlForView(state.activeView));
    void confirmDiscard().then((ok) => { if (ok) showView(target); });
    return;
  }
  showView(target, { fromHistory: true });
  void restoreItem(target, idFromSearch(location.search));
});

// First visit of a view reads what it shows (lists, the brief history the lists need, the
// catalogue tools); later visits reuse it and the regular refreshes keep it current.
const viewDataRequests = new Map();
function ensureViewData(name) {
  if (viewDataRequests.has(name)) return viewDataRequests.get(name);
  const tasks = [];
  if (['review', 'catalog', 'offers'].includes(name) && !state.history && !historyRequest) tasks.push(loadHistory());
  const kind = viewKinds[name];
  if (kind && !loadedKinds.has(kind)) tasks.push(loadCatalogData({ kinds: [kind] }));
  if (name === 'catalog' || name === 'checks') mountCatalogTools();
  if (['scanner', 'offers', 'review'].includes(name)) tasks.push(ensureScanRuns());
  const request = Promise.all(tasks).catch((error) => {
    viewDataRequests.delete(name);
    toast('Nie udało się wczytać danych widoku: ' + error.message);
  });
  viewDataRequests.set(name, request);
  return request;
}

// The scan list (/api/scan-runs: Oferty scan filter, the scan result card) is read once, when a
// view that uses it opens; a finished scan reads it again (trading-controls.js).
let scanRunsRequest = null;
function ensureScanRuns() {
  scanRunsRequest ||= tradingControls.refreshRuns().catch((error) => {
    scanRunsRequest = null;
    throw error;
  });
  return scanRunsRequest;
}

// Opens Oferty with the filters of a "Dziś" tile: since a moment, price changed since, one scan
// (new / price changes), one source. Every other filter is cleared so the list matches the count.
async function openOffers(filters = {}) {
  if (filters.scan) await ensureScanRuns().catch(() => {});
  $('#offerSearch').value = '';
  $('#offerStatus').value = '';
  $('#offerSource').value = filters.source || '';
  $('#offerMinPrice').value = '';
  $('#offerMaxPrice').value = '';
  const scan = $('#offerScan');
  if (filters.scan && ![...scan.options].some((option) => option.value === filters.scan)) {
    const option = document.createElement('option');
    option.value = filters.scan;
    option.textContent = new Date(filters.scan).toLocaleString('pl-PL');
    scan.append(option);
  }
  scan.value = filters.scan || '';
  $('#offerScanChange').value = filters.scanChange || '';
  $('#offerSort').value = filters.sort || 'newest';
  state.offerSince = filters.since || '';
  state.offerPriceSince = filters.priceChangedSince || '';
  state.offerPage = 1;
  renderOfferScope();
  if (!showView('offers')) return;
  if (loadedKinds.has('offers')) scheduleGlobalCatalogSearch('offers');
}
// The filters a "Dziś" tile sets are said in one chip above the list (the scan filter sits in a
// folded section, the "since" filters have no field at all); its ✕ clears them.
function renderOfferScope() {
  const chip = $('#offerScope');
  if (!chip) return;
  const at = (value) => new Date(value).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  const scan = $('#offerScan').value;
  const change = $('#offerScanChange').value;
  const text = state.offerSince
    ? 'Nowe od ' + at(state.offerSince)
    : state.offerPriceSince
      ? 'Zmiana ceny od ' + at(state.offerPriceSince)
      : scan
        ? (change === 'new' ? 'Nowe w skanie ' : change === 'price' ? 'Zmiany cen w skanie ' : 'Skan ') + at(scan)
        : '';
  chip.hidden = !text;
  chip.querySelector('span').textContent = text;
}
$('#offerScope')?.querySelector('button')?.addEventListener('click', () => {
  state.offerSince = '';
  state.offerPriceSince = '';
  $('#offerScan').value = '';
  $('#offerScanChange').value = '';
  renderOfferScope();
  scheduleGlobalCatalogSearch('offers');
});
for (const selector of ['#offerScan', '#offerScanChange']) $(selector)?.addEventListener('change', renderOfferScope);

const daysAgo = (value) => {
  // Calendar days: yesterday 20:30 is "wczoraj" this morning, not "dziś".
  const midnight = (time) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(Date.now()) - midnight(Date.parse(value))) / 86_400_000);
  return days <= 0 ? 'dziś' : days === 1 ? 'wczoraj' : days + ' dni temu';
};
// "Tylko polskie wydania": stored on the server, so scheduled and phone scans follow it too.
void json('/api/scan-language').then((data) => { $('#scanPolishOnly').checked = data.polishOnly !== false; }).catch(() => {});
$('#scanPolishOnly')?.addEventListener('change', async (event) => {
  const polishOnly = event.target.checked;
  try {
    const result = await json('/api/scan-language', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ polishOnly }) });
    toast(polishOnly
      ? 'Tylko polskie wydania' + (result.rejected ? ` — odrzucono ${result.rejected} obcojęzycznych z weryfikacji.` : '.')
      : 'Skan zachowa też wydania obcojęzyczne.');
    if (result.rejected) void reloadReview();
  } catch {
    event.target.checked = !polishOnly;
    toast('Nie udało się zapisać ustawienia języka.');
  }
});

async function loadSources() {
  const [data, health] = await Promise.all([json('/api/sources'), json('/api/source-health').catch(() => ({ items: [] }))]);
  state.sources = data.sources || [];
  const blocked = data.blocked || {};
  // Allegro and OLX: no legal access (docs/SOURCES-ACCESS-2026-11.md) — not in the form, not red.
  const noAccess = data.noAccess || {};
  const scannable = (source) => !Object.hasOwn(noAccess, source);
  const row = (source) => health.items?.find((item) => item.source === source);
  const healthNote = (source) => sourceHealthNote(row(source), { short: true });
  const blockLabel = (code) => (code === 'SOURCE_CAPTCHA' ? 'blokuje odczyt (CAPTCHA)' : 'blokuje odczyt (HTTP 403)');
  const isDead = (source) => Boolean(blocked[source]) || healthNote(source) === 'nie działa';
  state.deadSources = new Set(state.sources.filter((source) => scannable(source) && isDead(source)));
  // When it last worked: tells "blocked for an hour" apart from "has not worked for a week".
  const lastWorked = (source) => (row(source)?.last_success_at ? 'ostatnio działał ' + daysAgo(row(source).last_success_at) : 'nigdy nie zadziałał');
  const note = (source) =>
    blocked[source] ? blockLabel(blocked[source]) + ' · ' + lastWorked(source) : isDead(source) ? lastWorked(source) : healthNote(source);
  // Sources that refused the last scan start unchecked, also when the previous search had them on.
  const wanted = (savedSearch?.sources || state.sources).filter(scannable);
  state.autoUnchecked = (savedSearch?.sources || []).filter((source) => state.sources.includes(source) && scannable(source) && isDead(source));
  const chosen = new Set(wanted.filter((source) => !isDead(source)));
  // Sources are toggle chips; the dot tells working (green), partly failing (amber) and dead (red).
  const tone = (source) => (isDead(source) ? 'dead' : healthNote(source) ? 'partial' : 'ok');
  const option = (source) =>
    `<label class="source-option is-${tone(source)}" title="${escapeHtml(note(source) || 'Działał w ostatnim skanie')}"><input type="checkbox" value="${escapeHtml(source)}" ${chosen.has(source) ? 'checked' : ''}><i class="source-dot-state" aria-hidden="true"></i><span>${escapeHtml(source)}</span>${tone(source) === 'ok' ? '' : '<small class="sr-only">' + escapeHtml(note(source)) + '</small>'}</label>`;
  const working = state.sources.filter((source) => scannable(source) && !isDead(source));
  const dead = state.sources.filter((source) => scannable(source) && isDead(source));
  const noAccessNames = state.sources.filter((source) => !scannable(source));
  // One sentence for all dead sources instead of a note under each.
  const byNote = new Map();
  for (const source of dead) byNote.set(lastWorked(source), [...(byNote.get(lastWorked(source)) || []), source]);
  const deadNote = dead.length
    ? '<p class="source-dead-note"><i class="source-dot-state" aria-hidden="true"></i> Nie działały w ostatnim skanie: ' +
      [...byNote].map(([text, names]) => '<b>' + escapeHtml(names.join(', ')) + '</b> (' + escapeHtml(text) + ')').join(', ') +
      '. Zaznacz, jeśli chcesz spróbować.</p>'
    : '';
  // Sources that do not work (CAPTCHA, 403) are folded away under "Niedostępne", not shown next
  // to the working ones; still in #sourceGrid, so profiles and "Zaznacz wszystkie" reach them.
  const unavailable = dead.length
    ? `<details class="source-unavailable"${dead.some((source) => chosen.has(source)) ? ' open' : ''}><summary>Niedostępne (${dead.length}): ${escapeHtml(dead.join(', '))}</summary><div class="source-unavailable-body">${dead.map(option).join('')}${deadNote}</div></details>`
    : '';
  const noAccessNote = noAccessNames.length
    ? `<p class="source-noaccess-note">Bez legalnego dostępu, nie są skanowane: <b>${escapeHtml(noAccessNames.join(', '))}</b>.</p>`
    : '';
  $('#sourceGrid').innerHTML = working.map(option).join('') + unavailable + noAccessNote || '<span class="loading-copy">Brak aktywnych adapterów.</span>';
  $('#sourceDeadNote').hidden = true;
  $('#settingsSources').innerHTML = state.sources
    // Same text as Ustawienia's own refresh (it may run first when the page opens on Ustawienia).
    .map((source) => `<span><b>${escapeHtml(source)}</b><small>${escapeHtml(sourceHealthNote(row(source)))}</small></span>`)
    .join('');
  fillSourceFilters();
  updateScanPlan();
}

const polishPlural = (n, one, few, many) => (n === 1 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);
// Before the scan: how big it is, how long it should take and what will not work.
function updateScanPlan() {
  const plan = $('#scanPlan');
  if (!plan) return;
  const queries = readQueries();
  const sources = selectedSources();
  const parts = [];
  if (queries.length > 10) parts.push(`<b class="is-warn">${queries.length} fraz — maksymalnie 10</b>`);
  if (queries.length && sources.length) {
    const tasks = queries.length * sources.length;
    const perTask = scanRun?.secondsPerTask?.();
    const minutes = perTask ? Math.max(1, Math.round((tasks * perTask) / 60)) : null;
    parts.push(`<b>${tasks} ${polishPlural(tasks, 'zapytanie', 'zapytania', 'zapytań')}</b><span class="scan-plan-detail">${queries.length} ${polishPlural(queries.length, 'fraza', 'frazy', 'fraz')} × ${sources.length} ${polishPlural(sources.length, 'źródło', 'źródła', 'źródeł')}${minutes ? ' · ok. ' + minutes + ' min' : ''}</span>`);
  }
  const dead = sources.filter((source) => state.deadSources?.has(source));
  if (dead.length) parts.push(`<span class="is-warn">${escapeHtml(dead.join(', '))} nie ${dead.length === 1 ? 'działało' : 'działały'} w ostatnim skanie</span>`);
  if (!queries.length) parts.push('<span class="scan-plan-detail">Wpisz frazy albo wybierz profil.</span>');
  else if (!sources.length) parts.push('<span class="is-warn">Zaznacz przynajmniej jedno źródło.</span>');
  plan.innerHTML = parts.join(' ');
}

function fillSourceFilters() {
  const options = state.sources
    .map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(source)}</option>`)
    .join('');
  for (const selector of ['#reviewSource', '#offerSource']) {
    const select = $(selector);
    const value = select.value;
    select.innerHTML = `<option value="">Wszystkie źródła</option>${options}`;
    select.value = value;
  }
}

let historyRequest = null;
async function loadHistory() {
  historyRequest = json('/api/history/brief');
  try {
    state.history = await historyRequest;
  } finally {
    historyRequest = null;
  }
  $('#reviewNavCount').textContent = `${state.reviewQueueDecisions ?? state.catalog?.reviewQueue?.decisions ?? state.catalogPages.jobs.total} do decyzji`;
  renderReview();
  renderCatalog();
  renderOffers();
}
// API pages are limited to 250 rows. Read subsequent pages rather than silently
// hiding catalog records after the first page. A larger dataset needs server-side UX.
const catalogSources = {
  works: { endpoint: '/api/catalog/works', stateKey: 'catalogWorks', view: 'catalog' },
  jobs: { endpoint: '/api/identification-jobs', stateKey: 'reviewJobs', view: 'review' },
  offers: { endpoint: '/api/offers', stateKey: 'sqliteOffers', view: 'offers' },
};
const catalogPageSize = 250;
const reviewPageSize = 50;
const loadingCatalogPages = new Set();
const catalogAbortControllers = new Map();
const catalogSearchTimers = new Map();
const catalogSearchInputs = {
  works: '#catalogSearch',
  jobs: '#reviewSearch',
  offers: '#offerSearch',
};
function catalogQuery(kind) {
  return $(catalogSearchInputs[kind])?.value?.trim() || '';
}
function catalogFilters(kind) {
  const query = catalogQuery(kind);
  if (kind === 'works') return { query, sort: $('#catalogSort').value, language:$('#catalogLanguage').value.trim(),publisher:$('#catalogPublisher').value.trim(),year:$('#catalogYear').value,binding:$('#catalogBinding').value.trim(),gap:state.catalogGap||'' };
  if (kind === 'jobs')
    return {
      query,
      source: $('#reviewSource').value,
      scan: state.reviewScan,
      isbn: $('#reviewIsbn').value,
      status:'review_required',
      view: 'list',
      offerId:state.reviewOffer || '',
      sort: $('#reviewSort').value,
      bucket: state.reviewBucket || '',
    };
  return {
    query,
    source: $('#offerSource').value,
    status: $('#offerStatus').value,
    watched:state.offerView==='watched'?'1':'',target:state.offerView==='target'?'1':'',
    purchaseStatus:['check','negotiating','bought','rejected'].includes(state.offerView)?state.offerView:'',
    scan:$('#offerScan').value,scanChange:$('#offerScanChange').value,
    minPrice:$('#offerMinPrice').value,maxPrice:$('#offerMaxPrice').value,
    since: state.offerSince || '', priceChangedSince: state.offerPriceSince || '',
    sort: $('#offerSort').value,
  };
}

// Fetch one page at a time. A large catalog must not block the UI by
// attempting to download every row on startup.
async function loadCatalogPage(kind, { reset = false, pageNumber = null } = {}) {
  const source = catalogSources[kind];
  if (!source) return false;
  if (reset) catalogAbortControllers.get(kind)?.abort();
  else if (loadingCatalogPages.has(kind)) return false;
  const page = state.catalogPages[kind];
  if (!reset && pageNumber === null && page.offset >= page.total) return false;
  loadingCatalogPages.add(kind);
  const controller = new AbortController();
  catalogAbortControllers.set(kind, controller);
  updateCatalogLoadControls();
  try {
    // The review queue comes in pages of 50 decisions. Reloading with unchanged filters (after a
    // decision) keeps as many rows as were loaded, so the next offer is the one under the decided.
    const sameFilters = reset && kind === 'jobs' && JSON.stringify(catalogFilters(kind)) === JSON.stringify(page.filters || null);
    const limit = kind === 'offers' ? state.pageSize : kind === 'jobs' ? (sameFilters ? Math.min(250, Math.max(reviewPageSize, state.reviewJobs.length)) : reviewPageSize) : catalogPageSize;
    const requestedPage = pageNumber ?? (reset ? 1 : state.offerPage + 1);
    let offset = kind === 'offers' ? (requestedPage - 1) * limit : reset ? 0 : page.offset;
    const filters = reset ? catalogFilters(kind) : page.filters || { query: page.query || '' };
    const query = filters.query;
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    const response = await fetch(`${source.endpoint}?${params}`, { signal: controller.signal });
    let data = await response.json();
    if (!response.ok) throw Error(data.error || `HTTP_${response.status}`);
    if (controller.signal.aborted) return false;
    if (kind === 'offers' && offset >= data.total && offset > 0) {
      offset = Math.max(0,Math.ceil(data.total/limit)-1)*limit;
      params.set('offset',String(offset));
      data=await json(source.endpoint+'?'+params);
    }
    validateCatalogPage(data, limit, offset);
    // The review queue changes all the time during a scan (offers are saved per phrase and
    // decided by the resolver): take the new total and skip rows already loaded.
    if (!reset && kind !== 'offers' && kind !== 'jobs' && data.total !== page.total) throw Error('CATALOG_CHANGED_DURING_PAGINATION');
    if (data.items.length === 0 && offset < data.total && !(kind === 'jobs' && !reset)) throw Error('INCOMPLETE_CATALOG_PAGE');
    if (kind === 'jobs') {
      state.reviewBuckets = data.buckets || null;
      // The menu counts the whole queue, not the open tab or search.
      state.reviewQueueTotal = data.queueTotal ?? data.total;
      state.reviewQueueDecisions = data.queueDecisions ?? data.total;
      state.reviewOffersTotal = data.offersTotal ?? data.total;
      state.reviewGroupSizes = data.groupSizes || null;
      state.reviewSkippedCount = data.skippedCount || 0;
      if (reset) state.skippedReviewIds?.clear();
    }
    if (reset || kind === 'offers') {
      state[source.stateKey] = data.items;
      if (kind === 'works' || kind === 'jobs') state.visibleRows[kind] = 100;
    } else {
      const known = new Set(state[source.stateKey].map((row) => row.id));
      state[source.stateKey] = [...state[source.stateKey], ...data.items.filter((row) => !known.has(row.id))];
    }
    if (kind === 'offers') state.offerPage = Math.floor(offset / limit) + 1;
    state.catalogPages[kind] = {
      total: data.total,
      offset: offset + data.items.length,
      query,
      filters,
    };
    updateCatalogLoadControls();
    return true;
  } finally {
    if (catalogAbortControllers.get(kind) === controller) {
      loadingCatalogPages.delete(kind);
      catalogAbortControllers.delete(kind);
      updateCatalogLoadControls();
    }
  }
}

/** Every remaining page (bounded), e.g. before "select all" in the review queue. */
async function loadAllCatalogPages(kind, { maxPages = 40 } = {}) {
  for (let page = 0; page < maxPages; page++) {
    const state_ = state.catalogPages[kind];
    if (state_.offset >= state_.total) return true;
    const before = state_.offset;
    if (!(await loadCatalogPage(kind))) return false;
    if (state.catalogPages[kind].offset <= before) return false;
  }
  return false;
}

function scheduleGlobalCatalogSearch(kind) {
  clearTimeout(catalogSearchTimers.get(kind));
  const timer = setTimeout(async () => {
    try {
      if(kind==='offers') state.offerPage=1;
      const changed = await loadCatalogPage(kind, { reset: true });
      if (changed) {
        if (kind === 'works') renderCatalog();
        if (kind === 'jobs') renderReview();
        if (kind === 'offers') {
          state.offerPage = 1;
          renderOffers();
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') toast('Wyszukiwanie SQLite: ' + error.message);
    }
  }, 350);
  catalogSearchTimers.set(kind, timer);
}

function updateCatalogLoadControls() {
  for (const [kind, source] of Object.entries(catalogSources)) {
    const view = document.querySelector('#view-' + source.view);
    if (!view) continue;
    // No page-level "load more" button: the review list loads more as it is scrolled, the
    // catalogue list has one button at its end (visibleCatalogRows in views/review.js) and
    // offers are paged. Remove a control left by an older page version.
    view.querySelector('[data-load-catalog-kind="' + kind + '"]')?.remove();
  }
}

// List data is read when its view is first opened, not at startup; afterwards a refresh reloads
// the lists already read plus the open view's. Navigation counts come from /api/catalog/status.
const viewKinds = { catalog: 'works', review: 'jobs', offers: 'offers' };
const loadedKinds = new Set();
async function loadCatalogData({ kinds = null } = {}) {
  const wanted = kinds || [...new Set([...loadedKinds, viewKinds[state.activeView]].filter(Boolean))];
  if (!wanted.length) return true;
  try {
    const loaded = await Promise.all(
      wanted.map((kind) => loadCatalogPage(kind, { reset: true, ...(kind === 'offers' ? { pageNumber: state.offerPage } : {}) })),
    );
    for (const kind of wanted) loadedKinds.add(kind);
    if (loaded.some((value) => value !== true)) throw Error('CATALOG_PAGE_LOAD_IN_PROGRESS');
    $('#reviewNavCount').textContent = `${state.reviewQueueDecisions ?? state.catalog?.reviewQueue?.decisions ?? state.catalogPages.jobs.total} do decyzji`;
    renderReview();
    renderCatalog();
    renderOffers();
    updateCatalogLoadControls();
    return true;
  } catch (error) {
    $('#connectionLabel').textContent = 'Błąd odczytu katalogu';
    toast(`Nie udało się wczytać katalogu SQLite: ${error.message}`);
    return false;
  }
}

async function loadCatalogStatus() {
  try {
    state.catalog = await json('/api/catalog/status');
    if (state.catalog.reviewQueue) {
      state.reviewQueueDecisions = state.catalog.reviewQueue.decisions;
      state.reviewQueueTotal = state.catalog.reviewQueue.offers;
    }
    scanInsights.refreshIsbn(state.catalog);
    const counts = state.catalog.counts || {};
    // One offer count everywhere: saved offers without the ones rejected in review (the Oferty
    // list hides those too). It does not follow the Oferty filters.
    const rejected = Number(counts.offers_rejected || 0);
    const saved = Math.max(0, Number(counts.offers || 0) - rejected);
    const breakdown = `Zapisane oferty: ${saved}. Odrzucone w weryfikacji: ${rejected} (nie ma ich na listach). Razem w bazie: ${counts.offers || 0}.`;
    $('#offersNavCount').textContent = `${saved} zapisanych`;
    // The queue count is right from the start, before the queue list is read.
    $('#reviewNavCount').textContent = `${state.reviewQueueDecisions ?? 0} do decyzji`;
    $('#offersNavCount').title = breakdown;
    $('#catalogWorks').textContent = counts.works || 0;
    $('#catalogEditions').textContent = counts.editions || 0;
    const identification = state.catalog.identification || {};
    const run = identification.run;
    const runHasTasks = Object.values(run?.statuses || {}).some((value) => Number(value) > 0);
    const scope = runHasTasks ? run : identification;
    const statuses = scope.statuses || {};
    const progress=identificationProgress(statuses);
    const {total,processed,percent}=progress;
    $('#identificationProgressScope').textContent = runHasTasks ? 'Bieżące uruchomienie' : 'Wszystkie zapisane zadania';
    $('#identificationProgressBar').value = percent;
    $('#identificationProgressLabel').textContent = total
      ? `${percent}% · ${processed} / ${total}` : 'Brak zadań';
    $('#identificationProgressDetails').textContent =
      `W kolejce: ${Number(statuses.queued || 0)} · Przetwarzane: ${Number(statuses.running || 0)} · Ponawiane: ${Number(statuses.retry_wait || 0)} · Do weryfikacji: ${Number(statuses.review_required || 0)} · Błędy: ${Number(statuses.failed || 0)}`;

    const scheduler = state.catalog.scheduler || {};
    const running = scheduler.running === true;
    const active = scheduler.active === true;
    const paused = scheduler.paused === true;
    const decisions = scope.decisions || {};
    const unresolved = Number(identification.statuses?.review_required || 0) +
      Number(identification.statuses?.failed || 0) + Number(identification.decisions?.not_found || 0);
    $('#identificationStart').disabled = scheduler.available === false || active ||
      (running && progress.pending > 0) || identificationControlPending;
    $('#identificationStart').textContent = !progress.pending && unresolved ? 'Uruchom ponownie' : 'Start';
    $('#identificationStop').disabled = scheduler.available === false || paused ||
      (!active && progress.pending === 0) || identificationControlPending;
    $('#identificationRunState').textContent = scheduler.available === false
      ? 'Sterowanie niedostępne'
      : scheduler.stopping ? 'Zatrzymywanie — kończę rozpoczętą partię'
      : active ? 'Identyfikacja w toku'
      : paused ? 'Zatrzymano'
      : !progress.pending && total ? progress.failed ? `Zakończono · ${progress.failed} błędów` : 'Zakończono'
      : running ? 'Oczekuje na zadania' : 'Gotowe do uruchomienia';

    // Nothing running: the panel shrinks to one line so the queue gets the screen.
    $('.identification-dashboard')?.classList.toggle('is-idle', !active && !scheduler.stopping && !progress.pending);
    $('#catalogIncomplete').textContent = state.catalog.reviewQueue?.decisions ?? 0;
    $('#settingsDatabaseCopy').textContent = state.catalog.enabled
      ? 'Baza lokalna jest dostepna.'
      : 'Integracja katalogu jest wylaczona.';
    $('#identificationAssigned').textContent = Number(scope.assigned || 0);
    $('#identificationPending').textContent = progress.pending;
    $('#identificationFailed').textContent = progress.failed;
    $('#scanIsbnMatched').textContent = Number(decisions.matched_existing || 0);
    $('#scanIsbnCreated').textContent = Number(decisions.created_edition || 0) +
      Number(decisions.created_work_and_edition || 0);
    $('#scanIsbnReview').textContent = progress.review;
    $('#scanIsbnNotFound').textContent = Number(decisions.not_found || 0);
    $('#scanIsbnUpdated').textContent = runHasTasks ? 'Bieżące uruchomienie' : 'Wszystkie zapisane zadania';
    const labels = {
      queued: 'W kolejce', running: 'Przetwarzane', retry_wait: 'Ponowna próba',
      review_required: 'Wymaga decyzji', failed: 'Błędy', completed: 'Zakończone',
      matched_existing: 'Przypisane do wydania', created_edition: 'Nowe wydania',
      created_work_and_edition: 'Nowe dzieła i wydania',
      not_found: 'Brak dopasowania',
    };
    const rows = [
      ['Gotowe do przetworzenia', identification.runnable ?? 0],
      ['Oczekujące na termin ponowienia', identification.waiting ?? 0],
      ...Object.entries(identification.statuses || {}),
      ...Object.entries(identification.decisions || {}).map(([key,value]) => ['Automatycznie: ' + (labels[key] || key),value]),
      ...Object.entries(identification.manualDecisions || {}).map(([key,value]) => ['Ręcznie: ' + ({approved:'zatwierdzone',not_book:'nie-książka',requeued:'ponowione',proposal_rejected:'odrzucona propozycja'}[key] || key),value]),
      ...(identification.failureReasons || []).map((item) => [
        'Błąd: ' + item.code, item.count,
      ]),
    ];
    $('#identificationStats').innerHTML = rows.length
      ? rows.map(([key, value]) => `<span><b>${escapeHtml(labels[key] || key)}</b><small>${Number(value)}</small></span>`).join('')
      : '<span><small>Brak zadań identyfikacji.</small></span>';
    $('#settingsDatabaseStats').innerHTML = Object.entries(counts)
      .slice(0, 8)
      .map(
        ([key, value]) =>
          `<span><b>${escapeHtml(key.replaceAll('_', ' '))}</b><small>${value}</small></span>`,
      )
      .join('');
    $('#connectionDot').classList.add('online');
    $('#connectionLabel').textContent = 'Aplikacja online';
    if(state.activeView==='today') void refreshWorkflowDashboard?.();
    return true;
  } catch {
    state.catalog = null;
    $('#settingsDatabaseCopy').textContent = 'Nie udało się odczytać statusu bazy.';
    $('#connectionDot').classList.remove('online');
    $('#connectionLabel').textContent = 'Błąd połączenia';
    return false;
  }
}

// One panel for the running or last scan, from the server (any tab, the phone or the schedule).
const scanRun = createScanRun({ $ });
document.addEventListener('bookflip-remote-scan-complete', () => {
  document.dispatchEvent(new CustomEvent('bookflip-scan-complete'));
  void Promise.all([loadHistory(), loadCatalogStatus(), loadCatalogData()]).catch(() => {});
  void restoreLastScanStatus();
});
const { startSearch } = createScannerView({
  state, $, escapeHtml, shortTime, readQueries, selectedSources, toast,
  loadHistory, loadCatalogStatus, loadCatalogData, scanRun,
});

const { renderSettings, runDiagnostics, mountQueryStats } = createSettingsView({ state, $, escapeHtml, loadCatalogStatus });
mountQueryStats(json);

function visibleCatalogRows(...args) { return reviewView.visibleCatalogRows(...args); }
function renderReview(...args) { const result = reviewView.renderReview(...args); syncItemUrl(); return result; }

function renderCatalog(...args) { const result = catalogView.renderCatalog(...args); syncItemUrl(); return result; }
function priceStats(...args) { return catalogView.priceStats(...args); }

function renderOffers(...args) {
  const result = offersView.renderOffers(...args);
  renderOfferScope();
  return result;
}
function openOfferDrawer(...args) { return offersView.openOfferDrawer(...args); }

function setCatalogMode(mode) {
  state.catalogMode = mode;
  state.catalogPreview = null;
  $$('[data-catalog-mode]').forEach((button) =>
    button.classList.toggle('active', button.dataset.catalogMode === mode),
  );
  $('#catalogIsbnMode').hidden = mode !== 'isbn';
  $('#catalogManualMode').hidden = mode !== 'manual';
  $('#catalogSubmit').disabled = false;
  $('#catalogSubmit').textContent = mode === 'isbn' ? 'Sprawdź ISBN' : 'Zapisz rekord';
  $('#catalogFormMessage').hidden = true;
  $('#catalogFormMessage').textContent = '';
}

function openCatalogForReview({ jobId, isbn = '' }) {
  state.catalogReturnToReview = { jobId, isbn, job: state.reviewJobs.find((item) => item.id === jobId) };
  $('#catalogDialog').showModal();
  $('[data-catalog-mode="isbn"]').click();
  $('#catalogIsbn').value = isbn;
  // The manual form starts filled in too, in case no source knows the ISBN.
  if ($('#catalogManualIsbn')) $('#catalogManualIsbn').value = isbn;
  if ($('#catalogTitle') && !$('#catalogTitle').value) $('#catalogTitle').value = state.catalogReturnToReview.job?.offer?.title || '';
  $('#catalogIsbn').focus();
}

async function restoreReviewAfterCatalog({ editionId = null, isbn = '', title = '' } = {}) {
  const context = state.catalogReturnToReview;
  state.catalogReturnToReview = null;
  if (!context) return;
  const normalized = String(isbn || context.isbn || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  let match = state.catalogWorks.flatMap((work) =>
    work.editions.map((edition) => ({ work, edition })),
  ).find(({ work, edition }) => edition.id === editionId ||
    (normalized && edition.identifiers.some((item) =>
      String(item.value || '').replace(/[^0-9Xx]/g, '').toUpperCase() === normalized)) ||
    (!normalized && title && work.title === title));
  if (!match && editionId) {
    try {
      const edition = await json('/api/catalog/editions/' + encodeURIComponent(editionId));
      const work = await json('/api/catalog/works/' + encodeURIComponent(edition.workId));
      const workIndex = state.catalogWorks.findIndex((item) => item.id === work.id);
      if (workIndex < 0) state.catalogWorks.push(work);
      else state.catalogWorks[workIndex] = work;
      const selectedEdition = work.editions.find((item) => item.id === editionId);
      if (selectedEdition) match = { work, edition: selectedEdition };
    } catch {
      // The record is saved; the user can find it manually if loading fails.
    }
  }
  if (context.job && !state.reviewJobs.some((item) => item.id === context.jobId))
    state.reviewJobs.unshift(context.job);
  state.selectedReviewId = context.jobId;
  state.reviewPendingEdition = match ? { jobId: context.jobId, editionId: match.edition.id } : null;
  state.reviewDetail = null;
  showView('review');
  renderReview();
  if (!match) toast('Pozycja została dodana. Wyszukaj ją w katalogu i zatwierdź.');
}

async function submitCatalog(event) {
  event.preventDefault();
  if (state.catalogMode === 'isbn') {
    const isbn = $('#catalogIsbn').value.trim();
    if (!isbn) return toast('Podaj ISBN.');
    $('#catalogSubmit').disabled = true;
    $('#catalogFormMessage').hidden = false;
    $('#catalogFormMessage').textContent =
      'Sprawdzanie katalogu lokalnego oraz metadanych BN/OL...';
    try {
      if (!state.catalogPreview || state.catalogPreviewIsbn !== isbn) {
        const preview = await json('/api/catalog/lookup-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isbn }),
        });
        if ($('#catalogIsbn').value.trim() !== isbn) {
          $('#catalogFormMessage').textContent = 'ISBN został zmieniony. Sprawdź go ponownie.';
          return;
        }
        state.catalogPreview = preview;
        state.catalogPreviewIsbn = isbn;
        const records = [state.catalogPreview.bn, state.catalogPreview.openLibrary, state.catalogPreview.eIsbn, state.catalogPreview.googleBooks].flatMap(
          (result) => result?.records || [],
        );
        $('#catalogFormMessage').textContent = records.length
          ? `${state.catalogPreview.comparison.status}: ${records.map((record) => `${record.source} — ${record.title || 'bez tytułu'}`).join(' | ')}. Kliknij ponownie, aby zatwierdzić utworzenie rekordu.`
          : state.catalogReturnToReview
            ? 'BN, Open Library ani rejestr e-ISBN nie znają tego ISBN. Nic nie zapisano. Zamknij okno i użyj „Utwórz wydanie z ogłoszenia” w weryfikacji (tytuł i autor uzupełnią się same) albo przełącz na wpis ręczny.'
            : 'Nie znaleziono jednoznacznego rekordu. Nic nie zapisano.';
        $('#catalogSubmit').textContent = records.length ? 'Zatwierdź rekord' : 'Sprawdź ponownie';
        $('#catalogSubmit').disabled = !records.length;
        return;
      }
      const result = await json('/api/catalog/lookup-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn }),
      });
      $('#catalogDialog').close();
      event.target.reset();
      state.catalogPreview = null;
      await Promise.all([loadCatalogData(), loadCatalogStatus()]);
      await restoreReviewAfterCatalog({ editionId: result.editionId, isbn });
      toast({ matched_existing: 'Ten ISBN był już w katalogu — wybrano istniejące wydanie.', created_edition: 'Dodano nowe wydanie do istniejącego dzieła.', created_work_and_edition: 'Dodano nowe dzieło i wydanie.' }[result.decision] || 'Zapisano rekord w katalogu.');
    } catch (error) {
      $('#catalogFormMessage').textContent = `Nie zapisano rekordu: ${error.message}`;
      toast(error.message);
    } finally {
      $('#catalogSubmit').disabled = false;
    }
    return;
  }
  const title = $('#catalogTitle').value.trim(),
    isbn = $('#catalogManualIsbn').value.trim();
  if (!title) return toast('Podaj tytul dziela.');
  const data = await json('/api/catalog?compact=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, isbn }),
  });
  state.history = data.catalog;
  $('#catalogDialog').close();
  event.target.reset();
  await Promise.all([loadHistory(),loadCatalogData()]);
  await restoreReviewAfterCatalog({ editionId: data.editionId, isbn, title });
  renderCatalog();
  toast('Ręczny rekord katalogowy został zapisany.');
}

$('#catalogIsbn').addEventListener('input', () => {
  state.catalogPreview = null;
  state.catalogPreviewIsbn = null;
  $('#catalogSubmit').textContent = 'Sprawdź ISBN';
  $('#catalogFormMessage').hidden = true;
});

$$('.nav-item, .mobile-nav-item').forEach((button) =>
  button.addEventListener('click', () => {
    // "Książki" again while a book page is open goes back to the list of books.
    if (button.dataset.view === 'catalog' && state.activeView === 'catalog') catalogView.closeBookPage();
    showView(button.dataset.view);
  }),
);
$('#retryIdentification').addEventListener('click', async () => {
  const button = $('#retryIdentification');
  const mode = $('#retryMode').value;
  button.disabled = true;
  try {
    const result = await json('/api/identification/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    toast(result.queued > 0 ? 'Wznowiono identyfikację. Dodano do kolejki: ' + result.queued : 'Brak zadań do ponowienia w wybranej grupie. Wybierz „Wszystkie nierozstrzygnięte”.');
    await loadCatalogStatus();
    await loadCatalogData();
  } catch (error) {
    toast('Nie udało się ponowić identyfikacji: ' + error.message);
  } finally { button.disabled = false; }
});
$('#toggleSources').addEventListener('click', () => {
  const boxes = $$('#sourceGrid input');
  const all = boxes.length && boxes.every((box) => box.checked);
  boxes.forEach((box) => {
    box.checked = !all;
  });
  updateScanPlan();
});
$('#startSearch').addEventListener('click', startSearch);
$('#cancelSearch').addEventListener('click', () => requestScanCancellation({ $, toast }));
$('#queries').addEventListener('input', updateScanPlan);
$('#sourceGrid').addEventListener('change', updateScanPlan);
document.addEventListener('bookflip-scan-complete', () => {
  void scanRun.refresh().then(updateScanPlan);
  void todayView.refresh();
});
for (const selector of ['#reviewSource', '#reviewIsbn', '#reviewSort'])
  $(selector).addEventListener('change', () => scheduleGlobalCatalogSearch('jobs'));
$('#reviewSearch').addEventListener('input', () => scheduleGlobalCatalogSearch('jobs'));
$('#catalogSort').addEventListener('change', () => scheduleGlobalCatalogSearch('works'));
$('#catalogSearch').addEventListener('input', () => scheduleGlobalCatalogSearch('works'));
for (const selector of ['#offerSource', '#offerStatus', '#offerSort'])
  $(selector).addEventListener('change', () => scheduleGlobalCatalogSearch('offers'));
document.querySelectorAll('#view-offers [data-offer-sort]').forEach((button) =>
  button.addEventListener('click', () => {
    const field = $('#offerSort');
    field.value = field.value === button.dataset.offerSort
      ? button.dataset.offerSortReverse
      : button.dataset.offerSort;
    state.offerPage = 1;
    scheduleGlobalCatalogSearch('offers');
  }),
);
$('#offerSearch').addEventListener('input', () => scheduleGlobalCatalogSearch('offers'));
let identificationControlPending = false;
async function controlIdentification(action) {
  if (identificationControlPending) return;
  identificationControlPending = true;
  $('#identificationStart').disabled = true;
  $('#identificationStop').disabled = true;
  $('#identificationRunState').textContent = action === 'start' ? 'Uruchamianie…' : 'Zatrzymywanie…';
  try {
    const pending = identificationProgress(state.catalog?.identification?.statuses).pending;
    await json('/api/identification/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, retryUnresolved: action === 'start' && !pending }),
    });
    await loadCatalogStatus();
    toast(action === 'start'
      ? 'Wznowiono identyfikację.'
      : 'Zatrzymuję pobieranie nowych zadań. Rozpoczęta partia dokończy bezpieczny zapis.');
  } catch (error) {
    toast('Sterowanie identyfikacją: ' + error.message);
  } finally {
    identificationControlPending = false;
    await loadCatalogStatus();
  }
}
$('#identificationStart').addEventListener('click', () => void controlIdentification('start'));
$('#identificationStop').addEventListener('click', () => void controlIdentification('stop'));

$('#offerPrev').addEventListener('click', () => changeOfferPage(state.offerPage-1));
$('#offerNext').addEventListener('click', () => changeOfferPage(state.offerPage+1));
$('#closeOfferDrawer').addEventListener('click', () => offersView.closeOfferDrawer());
$('#view-catalog [data-go-review]')?.addEventListener('click', () => showView('review'));
$('#openCatalogForm').addEventListener('click', () => {
  state.catalogReturnToReview = null;
  $('#catalogDialog').showModal();
  setCatalogMode('isbn');
});
$('#closeCatalogForm').addEventListener('click', () => { state.catalogReturnToReview = null; $('#catalogDialog').close(); });
$('#cancelCatalogForm').addEventListener('click', () => { state.catalogReturnToReview = null; $('#catalogDialog').close(); });
$$('[data-catalog-mode]').forEach((button) =>
  button.addEventListener('click', () => setCatalogMode(button.dataset.catalogMode)),
);
$('#catalogForm').addEventListener('submit', submitCatalog);
$('#runDiagnostics').addEventListener('click', runDiagnostics);

async function restoreLastScanStatus() {
  try {
    const status = await json('/api/scan/status');
    if (state.scan.running) return;
    if (status.status === 'running') {
      $('#scanStateBadge').textContent = 'Skan trwa';
      $('#scanStateBadge').className = 'state-badge warning';
      $('#scanGuardMessage').textContent = 'Skan działa na serwerze także po zamknięciu karty. Możesz go anulować.';
      $('#cancelSearch').hidden = false;
      $('#cancelSearch').disabled = false;
    } else if (status.status === 'cancelled') {
      $('#scanStateBadge').textContent = 'Skan anulowany';
      $('#scanStateBadge').className = 'state-badge neutral';
      $('#cancelSearch').hidden = true;
    } else if (status.status === 'interrupted') {
      $('#scanStateBadge').textContent = 'Skan przerwany';
      $('#scanStateBadge').className = 'state-badge warning';
      $('#scanGuardMessage').textContent = 'Poprzedni skan został przerwany przy zamknięciu serwera.';
    } else if (status.status === 'completed') {
      $('#scanStateBadge').textContent = 'Ostatni skan ukończony';
      $('#scanStateBadge').className = 'state-badge neutral';
    } else if (status.status === 'failed') {
      $('#scanStateBadge').textContent = 'Ostatni skan nieudany';
      $('#scanStateBadge').className = 'state-badge warning';
    }
  } catch {
    // The scanner can still operate when the status endpoint is unavailable.
  }
}

const scanInsights = createScanInsights({ $, json, escapeHtml });
const setsView = createSetsView({ $, json, escapeHtml, toast, openOfferDrawer, onSelect: () => syncItemUrl() });
// Review: one scrolling list, no separate page-level loading controls.
let reviewScrollLoading = false;
$('#reviewList').addEventListener('scroll', async (event) => {
  const list = event.currentTarget;
  if (reviewScrollLoading || state.activeView !== 'review') return;
  if (list.scrollTop + list.clientHeight < list.scrollHeight - 180) return;
  reviewScrollLoading = true;
  try {
    await reviewView.loadMoreReview();
  } finally {
    reviewScrollLoading = false;
  }
});

// Review: "select all" covers the whole filtered queue; a tab change reloads it from the server.
const loadAllReviewRows = () => loadAllCatalogPages('jobs');
const reloadReview = () => scheduleGlobalCatalogSearch('jobs');
const reviewView = createReviewView({ state, $, $$, json, toast, money, date, escapeHtml, reviewOffers, loadCatalogData, renderCatalog, openCatalogForReview, loadAllReviewRows, reloadReview, loadCatalogPage });
const catalogView = createCatalogView({ state, $, $$, json, money, escapeHtml, visibleCatalogRows, openOfferDrawer, loadCatalogData, toast, showView });
for (const id of ['catalogConflicts', 'catalogDuplicates']) {
  const panel = document.getElementById(id);
  if (panel) $('#checksBody').append(panel);
}
const queue = installQueue({ $, json, escapeHtml, showView, state });
const ruleSettings = mountRuleSettings({ $, json, toast, escapeHtml });
const sourcesView = installSources({ $, json, escapeHtml, openOffers });
// The catalogue tools read their data when Katalog is first opened.
let catalogToolsMounted = false;
function mountCatalogTools() {
  if (catalogToolsMounted) return;
  catalogToolsMounted = true;
  mountDuplicates({ $, json, escapeHtml, toast, loadCatalogData });
  mountCatalogNames({ $, json, escapeHtml, toast, loadCatalogData });
  mountTitleConflicts({ $, json, escapeHtml, toast, loadCatalogData });
  mountCatalogSeeds({ $, json, escapeHtml, toast, loadCatalogData });
}
const onFiltersChange = () => void changeOfferPage(state.offerPage);
const onAssignmentChanged = () => loadCatalogData();
const offersView = createOffersView({ state, $, $$, json, money, date, escapeHtml, allOffers, bookFor, showView, priceStats, onFiltersChange, toast, onAssignmentChanged });

async function changeOfferPage(page) {
  if(page<1 || page>Math.max(1,Math.ceil(state.catalogPages.offers.total/state.pageSize))) return;
  try { if(await loadCatalogPage('offers',{reset:true,pageNumber:page})) renderOffers(); }
  catch(error) {toast('Nie udało się zmienić strony: '+error.message);}
}
const tradingControls = installTradingControls({state,$,json,toast,showView,loadCatalogData,loadCatalogStatus,openOfferDrawer,
  onOfferFilters:()=>scheduleGlobalCatalogSearch('offers'),onCatalogFilters:()=>scheduleGlobalCatalogSearch('works')});
const refreshWorkflowDashboard = installDashboard({ state, showView });
const todayView = installTodayView({ $, json, escapeHtml, showView, openOffers });
const startupView = viewFromSearch(location.search);
const startupItem = idFromSearch(location.search);
showView(startupView);
Promise.all([loadSources().then(() => installScanProfiles({ queriesInput: $('#queries'), sourceGrid: $('#sourceGrid'), panel: $('.scanner-form-panel'), toast, json, deadSources: () => state.deadSources, startScan: () => startSearch() }).then((profiles) => mountScanSchedule({ panel: $('.scanner-form-panel'), json, toast, escapeHtml, profiles }))), loadCatalogStatus(), ensureViewData(startupView), restoreLastScanStatus()]).catch(
  (error) => {
    $('#connectionLabel').textContent = 'Błąd połączenia';
    toast(`Nie udało się wczytać aplikacji: ${error.message}`);
  },
).then(async () => {
  await restoreItem(startupView, startupItem);
  itemUrlReady = true;
  syncItemUrl();
});

// Live diagnostics are read-only and do not interfere with scan streaming.
const scanInsightsOpen = () => state.activeView === 'settings' && $('#scanInsightsFold')?.open;
$('#scanInsightsFold')?.addEventListener('toggle', () => {
  if (scanInsightsOpen()) void scanInsights.refresh();
});
// Live updates from the server (one EventSource) instead of polling every few seconds.
let lastQueueListRefresh = 0;
function onQueueChange() {
  void loadCatalogStatus();
  if (QUEUE_VIEWS.includes(state.activeView)) void queue.refreshCounts();
  if (state.activeView === 'today') void todayView.refresh();
  // The open queue list follows the automatic identification, unless an offer is being decided.
  if (state.activeView === 'review' && !state.selectedReviewId && !state.scan.running && Date.now() - lastQueueListRefresh >= 12000) {
    lastQueueListRefresh = Date.now();
    void loadCatalogData();
  }
}
function onScanChange() {
  if (!state.scan.running) void scanRun.refresh();
  void restoreLastScanStatus();
  if (scanInsightsOpen()) void scanInsights.refresh();
  if (state.activeView === 'today') void todayView.refresh();
}
function onSourceChange() {
  void loadSources().catch(() => {});
  void todayView.refresh();
  if (state.activeView === 'scanner') void sourcesView.refresh();
}
function setConnection(online) {
  $('#connectionDot').classList.toggle('online', online);
  $('#connectionLabel').textContent = online ? 'Aplikacja online' : 'Łączenie ponownie…';
}
connectLive({
  onEvent: (kind) => (kind === 'queue' ? onQueueChange() : kind === 'scan' ? onScanChange() : onSourceChange()),
  onState: (value) => setConnection(value === 'online'),
  // Back after a break (server restart, sleep, network): read everything again.
  onReconnect: () => {
    void loadCatalogStatus();
    void loadSources().catch(() => {});
    void scanRun.refresh();
    void restoreLastScanStatus();
    void todayView.refresh();
    if (loadedKinds.size) void loadCatalogData();
  },
});

installDetailNavigation();
installCoverFallback();
installPreferences({
  $, $$,
  onTradingChange: () => { renderOffers(); void tradingControls?.refreshSettings(); },
  onCatalogViewChange: () => renderCatalog(),
});
$('#catalogIncompleteOnly')?.addEventListener('change', () => renderCatalog());
installCommandPalette({
  $, json, escapeHtml, money, showView, openOfferDrawer,
  openWork: (id) => { if (showView('catalog')) void catalogView.openCatalogDetail(id); },
  // No palette hit: scan the phrase, search for it, or add the ISBN.
  onFallback: (kind, text, isbn) => {
    if (kind === 'isbn') {
      state.catalogReturnToReview = null;
      $('#catalogDialog').showModal();
      setCatalogMode('isbn');
      $('#catalogIsbn').value = isbn;
      $('#catalogIsbn').focus();
    } else if (kind === 'scan') {
      if (!showView('scanner')) return;
      $('#queries').value = text;
      updateScanPlan();
      void startSearch();
    } else if (kind === 'offers' || kind === 'catalog') {
      if (!showView(kind)) return;
      const field = $(kind === 'offers' ? '#offerSearch' : '#catalogSearch');
      field.value = text;
      scheduleGlobalCatalogSearch(kind === 'offers' ? 'offers' : 'works');
    }
  },
  actions: [
    { label: 'Rozpocznij skan', hint: 'Frazy i źródła z formularza skanera', run: () => { showView('scanner'); $('#startSearch')?.click(); } },
    { label: 'Następna oferta do weryfikacji', hint: 'Otwiera kolejkę na pierwszej pozycji', run: () => { showView('review'); document.querySelector('#reviewList [data-review-id]')?.click(); } },
    { label: 'Dodaj książkę do katalogu', hint: 'Przez ISBN albo ręcznie', run: () => $('#openCatalogForm')?.click() },
    { label: 'Utwórz kopię zapasową', hint: 'Ustawienia → Dane i kopie zapasowe', run: () => { showView('settings'); $('#createBackup')?.focus(); } },
    { label: 'Przełącz motyw', hint: 'Jasny / ciemny / systemowy', run: () => { const select = $('#prefTheme'); select.value = select.value === 'dark' ? 'light' : 'dark'; select.dispatchEvent(new Event('change')); } },
  ],
});

document.addEventListener('bookflip-open-work', (event) => {
  if (!event.detail?.workId || !showView('catalog')) return;
  void catalogView.openCatalogDetail(event.detail.workId);
});
document.addEventListener('bookflip-open-edition', event => {
  if (!event.detail?.editionId) return;
  showView('catalog');
  if ($('#catalogDetail').dataset.editionId === event.detail.editionId) openDetailView('catalog');
  else void catalogView.openEditionDetail(event.detail.editionId);
});
