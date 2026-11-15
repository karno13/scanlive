import { mountOfferAssignment } from './offer-assignment.js';
import { mountEditionHistory } from './edition-history.js';
import { mountWorkPrices, editionVariantSelect, wireEditionVariantSelects } from './work-prices.js';
import { mountEditionBuyback, annotateEditionLines, isbn13Of, buybackQuotes, checkBuyback } from './buyback.js';
import { bookTilesMarkup, bookOffersMarkup, bookActionsMarkup, bestBuyback, toggleBookPane } from './book-page.js';
import { openDetailView } from '../core/detail-navigation.js';
import {markDirty,statusLabel,confirmDiscard,watchForm} from '../core/ux.js';
import { safeOfferHref , availabilityLabel, isPurchasable } from '../core/formatters.js';
import { urlForView } from '../core/view-history.js';
import { mountSeriesEditor, readSeries, seriesSummary } from './series.js';
import { confirmDialog } from '../core/dialogs.js';
import { mountWorkRemoval } from './removed-works.js';
import { coverMarkup, isbnCover, tidyWorkTitle, parseBnPeople, splitBnTitle, cleanPublisher } from '../core/bibliography.js';

const firstIsbn = (editions = []) =>
  editions.flatMap((edition) => edition.identifiers || []).find((item) => String(item.scheme).startsWith('isbn'))?.value;
const workCover = (work) => work.cover || (work.editions || []).find((edition) => edition.cover)?.cover || isbnCover(firstIsbn(work.editions));
const workAuthors = (work) => parseBnPeople((work.authors || []).join(' '), work.authors).join(', ');
// What is still missing in a work record — shown as chips and used by the "incomplete" filter.
function missingFacts(work) {
  const editions = work.editions || [];
  const missing = [];
  if (editions.some((edition) => !edition.publicationYear)) missing.push('rok');
  if (editions.some((edition) => !edition.publisher)) missing.push('wydawca');
  if (!firstIsbn(editions)) missing.push('ISBN');
  return missing;
}
// catalog workspace, preserving existing behavior while isolating its implementation.
export function createCatalogView({ state, $, $$, json, money, escapeHtml, visibleCatalogRows, openOfferDrawer, loadCatalogData, toast, showView }) {
function catalogRows() {
  // Preserve the ordering and full-dataset filters returned by the server.
  return [...state.catalogWorks];
}

function validCoverIsbn(value) {
  const isbn = String(value || '')
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();
  if (/^\d{13}$/.test(isbn))
    return [...isbn].reduce((sum, d, i) => sum + Number(d) * (i % 2 ? 3 : 1), 0) % 10 === 0
      ? isbn
      : null;
  if (/^\d{9}[0-9X]$/.test(isbn))
    return [...isbn].reduce((sum, d, i) => sum + (10 - i) * (d === 'X' ? 10 : Number(d)), 0) %
      11 ===
      0
      ? isbn
      : null;
  return null;
}
function pluralForm(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (n === 1) return 'one';
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'few' : 'many';
}

function coverPreviewMarkup(identifiers = []) {
  const isbn = identifiers.map((item) => validCoverIsbn(item.value)).find(Boolean);
  const cover = isbn
    ? `<img class="cover-preview-image" src="${isbnCover(isbn)}" alt="" loading="lazy" decoding="async">`
    : '';
  return `<span class="cover-preview"><span class="book-spine" aria-hidden="true">▤</span>${cover}</span>`;
}
document.addEventListener(
  'load',
  (event) => {
    if (
      event.target instanceof HTMLImageElement &&
      event.target.classList.contains('cover-preview-image') &&
      event.target.naturalWidth > 1
    )
      event.target.closest('.cover-preview')?.classList.add('has-cover');
  },
  true,
);

let detailRequest = 0;
let sqliteAnnotations = null;
let seriesRequest = null;
async function loadSeries() {
  if (seriesRequest) return seriesRequest;
  seriesRequest = json('/api/catalog/series').then(response => {
    sqliteAnnotations = Object.fromEntries((response.items || []).map(item => [item.workId, { series: item.series, volume: item.volume }]));
    renderSeriesSummary();
  }).finally(() => { seriesRequest = null; });
  return seriesRequest;
}
async function saveSeries(workId, entry) {
  const saved = await json('/api/catalog/series/' + encodeURIComponent(workId), {
    method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(entry)
  });
  if (!sqliteAnnotations) sqliteAnnotations = {};
  if (!saved.series) delete sqliteAnnotations[workId];
  else sqliteAnnotations[workId] = {series: saved.series, volume: saved.volume};
  seriesTree = null;
  return saved;
}
// The book page (review 11.2026, stage 3): on a computer the list gives way to one full-width page
// of the book — editions, offers of all editions, prices over time, sets with it, data origin. Opening
// it adds a history entry, so Back returns to the list.
const desktop = () => window.matchMedia('(min-width: 901px)').matches;
function setBookPage(open, { id = null, fromHistory = false } = {}) {
  const view = $('#view-catalog');
  const wasOpen = view.classList.contains('is-book-page');
  if (open && !wasOpen && !fromHistory && desktop())
    history.pushState({ ...(history.state || {}), view: 'catalog', book: id }, '', urlForView('catalog', id));
  view.classList.toggle('is-book-page', open);
}
function closeBookPage({ fromHistory = false } = {}) {
  const view = $('#view-catalog');
  if (!view.classList.contains('is-book-page')) return;
  // Opened from the list: Back is the way out (and the history stays one entry per page).
  if (!fromHistory && history.state?.book) {
    history.back();
    return;
  }
  view.classList.remove('is-book-page');
  state.selectedCatalogId = null;
  renderCatalog();
}

function queryEmptyMarkup() {
  const filtered=['#catalogSearch','#catalogLanguage','#catalogPublisher','#catalogYear','#catalogBinding'].some(id=>$(id)?.value.trim())||Boolean(state.catalogGap);
  return filtered ? '<div class="empty-detail"><h3>Brak pasujących książek</h3><p>Zmień frazę lub usuń filtry wydań.</p></div>' : '<div class="empty-detail"><h3>Katalog jest pusty</h3><p>Zeskanuj oferty lub dodaj pierwszą książkę.</p></div>';
}
// "Braki w katalogu": what the empty detail panel used to be. Counts come from SQL (/api/catalog/gaps);
// a click filters the works list by that gap (server side, so the list total equals the count).
const GAP_LABELS = { publisher: 'bez wydawcy', year: 'bez roku', unknown: 'wydanie nieustalone' };
let gapsRequest = null;
let gapsAt = 0;
async function refreshGaps(force = false) {
  const mount = $('#catalogGaps');
  if (!mount || (!force && Date.now() - gapsAt < 10_000)) return;
  gapsAt = Date.now();
  gapsRequest ??= json('/api/catalog/gaps').finally(() => { gapsRequest = null; });
  try {
    const gaps = await gapsRequest;
    const counts = { publisher: gaps.withoutPublisher, year: gaps.withoutYear, unknown: gaps.unknown };
    mount.innerHTML = '<b>Braki:</b> ' + Object.entries(GAP_LABELS)
      .map(([key, label]) => `<button type="button" class="link-button${state.catalogGap === key ? ' is-active' : ''}" data-catalog-gap="${key}" aria-pressed="${state.catalogGap === key}">${counts[key]} ${label}</button>`)
      .join('') + (state.catalogGap ? ' <button type="button" class="link-button" data-catalog-gap="">Pokaż wszystkie</button>' : '') +
      ` <span class="gaps-complete" title="Wydania z wydawcą i rokiem (bez „Wydanie nieustalone”)">${gaps.completePct.toLocaleString('pl-PL')}% kompletnych wydań</span>`;
  } catch {
    mount.textContent = '';
  }
}
$('#catalogGaps')?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-catalog-gap]');
  if (!button) return;
  state.catalogGap = button.dataset.catalogGap === state.catalogGap ? '' : button.dataset.catalogGap;
  void refreshGaps(true);
  // The same path as typing in the search field: reloads the works list from the server.
  $('#catalogSort').dispatchEvent(new Event('change'));
});
function renderCatalog() {
  if (!state.history) return;
  void refreshGaps();
  renderSeriesSummary();
  if (sqliteAnnotations === null && !seriesRequest) void loadSeries().catch(() => {});
  const seriesMode = document.body.dataset.catalogView === 'series';
  $('#catalogList').classList.toggle('is-series', seriesMode);
  if (seriesMode) {
    $('#catalogList').classList.remove('is-grid');
    void renderSeriesTree();
    return;
  }
  const onlyIncomplete = $('#catalogIncompleteOnly')?.checked;
  const rows = catalogRows().filter((row) => !onlyIncomplete || missingFacts(row).length);
  $('#catalogList').classList.toggle('is-grid', document.body.dataset.catalogView === 'grid');
  $('#catalogList').innerHTML = rows.length
    ? visibleCatalogRows('works', rows)
        .map(
          (row) =>
            catalogRowMarkup(row),
        )
        .join('')
    : queryEmptyMarkup();
  $$('[data-catalog-id]').forEach((button) =>
    button.addEventListener('click', () => openCatalogDetail(button.dataset.catalogId)),
  );
}

// Series view: universe → cycle → volumes on a shelf, with dashed placeholders for missing volumes.
let seriesTree = null;
let seriesTreeAt = 0;
let seriesTreeRequest = null;
async function loadSeriesTree(force = false) {
  if (!force && seriesTree && Date.now() - seriesTreeAt < 30000) return seriesTree;
  seriesTreeRequest ??= json('/api/catalog/series-tree')
    .then((data) => {
      seriesTree = data.universes || [];
      seriesTreeAt = Date.now();
      return seriesTree;
    })
    .finally(() => {
      seriesTreeRequest = null;
    });
  return seriesTreeRequest;
}
const foldText = (text) => String(text ?? '').toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
const editionsLabel = (n) => `${n} ${n === 1 ? 'wydanie' : pluralForm(n) === 'few' ? 'wydania' : 'wydań'}`;
const offersLabel = (n) => `${n} ${n === 1 ? 'oferta' : pluralForm(n) === 'few' ? 'oferty' : 'ofert'}`;
const collapsedUniverses = new Set();
// Cycles with gaps, by index, for the "find missing" buttons of the current render.
let missingTargets = [];
const MAX_SCAN_QUERIES = 10;

function missingQueries(target) {
  // A known title finds the book; "Cycle tom N" is only a fallback.
  return target.missing
    .slice(0, MAX_SCAN_QUERIES)
    .map((number) => (target.titles?.[number] ? `${target.titles[number]} ${target.name}` : `${target.name} tom ${number}`));
}

function missingListText(targets) {
  return targets
    .map((target) => `${target.universe === target.name ? target.name : `${target.universe} — ${target.name}`}: ${target.missing.map((number) => (target.titles?.[number] ? `${number}. ${target.titles[number]}` : number)).join(', ')}`)
    .join('\n');
}

function findMissing(target) {
  const queries = missingQueries(target);
  const field = $('#queries');
  if (!field || !queries.length) return;
  field.value = queries.join('\n');
  field.dispatchEvent(new Event('input', { bubbles: true }));
  showView('scanner');
  field.focus();
  toast(
    target.missing.length > MAX_SCAN_QUERIES
      ? `Wpisano frazy dla ${MAX_SCAN_QUERIES} z ${target.missing.length} brakujących tomów (limit skanu). Wybierz źródła i uruchom skan.`
      : `Wpisano ${queries.length} ${queries.length === 1 ? 'frazę' : pluralForm(queries.length) === 'few' ? 'frazy' : 'fraz'} dla brakujących tomów. Wybierz źródła i uruchom skan.`,
  );
}

function shelfBookMarkup(work, cycleName = null) {
  const title = tidyWorkTitle(work.title);
  const volumeNote = work.guessed
    ? ' title="Numer tomu z tytułów ogłoszeń — sprawdź; poprawisz go przyciskiem pod okładką"'
    : work.fromList
      ? ' title="Numer z listy tomów tej serii"'
      : '';
  const book = `<button type="button" class="shelf-book${work.id === state.selectedCatalogId ? ' active' : ''}" data-series-work="${escapeHtml(work.id)}" title="${escapeHtml(work.title)}">${coverMarkup(work.cover, title, { size: 'lg', escapeHtml })}${work.volume ? `<span class="shelf-vol${work.guessed ? ' is-guess' : ''}"${volumeNote}>${work.volume}</span>` : ''}<b>${escapeHtml(title)}</b><small>${escapeHtml([work.firstYear, offersLabel(work.offers)].filter(Boolean).join(' · '))}</small></button>`;
  // Named cycles: the volume number can be set or corrected right on the shelf.
  if (!cycleName) return book;
  const label = work.volume && !work.guessed ? 'Zmień nr' : 'Nr tomu';
  return `<div class="shelf-slot">${book}<button type="button" class="shelf-setvol" data-set-volume="${escapeHtml(work.id)}" data-cycle="${escapeHtml(cycleName)}" data-volume="${work.volume ?? ''}">${label}</button></div>`;
}

function cycleMarkup(cycle, universe, onlyCycle) {
  // Placeholders only where the gap is readable; long gaps (Świat Dysku 1…41) get a summary line,
  // unless the operator listed the cycle's volumes: then every missing title is worth showing.
  const titles = cycle.missingTitles || {};
  const showGhosts = cycle.missing.length && (cycle.missing.length <= 12 || cycle.defined);
  const shelf = (work) => shelfBookMarkup(work, cycle.name);
  const last = Math.max(cycle.volumes.at(-1) || 0, cycle.missing.at(-1) || 0);
  const items = [];
  if (showGhosts) {
    const missing = new Set(cycle.missing);
    const byVolume = cycle.works.filter((work) => Number.isInteger(work.volume));
    for (let number = 1; number <= last; number++) {
      if (missing.has(number))
        items.push(`<span class="shelf-book is-missing" aria-label="Brak tomu ${number}"><span class="shelf-ghost">${number}</span>${titles[number] ? `<b>${escapeHtml(titles[number])}</b>` : ''}<small>brak w katalogu</small></span>`);
      else for (const work of byVolume.filter((item) => item.volume === number)) items.push(shelf(work));
    }
    for (const work of cycle.works.filter((item) => !Number.isInteger(item.volume))) items.push(shelf(work));
  } else items.push(...cycle.works.map(shelf));
  const facts = [
    cycle.volumes.length ? `tomy ${cycle.volumes.join(', ')}` : '',
    cycle.missing.length ? (showGhosts ? `brakuje ${cycle.missing.length}` : `brakuje ${cycle.missing.length} tomów do ${last}`) : '',
    `${cycle.works.length} ${cycle.works.length === 1 ? 'dzieło' : pluralForm(cycle.works.length) === 'few' ? 'dzieła' : 'dzieł'}`,
    cycle.defined ? `lista: ${cycle.defined} tomów` : '',
  ].filter(Boolean);
  const name = cycle.name || (onlyCycle ? universe : 'Pozostałe');
  // Unnamed cycles carry the universe's own numbering ("Discworld series t. 14").
  const searchName = cycle.name || universe;
  let finder = '';
  if (cycle.missing.length) {
    missingTargets.push({ name: searchName, universe, missing: cycle.missing, titles });
    finder = `<button class="button ghost compact series-find" type="button" data-find-missing="${missingTargets.length - 1}" title="Wpisz do skanera frazy dla brakujących tomów (tytuł z listy tomów albo „${escapeHtml(searchName)} tom N”)">Szukaj brakujących</button>`;
  }
  const listButton = cycle.name
    ? `<button class="button ghost compact" type="button" data-edit-volumes="${escapeHtml(cycle.name)}" title="Wklej tytuły tomów w kolejności — numery przypiszą się same">${cycle.defined ? 'Lista tomów' : 'Dodaj listę tomów'}</button>`
    : '';
  return `<div class="series-cycle${cycle.name ? '' : ' is-loose'}"><div class="series-cycle-head"><h4>${escapeHtml(name)}</h4><small>${escapeHtml(facts.join(' · '))}</small>${finder}${listButton}</div><div class="series-volume-editor" hidden></div><div class="series-shelf">${items.join('')}</div></div>`;
}

async function editVolumeList(button) {
  const editor = button.closest('.series-cycle').querySelector('.series-volume-editor');
  if (!editor.hidden) {
    editor.hidden = true;
    return;
  }
  const name = button.dataset.editVolumes;
  editor.hidden = false;
  editor.innerHTML = '<p class="inline-note">Wczytywanie listy…</p>';
  let current;
  try {
    current = await json('/api/catalog/series-definition?' + new URLSearchParams({ name }));
  } catch (error) {
    editor.innerHTML = `<p class="inline-note">Nie udało się wczytać listy: ${escapeHtml(error.message)}</p>`;
    return;
  }
  editor.innerHTML = `<label class="field"><span>Tomy cyklu „${escapeHtml(name)}” — jeden tytuł w wierszu, w kolejności (można poprzedzić numerem: „15. Prospero w płomieniach”)</span><textarea rows="8" spellcheck="false"></textarea></label><div class="series-volume-actions"><button class="button primary compact" type="button" data-save>Zapisz listę</button><button class="button secondary compact" type="button" data-cancel>Anuluj</button><small>Pusta lista usuwa definicję. Dzieła o pasujących tytułach dostaną numery automatycznie; ręcznie ustawione numery mają pierwszeństwo.</small></div>`;
  const area = editor.querySelector('textarea');
  area.value = current.entries.map((entry) => `${entry.number}. ${entry.title}`).join('\n');
  area.focus();
  editor.querySelector('[data-cancel]').addEventListener('click', () => (editor.hidden = true));
  editor.querySelector('[data-save]').addEventListener('click', async (event) => {
    const save = event.currentTarget;
    save.disabled = true;
    try {
      const saved = await json('/api/catalog/series-definition', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, text: area.value }) });
      toast(saved.entries.length ? `Zapisano listę: ${saved.entries.length} tomów.` : 'Usunięto listę tomów.');
      await loadSeriesTree(true);
      renderSeriesTree();
    } catch (error) {
      toast('Nie zapisano listy: ' + error.message);
      save.disabled = false;
    }
  });
}

function editVolumeNumber(button) {
  const input = document.createElement('input');
  Object.assign(input, { type: 'number', min: '1', max: '10000', value: button.dataset.volume || '', className: 'shelf-volume-input' });
  input.setAttribute('aria-label', 'Numer tomu w cyklu ' + button.dataset.cycle);
  button.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const save = async () => {
    if (done) return;
    done = true;
    const volume = Number(input.value);
    if (!input.value || !Number.isSafeInteger(volume) || volume < 1) {
      renderSeriesTree();
      return;
    }
    try {
      await json('/api/catalog/series/' + encodeURIComponent(button.dataset.setVolume), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ series: button.dataset.cycle, volume }),
      });
      toast(`Ustawiono tom ${volume}.`);
      await loadSeriesTree(true);
    } catch (error) {
      toast('Nie zapisano numeru: ' + error.message);
    }
    renderSeriesTree();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') save();
    if (event.key === 'Escape') {
      done = true;
      renderSeriesTree();
    }
  });
  input.addEventListener('blur', save);
}

const GAPS_PROFILE = 'Braki w seriach';
/** Up to 10 phrases for the missing volumes, titled ones first; written to the gaps scan profile. */
async function saveGapsProfile({ create }) {
  const titled = missingTargets.flatMap((target) => target.missing.filter((number) => target.titles?.[number]).map((number) => `${target.titles[number]} ${target.name}`));
  const numbered = missingTargets.flatMap((target) => target.missing.filter((number) => !target.titles?.[number]).map((number) => `${target.name} tom ${number}`));
  const queries = [...new Set([...titled, ...numbered])].slice(0, MAX_SCAN_QUERIES);
  if (!queries.length) return 0;
  const { items: profiles = [] } = await json('/api/scan-profiles');
  const existing = profiles.find((profile) => profile.name === GAPS_PROFILE);
  if (!existing && !create) return 0;
  if (existing && !create && JSON.stringify(existing.queries) === JSON.stringify(queries)) return queries.length;
  const checked = [...document.querySelectorAll('#sourceGrid input:checked')].map((input) => input.value);
  const sources = existing?.sources?.length ? existing.sources : checked.length ? checked : [...document.querySelectorAll('#sourceGrid input')].map((input) => input.value);
  await json('/api/scan-profiles/' + encodeURIComponent(GAPS_PROFILE), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queries, sources }) });
  return queries.length;
}

async function renderSeriesTree() {
  const list = $('#catalogList');
  if (!seriesTree) list.innerHTML = '<p class="inline-note">Układanie serii…</p>';
  let universes;
  try {
    universes = await loadSeriesTree();
  } catch {
    list.innerHTML = '<p class="inline-note">Nie udało się odczytać serii.</p>';
    return;
  }
  if (document.body.dataset.catalogView !== 'series') return;
  const needle = foldText($('#catalogSearch')?.value.trim() || '');
  const visible = universes
    .map((universe) => {
      const universeHit = needle && foldText(universe.name).includes(needle);
      const cycles = universe.cycles
        .map((cycle) => {
          if (!needle || universeHit || foldText(cycle.name || '').includes(needle)) return cycle;
          const works = cycle.works.filter((work) => foldText(work.title).includes(needle));
          return works.length ? { ...cycle, works, missing: [] } : null;
        })
        .filter(Boolean);
      return cycles.length ? { ...universe, cycles } : null;
    })
    .filter(Boolean);
  missingTargets = [];
  const universeMarkup = visible
    .map((universe) => {
      const named = universe.cycles.filter((cycle) => cycle.name).length;
      return `<details class="series-universe" id="series-${escapeHtml(foldText(universe.name).replace(/[^a-z0-9]+/g, '-'))}" data-universe="${escapeHtml(universe.name)}"${collapsedUniverses.has(universe.name) ? '' : ' open'}><summary><h3>${escapeHtml(universe.name)}</h3><small>${universe.works} dzieł · ${offersLabel(universe.offers)}${named ? ` · cykle: ${named}` : ''}</small></summary>${universe.cycles.map((cycle) => cycleMarkup(cycle, universe.name, universe.cycles.length === 1)).join('')}</details>`;
    })
    .join('');
  const missingTotal = missingTargets.reduce((sum, target) => sum + target.missing.length, 0);
  const gapsBar = missingTotal
    ? `<div class="series-gaps"><span><b>Braki w seriach: ${missingTotal}</b> ${missingTotal === 1 ? 'tom' : pluralForm(missingTotal) === 'few' ? 'tomy' : 'tomów'} w ${missingTargets.length} ${missingTargets.length === 1 ? 'cyklu' : 'cyklach'}</span><button class="button ghost compact" type="button" id="copySeriesGaps">Kopiuj listę braków</button><button class="button ghost compact" type="button" id="saveGapsProfile" title="Zapisz frazy brakujących tomów jako profil skanu; odświeża się sam, gdy zmieniają się braki">Zapisz jako profil skanu</button></div>`
    : '';
  list.innerHTML = visible.length
    ? gapsBar + `<nav class="series-jump" aria-label="Uniwersa">${visible.map((universe) => `<a href="#series-${escapeHtml(foldText(universe.name).replace(/[^a-z0-9]+/g, '-'))}">${escapeHtml(universe.name)} <small>${universe.works}</small></a>`).join('')}</nav>` + universeMarkup
    : queryEmptyMarkup();
  list.querySelectorAll('[data-find-missing]').forEach((button) =>
    button.addEventListener('click', () => findMissing(missingTargets[Number(button.dataset.findMissing)])),
  );
  $('#saveGapsProfile')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      const saved = await saveGapsProfile({ create: true });
      toast(`Zapisano profil „${GAPS_PROFILE}” (${saved} fraz). Uruchomisz go albo włączysz automatyczny skan w Skaner → Zapisane wyszukiwania i profile.`);
    } catch (error) {
      toast('Nie zapisano profilu: ' + error.message);
    } finally {
      event.currentTarget.disabled = false;
    }
  });
  // An existing gaps profile follows the current gaps without a click.
  void saveGapsProfile({ create: false }).catch(() => {});
  $('#copySeriesGaps')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(missingListText(missingTargets));
      toast('Skopiowano listę brakujących tomów.');
    } catch {
      toast('Schowek jest niedostępny w tej przeglądarce.');
    }
  });
  list.querySelectorAll('[data-series-work]').forEach((button) =>
    button.addEventListener('click', () => openCatalogDetail(button.dataset.seriesWork)),
  );
  list.querySelectorAll('[data-edit-volumes]').forEach((button) => button.addEventListener('click', () => editVolumeList(button)));
  list.querySelectorAll('[data-set-volume]').forEach((button) => button.addEventListener('click', () => editVolumeNumber(button)));
  list.querySelectorAll('details.series-universe').forEach((details) =>
    details.addEventListener('toggle', () => {
      if (details.open) collapsedUniverses.delete(details.dataset.universe);
      else collapsedUniverses.add(details.dataset.universe);
    }),
  );
}

function catalogRowMarkup(row) {
  const title = tidyWorkTitle(row.title);
  const parts = splitBnTitle(row.title);
  const single = row.editionCount === 1 ? row.editions[0] : null;
  const meta = single
    ? [cleanPublisher(single.publisher), single.publicationYear].filter(Boolean).join(' · ') || 'Brak danych wydania'
    : editionsLabel(row.editionCount);
  const missing = missingFacts(row);
  return `<button class="catalog-row work-row ${row.id === state.selectedCatalogId ? 'active' : ''}" type="button" data-catalog-id="${escapeHtml(row.id)}" title="${escapeHtml(row.title)}"><span class="catalog-book-title">${coverMarkup(workCover(row), title, { size: 'md', escapeHtml })}<span class="catalog-book-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(workAuthors(row) || 'Autor nieznany')}</small><small class="work-meta">${escapeHtml(meta)}${parts.series ? ` · ${escapeHtml(parts.series)}${parts.volume ? ' ' + parts.volume : ''}` : ''}</small>${missing.length ? `<small class="missing-facts">${missing.map((item) => `<span>brak: ${escapeHtml(item)}</span>`).join('')}</small>` : ''}</span></span><span>${row.editionCount}</span><span data-plural="${pluralForm(row.offerCount)}">${row.offerCount}</span><span>${['manual', 'verified'].includes(row.verificationStatus) ? '' : `<span class="status-pill warning">${escapeHtml(statusLabel(row.verificationStatus))}</span>`}</span></button>`;
}

function renderSeriesSummary() {
  const anchor = $('#catalogList');
  if (!anchor) return;
  let panel = $('#catalogSeriesSummary');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'catalogSeriesSummary';
    panel.className = 'series-summary panel';
    document.querySelector('#legacyImportActions').append(panel);
  }
  const groups = seriesSummary(state.catalogWorks, sqliteAnnotations || {});
  panel.replaceChildren();
  const label = document.createElement('strong');
  label.textContent = 'Import oznaczeń serii ze starszej wersji';
  panel.append(label);
  const info = document.createElement('p');
  info.textContent = sqliteAnnotations === null ? 'Ładowanie serii z SQLite…' : groups.length ? groups.map(group => `${group.name}: tomy ${group.volumes.join(', ')}`).join(' | ') : 'Wybierz dzieło, aby przypisać serię i numer tomu.';
  panel.append(info);
  const legacy = readSeries();
  const pending = Object.entries(legacy).filter(([workId, entry]) =>
    entry && typeof entry.series === 'string' && entry.series.trim() &&
    Number.isSafeInteger(entry.volume) && entry.volume > 0 && entry.volume <= 10000 &&
    sqliteAnnotations && !Object.hasOwn(sqliteAnnotations, workId));
  panel.hidden = pending.length === 0;
  if (sqliteAnnotations !== null && pending.length) {
    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.className = 'button secondary compact';
    importButton.textContent = 'Importuj lokalne oznaczenia (' + pending.length + ')';
    const result = document.createElement('small');
    result.setAttribute('role', 'status');
    importButton.addEventListener('click', async () => {
      if (!(await confirmDialog('Importować ' + pending.length + ' lokalnych oznaczeń do SQLite? Istniejące wpisy zostaną pominięte.', { title: 'Import oznaczeń', confirmLabel: 'Importuj' }))) return;
      importButton.disabled = true;
      let imported = 0, skipped = 0, errors = 0;
      for (const [workId, entry] of pending) {
        try {
          const current = await json('/api/catalog/series');
          const existing = new Set((current.items || []).map(row => row.workId));
          if (existing.has(workId)) { skipped++; continue; }
          await saveSeries(workId, { series: entry.series.trim(), volume: entry.volume });
          imported++;
        } catch { errors++; }
      }
      result.textContent = 'Zaimportowano: ' + imported + ', pominięto: ' + skipped + ', błędy: ' + errors + '. Dane lokalne zachowano.';
      renderSeriesSummary();
    });
    panel.append(importButton, result);
  }
}

// Offers assigned to the book without a named edition; opening it lets the operator name them.
function unknownEditionLine(row) {
  const unknown = row.unknownEdition;
  if (!unknown?.activeOfferCount) return '';
  const n = unknown.activeOfferCount;
  return `<div class="edition-line-wrap is-unknown"><button type="button" class="link-button edition-line" data-edition-detail="${escapeHtml(unknown.id)}"><span class="book-spine" aria-hidden="true">?</span><span><strong>Wydanie nieustalone</strong><small>${n} ${n === 1 ? 'oferta' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'oferty' : 'ofert'} przypisane do książki bez wskazania wydania — otwórz, aby wskazać wydanie</small></span><b>${n}</b></button></div>`;
}

async function openCatalogDetail(id, { fromHistory = false } = {}) {
  if(!await confirmDiscard()) return;
  const request = ++detailRequest;
  setBookPage(true, { id, fromHistory });
  state.selectedCatalogId = id;
  openDetailView('catalog');
  renderCatalog();
  const detail = $('#catalogDetail');
  delete detail.dataset.editionId;
  detail.innerHTML = '<div class="empty-detail"><p>Wczytywanie rekordu...</p></div>';
  try {
    const row = await json(`/api/catalog/works/${encodeURIComponent(id)}`);
    if (request !== detailRequest) return;
    detail.scrollTop = 0;
    const isbns = [...new Set(row.editions.map((edition) => isbn13Of(edition.identifiers)).filter(Boolean))];
    const facts = [editionsLabel(row.editions.length), isbns.length ? '' : 'bez ISBN-13'].filter(Boolean).join(' · ');
    detail.innerHTML = `<button type="button" class="link-button book-back" data-book-back>← Wszystkie książki</button><header class="bp-head">${coverMarkup(workCover(row), tidyWorkTitle(row.title), { size: 'md', escapeHtml })}<div><h3 title="${escapeHtml(row.title)}">${escapeHtml(tidyWorkTitle(row.title))}</h3><p>${escapeHtml(workAuthors(row) || 'Autor nieznany')}</p><small><span class="status-pill ${['manual', 'verified'].includes(row.verificationStatus) ? 'success' : 'warning'}">${escapeHtml(statusLabel(row.verificationStatus))}</span> ${escapeHtml(facts)}</small></div></header><div class="bp-actions" role="toolbar" aria-label="Akcje książki">${bookActionsMarkup(escapeHtml)}</div><div class="bp-panes"></div><div class="bp-tiles" aria-live="polite">${bookTilesMarkup(null, null, { money, escapeHtml, isbns: isbns.length })}</div><section class="detail-section work-offers" aria-live="polite"><h4>Oferty</h4><p class="inline-note">Wczytywanie ofert…</p></section><section class="detail-section bp-editions"><h4>Wydania · ${row.editions.length} <small>wybierz, aby zobaczyć szczegóły</small></h4><div class="price-list">${unknownEditionLine(row)}${row.editions.map((edition) => `<div class="edition-line-wrap"><button type="button" class="link-button edition-line" data-edition-detail="${escapeHtml(edition.id)}">${coverMarkup(edition.cover || isbnCover(firstIsbn([edition])), edition.title, { size: 'xs', escapeHtml })}<span><strong>${escapeHtml(edition.title)}</strong><small>${escapeHtml([edition.publisher, edition.publicationYear, edition.language, edition.binding, (edition.contributors || []).filter((person) => person.role === 'translator').map((person) => 'tł. ' + person.name).join(', '), edition.originalTitle ? 'oryg. ' + edition.originalTitle : ''].filter(Boolean).join(' / ') || 'Brak szczegółów')}</small></span><b>${escapeHtml(edition.identifiers.find((item) => item.scheme.startsWith('isbn'))?.value || 'bez ISBN')}</b></button>${row.editions.length > 1 ? editionVariantSelect(edition, row.variants || [], escapeHtml) : ''}</div>`).join('') || '<p>Brak wydań.</p>'}</div></section><details class="detail-section bp-more"><summary>Szczegóły cen i pochodzenie danych</summary><p class="inline-note">Pochodzenie danych: ${row.externalRecords.length ? row.externalRecords.map((record) => `${escapeHtml(record.provider)}: ${escapeHtml(record.externalId)}`).join(', ') : 'brak zewnętrznych rekordów bibliograficznych.'}</p></details>`;
    detail.querySelector('[data-book-back]').addEventListener('click', () => closeBookPage());
    void loadWorkOffers(row, detail, request);
    void loadWorkSets(row, detail, request);
    const reloadWork = () => { if (state.selectedCatalogId === row.id) void openCatalogDetail(row.id); };
    const tiles = mountBookTiles(row, detail, request, isbns, reloadWork);
    wireBookActions(row, detail, isbns, tiles);
    // Edition navigation is usable as soon as the buttons appear, even while series load.
    detail.querySelectorAll('[data-edition-detail]').forEach((button) =>
      button.addEventListener('click', () => openEditionDetail(button.dataset.editionDetail)),
    );
    try { await loadSeries(); } catch (error) { /* The editor reports a save error if storage is unavailable. */ }
    if (request !== detailRequest) return;
    const panes = detail.querySelector('.bp-panes');
    mountWorkActions(row, panes);
    wireEditionVariantSelects(detail, { json, toast, reload: reloadWork });
    mountSeriesEditor(row, panes, renderSeriesSummary, { annotations: sqliteAnnotations || {}, save: saveSeries });
    asPane(panes.querySelector('.series-editor'), 'series');
    void mountUniverseEditor(row, detail);
    void annotateEditionLines(row, detail);
  } catch (error) {
    if (request !== detailRequest) return;
    detail.innerHTML = `<div class="empty-detail"><h3>Nie udalo sie wczytac rekordu</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
}

/** Offers of all editions, cheapest first: a row opens the offer, „Ogłoszenie ↗” the listing. */
async function loadWorkOffers(row, detail, request) {
  const section = detail.querySelector('.work-offers');
  let data;
  try {
    data = await json('/api/offers?' + new URLSearchParams({ workId: row.id, limit: '100', sort: 'price-asc' }));
  } catch {
    if (section?.isConnected) section.querySelector('.inline-note').textContent = 'Nie udało się wczytać ofert.';
    return;
  }
  if (request !== detailRequest || !section?.isConnected) return;
  const render = (showAll) => {
    section.innerHTML = bookOffersMarkup(data, row, { money, escapeHtml, showAll });
    section.querySelectorAll('[data-work-offer]').forEach((button) => button.addEventListener('click', () => openOfferDrawer(button.dataset.workOffer)));
    section.querySelector('[data-bp-all-offers]')?.addEventListener('click', () => render(true));
  };
  render(false);
}

/** A section mounted under the action bar becomes a pane, shown by its action button. */
function asPane(node, key) {
  if (!node) return;
  node.dataset.bpPane = key;
  node.hidden = true;
}

/** Price tiles: offers statistics and the best buyback quote; also fills „Szczegóły cen”. */
function mountBookTiles(row, detail, request, isbns, reloadWork) {
  const view = { overview: null, buyback: null, busy: false };
  const box = detail.querySelector('.bp-tiles');
  const render = () => {
    if (box.isConnected) box.innerHTML = bookTilesMarkup(view.overview, view.buyback, { money, escapeHtml, isbns: isbns.length, buybackBusy: view.busy });
  };
  const current = () => request === detailRequest && detail.isConnected;
  json('/api/catalog/works/' + encodeURIComponent(row.id) + '/prices')
    .then((overview) => {
      if (!current()) return;
      view.overview = overview;
      render();
      mountWorkPrices({ row, overview, mount: detail.querySelector('.bp-more'), json, money, escapeHtml, toast, reload: reloadWork });
    })
    .catch(() => {});
  buybackQuotes(isbns)
    .then((quotes) => {
      if (!current()) return;
      view.buyback = bestBuyback(quotes);
      render();
    })
    .catch(() => {});
  return { view, render };
}

function wireBookActions(row, detail, isbns, tiles) {
  const bar = detail.querySelector('.bp-actions');
  mountWorkRemoval({ row, button: bar.querySelector('[data-bp-action="remove"]'), json, toast, loadCatalogData, onRemoved: () => closeBookPage() });
  bar.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-bp-action]');
    if (!button) return;
    const action = button.dataset.bpAction;
    if (action === 'remove') return;
    if (action === 'scan') {
      const field = $('#queries');
      if (!field) return;
      field.value = [tidyWorkTitle(row.title), (row.authors || [])[0]].filter(Boolean).join(' ');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      showView('scanner');
      field.focus();
      toast('Wpisano tytuł do skanera. Wybierz źródła i uruchom skan.');
      return;
    }
    if (action === 'buyback') {
      if (!isbns.length) return toast('Cena skupu wymaga ISBN-13 — żadne wydanie go nie ma.');
      button.disabled = true;
      tiles.view.busy = true;
      tiles.render();
      const quotes = {};
      let failed = 0;
      for (const isbn of isbns) {
        try {
          quotes[isbn] = await checkBuyback(isbn);
        } catch {
          failed++;
        }
      }
      tiles.view.busy = false;
      if (Object.keys(quotes).length) tiles.view.buyback = bestBuyback(quotes);
      tiles.render();
      button.disabled = false;
      if (failed) toast(`Nie sprawdzono ${failed} z ${isbns.length} ISBN.`);
      return;
    }
    if (!toggleBookPane(detail, action)) toast('Wczytywanie…');
  });
}

/** "Zestawy z tą książką": sets whose composition holds one of its editions; shown only when there are any. */
async function loadWorkSets(row, detail, request) {
  let items = [];
  try {
    ({ items = [] } = await json('/api/catalog/works/' + encodeURIComponent(row.id) + '/sets'));
  } catch {
    return;
  }
  if (request !== detailRequest || !detail.isConnected || !items.length) return;
  const section = document.createElement('section');
  section.className = 'detail-section work-sets';
  section.innerHTML = '<h4>Zestawy z tą książką · ' + items.length + '</h4><div class="work-offer-list">' + items.map((item) => `<button type="button" class="work-offer-row" data-work-set="${escapeHtml(item.offerId)}"><span><b>${escapeHtml(item.title)}</b><small>${escapeHtml([item.source, item.books + ' ' + (item.books === 1 ? 'książka' : [2, 3, 4].includes(item.books % 10) && ![12, 13, 14].includes(item.books % 100) ? 'książki' : 'książek'), item.confirmed ? 'skład potwierdzony' : 'skład do potwierdzenia', item.dismissedAt ? 'nie interesuje mnie' : ''].filter(Boolean).join(' · '))}</small></span><strong>${money(item.currentPrice)}</strong></button>`).join('') + '</div>';
  const editions = [...detail.querySelectorAll('.detail-section')].find((node) => node.querySelector('[data-edition-detail]'));
  (editions || detail.lastElementChild).after(section);
  section.querySelectorAll('[data-work-set]').forEach((button) => button.addEventListener('click', () => document.dispatchEvent(new CustomEvent('bookflip-open-set', { detail: { offerId: button.dataset.workSet } }))));
}

// Which universe shelf a work sits on in the series view. Automatic by default (title words, then
// the scan phrase); the operator can move a stray work ("Logik der Forschung" under Warcraft).
async function mountUniverseEditor(row, detail, open = false) {
  let universes = [];
  try {
    universes = await loadSeriesTree();
  } catch {
    return;
  }
  if (!detail.isConnected || state.selectedCatalogId !== row.id) return;
  const current = universes.find((universe) => universe.cycles.some((cycle) => cycle.works.some((work) => work.id === row.id)));
  const manual = current?.cycles.some((cycle) => cycle.works.some((work) => work.id === row.id && work.universeManual));
  const names = [...new Set([...universes.map((universe) => universe.name), 'Poza seriami'])];
  const section = document.createElement('section');
  section.className = 'detail-section universe-editor';
  // One line with the current universe; the choice opens under "Edytuj".
  section.innerHTML = `<details class="edit-fold"${open ? ' open' : ''}><summary><span class="edit-fold-label">Uniwersum w widoku „Serie”</span> <b>${escapeHtml(current?.name || 'Poza seriami')}</b> <small>${manual ? '(wybrane ręcznie)' : '(automatycznie: tytuł albo fraza skanu)'}</small> <span class="edit-fold-action">Edytuj</span></summary><div class="universe-editor-row"><select aria-label="Uniwersum dzieła"><option value="">Automatycznie</option>${names.map((name) => `<option value="${escapeHtml(name)}"${manual && name === current?.name ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select><button type="button" class="button secondary">Zapisz uniwersum</button></div></details>`;
  detail.querySelector('.bp-panes').append(section);
  asPane(section, 'universe');
  section.hidden = !open;
  const select = section.querySelector('select');
  const button = section.querySelector('button');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await json('/api/catalog/universe/' + encodeURIComponent(row.id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universe: select.value || null }),
      });
      seriesTree = null;
      toast(select.value ? `Przeniesiono do „${select.value}”.` : 'Przywrócono automatyczne uniwersum.');
      if (document.body.dataset.catalogView === 'series') void renderSeriesTree();
      section.remove();
      void mountUniverseEditor(row, detail, true);
    } catch (error) {
      toast('Nie zapisano uniwersum: ' + error.message);
      button.disabled = false;
    }
  });
}

function priceStats(prices) {
  const sorted = prices
    .filter(value=>value!==null&&value!==undefined)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
  };
}
function offerPriceSummary(offers = []) {
  return priceStats(offers.filter(item=>isPurchasable(item) && (!item.currency || item.currency==='PLN')).map((item) => item.currentPrice));
}
function soldSummaryMarkup(offers = []) {
  const sold = offers.filter((item) => item.availability === 'sold' && item.currentPrice > 0 && (!item.currency || item.currency === 'PLN'));
  if (!sold.length) return '';
  const stats = priceStats(sold.map((item) => item.currentPrice));
  return `<p class="inline-note">Sprzedane ogłoszenia: <strong>${sold.length}</strong>, mediana ostatniej ceny ${money(stats.median)} (cena z chwili ostatniego wykrycia — przybliżenie ceny sprzedaży).</p>`;
}
function offerPriceSummaryMarkup(offers = []) {
  const stats = offerPriceSummary(offers);
  if (!stats) return '<p class="inline-note">Brak zapisanych cen ofertowych dla tego wydania.</p>' + soldSummaryMarkup(offers);
  return soldSummaryMarkup(offers) + `<div class="edition-price-summary"><div><small>Mediana cen ofertowych</small><strong>${money(stats.median)}</strong></div><div><small>Najniższa oferta</small><strong>${money(stats.min)}</strong></div><div><small>Liczba cen</small><strong>${stats.count}</strong></div></div><p class="inline-note">Wartości na podstawie aktualnych cen zapisanych ofert. Nie są to ceny sprzedaży ani prognoza zysku; nie uwzględniają kosztów dostawy i stanu egzemplarza.</p>`;
}

const ROLE_LABELS = { author: 'autor', translator: 'tłumaczenie', illustrator: 'ilustracje', editor: 'redakcja', other: 'współpraca' };
const SERIES_KIND = { cycle: 'cykl', universe: 'świat', publisher_line: 'seria wydawnicza' };
/** BN record details (original title, people, series, physical description) as detail-grid cells. */
function bibliographyMarkup(row) {
  const cells = [];
  if (row.originalTitle) cells.push(['Tytuł oryginału', escapeHtml(row.originalTitle) + (row.originalLanguage ? ' <small>(' + escapeHtml(row.originalLanguage) + ')</small>' : '')]);
  const people = (row.contributors || []).filter((person) => person.role !== 'author' || (row.contributors || []).filter((item) => item.role === 'author').length > 0);
  if (people.length)
    cells.push(['Osoby', people.map((person) => '<button type="button" class="link-button" data-person-search="' + escapeHtml(person.name) + '" title="Pokaż wszystkie książki tej osoby">' + escapeHtml(person.name) + '</button> <small>' + escapeHtml(ROLE_LABELS[person.role] || person.role) + '</small>').join('<br>')]);
  if ((row.series || []).length)
    cells.push(['Seria', row.series.map((entry) => escapeHtml(entry.name) + (entry.volume != null ? ' — t. ' + escapeHtml(entry.volume) : '') + ' <small>' + escapeHtml([SERIES_KIND[entry.kind], entry.source === 'listing' ? 'z ogłoszeń' : entry.source === 'e_isbn' ? 'e-ISBN' : ''].filter(Boolean).join(' · ')) + '</small>').join('<br>')]);
  const physical = [row.pageCount ? row.pageCount + ' s.' : '', row.heightCm ? row.heightCm + ' cm' : '', row.placeOfPublication || ''].filter(Boolean).join(' · ');
  if (physical) cells.push(['Opis fizyczny', escapeHtml(physical)]);
  if ((row.genres || []).length) cells.push(['Gatunek', escapeHtml(row.genres.join(', '))]);
  return cells.length ? '<div class="detail-grid bibliography-grid">' + cells.map(([label, value]) => '<span><b>' + label + '</b><small>' + value + '</small></span>').join('') + '</div>' : '';
}
function mountPersonSearch(detail) {
  detail.querySelectorAll('[data-person-search]').forEach((button) =>
    button.addEventListener('click', () => {
      const input = $('#catalogSearch');
      if (!input) return;
      input.value = button.dataset.personSearch;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }),
  );
}

// The book's unknown edition: offers assigned to the book only. Each can be given its edition
// with one choice; nothing else of an edition record (ISBN, publisher) applies here.
async function mountUnknownEditionPicker(row, detail, request) {
  let work;
  try {
    work = await json('/api/catalog/works/' + encodeURIComponent(row.workId));
  } catch {
    return;
  }
  if (request !== detailRequest || !detail.isConnected) return;
  const heading = detail.querySelector('.edition-identity h3');
  if (heading) heading.textContent = 'Wydanie nieustalone — ' + tidyWorkTitle(work.title);
  const note = document.createElement('p');
  note.className = 'inline-note';
  note.textContent = 'Te oferty przypisano do książki bez wskazania wydania. Ich ceny liczą się do ceny całej książki. Jeśli na zdjęciu widać wydanie, wskaż je przy ofercie.';
  detail.querySelector('.detail-section')?.append(note);
  const options = work.editions
    .map((edition) => `<option value="${escapeHtml(edition.id)}">${escapeHtml([cleanPublisher(edition.publisher) || 'wydawca nieznany', edition.publicationYear, edition.binding, edition.identifiers.find((item) => item.scheme.startsWith('isbn'))?.value].filter(Boolean).join(' · '))}</option>`)
    .join('');
  detail.querySelectorAll('[data-offer-assign]').forEach((slot) => {
    const offerId = slot.dataset.offerAssign;
    const label = document.createElement('label');
    label.className = 'wp-move';
    label.innerHTML = `<small>Wskaż wydanie:</small><select aria-label="Wydanie tej oferty"><option value="">— wybierz —</option>${options}</select>`;
    slot.before(label);
    const select = label.querySelector('select');
    select.addEventListener('change', async () => {
      if (!select.value) return;
      select.disabled = true;
      try {
        await json('/api/offers/' + encodeURIComponent(offerId) + '/assignment', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ editionId: select.value, reason: 'Wskazano wydanie oferty przypisanej wcześniej do książki.' }) });
        toast('Wskazano wydanie.');
        await loadCatalogData();
        await openEditionDetail(row.id);
      } catch (error) {
        toast('Nie zapisano: ' + error.message);
        select.disabled = false;
      }
    });
  });
}

async function openEditionDetail(id) {
  if(!await confirmDiscard())return;
  const request = ++detailRequest;
  openDetailView('catalog');
  setBookPage(true, { id: state.selectedCatalogId });
  const detail = $('#catalogDetail');
  detail.innerHTML = '<div class="empty-detail"><p>Wczytywanie wydania...</p></div>';
  try {
    const row = await json(`/api/catalog/editions/${encodeURIComponent(id)}`);
    if (request !== detailRequest) return;
    state.selectedCatalogId = row.workId;
    renderCatalog();
    detail.dataset.editionId = id;
    detail.scrollTop = 0;
    detail.innerHTML = `<section class="detail-section"><button class="link-button" id="backToWork" type="button">← Wróć do dzieła</button><div class="edition-identity">${row.cover ? coverMarkup(row.cover, row.title, { size: 'lg', escapeHtml }) : coverPreviewMarkup(row.identifiers)}<div><h3>${escapeHtml(row.title)}</h3><p class="inline-note">${escapeHtml(row.authors?.join(', ') || 'Autor nieznany')}</p></div></div><div class="detail-grid"><span><b>ISBN</b><small>${escapeHtml(
      row.identifiers
        .filter((item) => item.scheme.startsWith('isbn'))
        .map((item) => item.value)
        .join(', ') || 'brak',
    )}</small></span><span><b>Wydawca</b><small>${escapeHtml(row.publisher || '-')}</small></span><span><b>Rok</b><small>${escapeHtml(row.publicationYear || '-')}</small></span><span><b>Język / oprawa</b><small>${escapeHtml([row.language, row.binding].filter(Boolean).join(' / ') || '-')}</small></span></div>${bibliographyMarkup(row)}</section><section class="detail-section"><h4>Ceny zapisanych ofert</h4>${offerPriceSummaryMarkup(row.offers)}</section><section class="detail-section"><h4>Powiązane oferty</h4><div class="price-list">${row.offers.map((item) => `<div class="edition-offer-row"><button class="link-button" type="button" data-edition-offer="${escapeHtml(item.id)}"><span>${escapeHtml(item.title)}<small>${escapeHtml(item.source)} · wykryto ${escapeHtml(item.lastSeenAt || 'brak daty')} · ${escapeHtml(availabilityLabel(item))}</small></span><b>${money(item.currentPrice)}</b></button><button type="button" class="link-button edition-offer-manage" data-manage-offer="${escapeHtml(item.id)}" aria-expanded="false">Zmień lub odłącz</button><div data-offer-assign="${escapeHtml(item.id)}"></div></div>`).join('') || '<p>Brak ofert.</p>'}</div></section>`;
    detail.querySelectorAll('[data-edition-offer]').forEach(button=>button.addEventListener('click',()=>openOfferDrawer(button.dataset.editionOffer)));
    mountPersonSearch(detail);
    // Per offer: change the edition or remove the assignment (mounted on first use).
    detail.querySelectorAll('[data-manage-offer]').forEach((button) =>
      button.addEventListener('click', () => {
        const slot = detail.querySelector(`[data-offer-assign="${CSS.escape(button.dataset.manageOffer)}"]`);
        const open = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', String(!open));
        if (open) { slot.replaceChildren(); return; }
        const item = row.offers.find((entry) => entry.id === button.dataset.manageOffer);
        mountOfferAssignment({ container: slot, offer: item, currentEditionId: row.id, initialQuery: row.title, json, escapeHtml, toast, onChanged: async () => { await loadCatalogData(); await openEditionDetail(row.id); } });
      }),
    );
    const history = mountEditionHistory({ row, target: detail, json, money, openOfferDrawer });
    detail.querySelectorAll('.detail-section')[2].before(history);
    if (row.isUnknown) void mountUnknownEditionPicker(row, detail, request);
    else {
      mountEditionBuyback({ row, target: detail, toast });
      mountEditionActions(row,detail);
    }
    $('#backToWork').addEventListener('click', () => openCatalogDetail(row.workId));
  } catch (error) {
    if (request !== detailRequest) return;
    detail.innerHTML = `<div class="empty-detail"><p>${escapeHtml(error.message)}</p></div>`;
  }
}


function editorField(form,label,name,value='',type='text') {
  const field=document.createElement('label');field.className='field';const copy=document.createElement('span');copy.textContent=label;
  const input=document.createElement('input');Object.assign(input,{name,type,value:value??''});field.append(copy,input);form.append(field);return input;
}
function mountWorkActions(row,detail) {
  const root=document.createElement('details');root.className='catalog-edit';const summary=document.createElement('summary');summary.textContent='Popraw dane dzieła / połącz duplikat';root.append(summary);
  const form=document.createElement('form');const title=editorField(form,'Tytuł dzieła','title',row.title),authors=editorField(form,'Autorzy (oddziel średnikiem)','authors',row.authors.join('; '));
  const save=document.createElement('button');save.type='submit';save.className='button secondary';save.textContent='Zapisz poprawione dane';
  const message=document.createElement('p');message.setAttribute('role','status');form.append(save,message);root.append(form);
  const savedWork=watchForm('catalog-work',[title,authors]);
  form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;try{await json('/api/catalog/works/'+encodeURIComponent(row.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:title.value,authors:authors.value.split(';').map(value=>value.trim()).filter(Boolean)})});savedWork();await loadCatalogData();await openCatalogDetail(row.id);}catch(error){message.textContent='Nie zapisano. Sprawdź tytuł i autorów.';}finally{save.disabled=false;}});
  const query=editorField(root,'Znajdź docelowe dzieło dla duplikatu','mergeQuery');const search=document.createElement('button');search.type='button';search.className='button secondary';search.textContent='Znajdź dzieło';const choices=document.createElement('div');root.append(search,choices);
  search.addEventListener('click',async()=>{
    if(query.value.trim().length<2) {message.textContent='Wpisz co najmniej dwa znaki.';return;}
    search.disabled=true;
    try{const result=await json('/api/catalog/works?'+new URLSearchParams({query:query.value,limit:'30'}));choices.replaceChildren();
    for(const target of result.items.filter(item=>item.id!==row.id)){
      const button=document.createElement('button');button.type='button';button.className='button secondary';button.textContent='Połącz z: '+target.title+' · '+editionsLabel(target.editionCount);choices.append(button);
      button.addEventListener('click',async()=>{button.disabled=true;try{const payload={sourceId:row.id,targetId:target.id};const preview=await json('/api/catalog/merge-works',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(!(await confirmDialog('Przenieść '+preview.editions+' wydań z „'+preview.sourceTitle+'” do „'+preview.targetTitle+'”? Dane docelowego dzieła pozostaną. Historyczne decyzje zostaną zachowane.', { title: 'Łączenie dzieł', confirmLabel: 'Połącz', danger: true }))) return;
        await json('/api/catalog/merge-works',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,confirm:true})});await loadCatalogData();await openCatalogDetail(target.id);
      }catch(error){message.textContent='Nie połączono: konflikt serii, chronione identyfikatory lub rekord już połączony. Żadne częściowe zmiany nie zostały zapisane.';}finally{button.disabled=false;}});
    }
    if(!choices.children.length)choices.textContent='Brak innych dzieł. Zmień frazę.';
    }catch(error){message.textContent='Nie udało się wyszukać duplikatów.';}finally{search.disabled=false;}
  });detail.append(root);asPane(root,'edit');
}
function mountEditionActions(row,detail) {
  const root=document.createElement('details');root.className='catalog-edit';const summary=document.createElement('summary');summary.textContent='Popraw dane wydania';root.append(summary);
  const form=document.createElement('form');const fields={title:editorField(form,'Tytuł','title',row.title),publisher:editorField(form,'Wydawca','publisher',row.publisher),publicationYear:editorField(form,'Rok','year',row.publicationYear,'number'),language:editorField(form,'Język','language',row.language),binding:editorField(form,'Oprawa','binding',row.binding)};
  const save=document.createElement('button');save.type='submit';save.className='button secondary';save.textContent='Zapisz wydanie';const message=document.createElement('p');message.setAttribute('role','status');form.append(save,message);root.append(form);detail.append(root);
  const savedEdition=watchForm('catalog-edition',Object.values(fields));
  form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;try{const payload=Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,key==='publicationYear'?(input.value.trim()?Number(input.value):null):input.value]));await json('/api/catalog/editions/'+encodeURIComponent(row.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});savedEdition();await loadCatalogData();await openEditionDetail(row.id);}catch(error){message.textContent='Nie zapisano. Sprawdź tytuł, rok i pozostałe pola.';}finally{save.disabled=false;}});
  const comparison=document.createElement('details');const label=document.createElement('summary');label.textContent='Porównaj z innym wydaniem tego dzieła';comparison.append(label);
  const choice=document.createElement('select');choice.setAttribute('aria-label','Wydanie do porównania');const empty=document.createElement('option');empty.value='';empty.textContent='Wybierz wydanie';choice.append(empty);comparison.append(choice);const output=document.createElement('div');output.className='edition-comparison';comparison.append(output);detail.append(comparison);
  let loaded=false;comparison.addEventListener('toggle',async()=>{if(!comparison.open||loaded)return;try{const work=await json('/api/catalog/works/'+encodeURIComponent(row.workId));for(const edition of work.editions.filter(item=>item.id!==row.id)){const option=document.createElement('option');option.value=edition.id;option.textContent=[edition.title,edition.publisher,edition.publicationYear,edition.language].filter(Boolean).join(' · ');choice.append(option);}loaded=true;}catch(error){output.textContent='Nie udało się pobrać wydań.';}});
  choice.addEventListener('change',async()=>{if(!choice.value)return;try{const other=await json('/api/catalog/editions/'+encodeURIComponent(choice.value));output.replaceChildren();for(const [label,key] of [['Tytuł','title'],['Wydawca','publisher'],['Rok','publicationYear'],['Język','language'],['Oprawa','binding']]){const line=document.createElement('p');line.textContent=label+': '+(row[key]||'brak')+' ↔ '+(other[key]||'brak');output.append(line);}const ids=document.createElement('p');ids.textContent='ISBN: '+row.identifiers.filter(item=>item.scheme.startsWith('isbn')).map(item=>item.value).join(', ')+' ↔ '+other.identifiers.filter(item=>item.scheme.startsWith('isbn')).map(item=>item.value).join(', ');output.append(ids);}catch(error){output.textContent='Nie udało się porównać wydań.';}});
}
return { closeBookPage, catalogRows, validCoverIsbn, coverPreviewMarkup, renderCatalog, openCatalogDetail, priceStats, offerPriceSummary, offerPriceSummaryMarkup, openEditionDetail };
}

