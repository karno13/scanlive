import { openDetailView } from '../core/detail-navigation.js';
import {statusLabel} from '../core/ux.js';
import { safeOfferHref } from '../core/formatters.js';
import { createReviewBulk } from './review-bulk.js';
import { createReviewBatch } from './review-batch.js';
import { createRejectRule } from './reject-rule.js';
import { installPhotoZoom, proposalCoverSrc, reviewPhotoMarkup, showCoverComparison } from './review-photo.js';
import { describeCandidate, differingFields, tidyOfferTitle, tidyWorkTitle, coverMarkup, isbnCover, parseBnPeople, cleanPublisher } from '../core/bibliography.js';
// review workspace, preserving existing behavior while isolating its implementation.
export function createReviewView({ state, $, $$, json, toast, money, date, escapeHtml, reviewOffers, loadCatalogData, renderCatalog, openCatalogForReview, loadAllReviewRows, reloadReview, loadCatalogPage }) {
// "Zaznacz wiele": one action for several offers (see review-bulk.js).
const bulk = createReviewBulk({ state, $, json, toast, escapeHtml, loadCatalogData, filteredRows: () => filteredReviewOffers(), rerender: () => renderReview(), loadAllRows: loadAllReviewRows });
const rejectRule = createRejectRule({ json, toast, escapeHtml, money });
// "Szybkie" and "Do dodania" open as a grid of sure decisions (review-batch.js).
const batch = createReviewBatch({
  $, json, toast, escapeHtml, money,
  onApplied: async ({ reloadOnly = false } = {}) => {
    state.selectedReviewId = null;
    state.reviewDetail = null;
    $('#reviewDetail').dataset.jobId = '';
    if (!reloadOnly) await loadCatalogData();
    renderReview();
  },
});
// Close overlay tools when the operator returns to the queue or presses Escape.
document.addEventListener('pointerdown', (event) => {
  document.querySelectorAll('.review-toolbar details[open]').forEach(panel => {
    if (!panel.contains(event.target)) panel.open = false;
  });
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') document.querySelectorAll('.review-toolbar details[open]').forEach(panel => { panel.open = false; });
});
// The server filters, sorts, merges offers that share an ISBN decision and pages the queue
// (review-queue.mjs, view=list); offers skipped in this session vanish at once, before the next page.
function filteredReviewOffers() {
  return reviewOffers().filter((job) => !state.skippedReviewIds.has(job.id));
}

// Keep at most a bounded number of catalog/review DOM nodes alive even
// after many SQLite pages have been fetched. The catalogue has one "show more" button at the end
// of its list: it shows 100 more loaded rows and fetches the next SQLite page when they run out.
function visibleCatalogRows(kind, rows) {
  const visible = state.visibleRows[kind] || 100;
  const slice = rows.slice(0, visible);
  const panel = kind === 'works' ? document.querySelector('#view-catalog .catalog-list-panel') : null;
  if (panel) {
    let button = panel.querySelector('[data-show-loaded-kind="works"]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'button secondary catalog-load-more';
      button.dataset.showLoadedKind = kind;
      button.addEventListener('click', async () => {
        state.visibleRows[kind] += 100;
        const page = state.catalogPages[kind];
        if (state.visibleRows[kind] > Number(button.dataset.rows) && page.offset < page.total) {
          button.disabled = true;
          button.textContent = 'Wczytywanie…';
          try {
            await loadCatalogPage(kind);
          } catch (error) {
            toast('Nie udało się pobrać kolejnej strony: ' + error.message);
          } finally {
            button.disabled = false;
          }
        }
        renderCatalog();
      });
      panel.append(button);
    }
    const page = state.catalogPages[kind] || { total: 0, offset: 0 };
    // Rows not loaded yet count as possible matches (exact when no client-side filter is on).
    const total = rows.length + Math.max(0, page.total - page.offset);
    button.dataset.rows = String(rows.length);
    button.hidden = slice.length >= total;
    button.textContent = `Pokaż kolejne · widać ${slice.length} z ${total}`;
  }
  return slice;
}

const proposalLabels = { high: 'pewna propozycja', medium: 'możliwa propozycja' };
// The scan phrase that found the offer ("Świat Dysku", "Dragonlance") groups the queue by series.
function reviewGroup(job) {
  const query = String(job.offer?.matchedQueries?.[0] || '').trim();
  return query ? query.charAt(0).toLocaleUpperCase('pl') + query.slice(1) : 'Bez frazy';
}
const SKIPPED_KEY = 'bookflip.review.skipped';
state.skippedReviewIds ||= new Set();
try {
  const saved = JSON.parse(localStorage.getItem(SKIPPED_KEY) || '[]');
  if (Array.isArray(saved) && saved.length)
    void json('/api/review/skipped', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ add: saved.slice(-500) }) })
      .then(() => {
        localStorage.removeItem(SKIPPED_KEY);
        reloadReview();
      })
      .catch(() => {});
} catch {}
const titleMismatch = (job) => [].concat(job.result?.reason ?? []).includes('isbn_title_mismatch');

function proposalChip(job) {
  if (titleMismatch(job)) return ' · <span class="proposal-chip is-mismatch">ISBN innej książki?</span>';
  const reason = [].concat(job.result?.reason ?? [])[0];
  if (reason === 'multiple_metadata_records') return ' · <span class="proposal-chip is-medium">kilka opisów w BN</span>';
  if (reason === 'game_rulebook') return ' · <span class="proposal-chip is-stale">podręcznik do gry</span>';
  if (reason === 'foreign_edition') return ' · <span class="proposal-chip is-stale">wydanie obcojęzyczne</span>';
  if (job.catalogMatch) return ' · <span class="proposal-chip is-catalog">jest w katalogu</span>';
  const label = proposalLabels[job.proposal?.confidence];
  return label ? ` · <span class="proposal-chip is-${job.proposal.confidence}">${label}</span>` : '';
}


/**
 * Third line of a queue row: only what sets the offer apart. Every row of this queue waits for a
 * decision, so that state itself is not repeated.
 */
function reviewRowNote(job, offer) {
  const parts = [
    job.result?.decision === 'not_found' ? 'ISBN nieznany źródłom' : job.status === 'review_required' ? '' : escapeHtml(statusLabel(job.status)),
    job.lastError ? 'pobieranie wymaga ponowienia' : '',
    proposalChip(job).replace(/^ · /, ''),
    offer.availability === 'not_seen' ? '<span class="proposal-chip is-stale">mogła zniknąć</span>' : '',
  ].filter(Boolean);
  return parts.length ? `<small>${parts.join(' · ')}</small>` : '';
}

// Queue tabs. Counts come from the server (whole queue, current filters); the list follows the tab.
const REVIEW_TABS = [
  ['', 'Wszystkie', 'Cała kolejka'],
  ['quick', 'Szybkie', 'Jest w katalogu albo jest pewna propozycja po tytule'],
  ['add', 'Do dodania', 'ISBN, którego nie zna BN ani Open Library, albo kilka opisów jednego ISBN'],
  ['noisbn', 'Bez ISBN', 'Bez ISBN i bez pewnej propozycji'],
  ['bundle', 'Zestawy?', 'Ogłoszenie wygląda na kilka książek'],
  ['games', 'Gry / obce', 'Podręczniki do gier (Codex, Battletome…) i wydania obcojęzyczne — zwykle do odrzucenia hurtem'],
  ['other', 'Inne', 'Pozostałe: ISBN innej książki, sprzeczne dane…'],
];
function renderTabs() {
  const nav = $('#reviewTabs');
  if (!nav) return;
  const counts = state.reviewBuckets;
  const active = state.reviewBucket || '';
  const all = counts ? Object.entries(counts).reduce((sum, [key, value]) => sum + (key === 'reference' ? 0 : value), 0) : null;
  const tabs = REVIEW_TABS.map(([key, label, hint]) => {
    const count = key ? counts?.[key] : all;
    if (key && counts && !count && key !== active) return '';
    const badge = count == null ? '' : ' <span>' + count + '</span>';
    return '<button type="button" class="rv-tab' + (key === active ? ' is-active' : '') + '" data-review-tab="' + key +
      '" aria-pressed="' + (key === active) + '" title="' + escapeHtml(hint) + '">' + escapeHtml(label) + badge + '</button>';
  }).join('');
  nav.innerHTML = tabs;
  nav.querySelectorAll('[data-review-tab]').forEach((button) => button.addEventListener('click', () => {
    state.reviewBucket = button.dataset.reviewTab;
    batch.reset(state.reviewBucket);
    state.selectedReviewId = null;
    state.reviewDetail = null;
    renderTabs();
    reloadReview();
  }));
}

function renderReview() {
  if (!state.history) return;
  renderTabs();
  const rows = filteredReviewOffers();
  // The whole queue (menu, header) vs what the open tab, search, filters and skips leave: the
  // server counts decisions (pages) and the offers they cover.
  const pending = state.reviewQueueTotal ?? state.catalogPages.jobs.total;
  const decisions = state.catalogPages.jobs.total;
  const covered = state.reviewOffersTotal ?? decisions;
  const queueDecisions = state.reviewQueueDecisions ?? decisions;
  $('#reviewCount').textContent = `${queueDecisions} do decyzji · ${pending} ofert`;
  $('#reviewCount').title = `Bieżący widok: ${decisions} decyzji · ${covered} ofert. Jedna decyzja może obejmować kilka ofert z tym samym ISBN.`;
  $('#reviewNavCount').textContent = `${queueDecisions} do decyzji`;
  if (state.selectedReviewId && !rows.some((row) => row.id === state.selectedReviewId))
    state.selectedReviewId = null;
  const reviewListScroll = $('#reviewList').scrollTop;
  const grouped = $('#reviewSort').value === 'group';
  // Decisions per phrase over the whole filtered queue, not only the loaded pages.
  const groupSizes = new Map();
  for (const [phrase, count] of state.reviewGroupSizes || []) {
    const group = reviewGroup({ offer: { matchedQueries: [phrase] } });
    groupSizes.set(group, (groupSizes.get(group) || 0) + count);
  }
  let lastGroup = null;
  // Skipped offers are kept in the database; count only those still waiting.
  const skipped = (state.reviewSkippedCount || 0) + [...state.skippedReviewIds].filter((id) => reviewOffers().some((job) => job.id === id)).length;
  const page = state.catalogPages.jobs;
  const more = page.offset < page.total;
  $('#reviewList').innerHTML = (skipped
    ? `<div class="rv-skipped"><span>Pominięte: ${skipped}</span><button type="button" class="link-button" id="reviewRestoreSkipped">Przywróć</button></div>`
    : '') + (rows.length
    ? rows
        .map((job) => {
          const offer = job.offer;
          const group = reviewGroup(job);
          const header = grouped && group !== lastGroup
            ? `<div class="rv-group" role="presentation"><span>${escapeHtml(group)}</span><small>${groupSizes.get(group) ?? ''}</small></div>`
            : '';
          lastGroup = group;
          const title = tidyOfferTitle(offer.title);
          const extra = bulk.itemExtras(job.id);
          return `${header}<button class="review-item rv-item ${job.id === state.selectedReviewId ? 'active' : ''}${extra.className}" type="button" aria-current="${job.id === state.selectedReviewId ? 'true' : 'false'}"${extra.pressed} data-review-id="${escapeHtml(job.id)}">${extra.checkbox}${coverMarkup(offer.image, title, { size: 'sm', escapeHtml })}<span class="rv-item-copy"><strong>${escapeHtml(title)}${job.sameIsbnCount > 1 ? ` <span class="rv-same-isbn" title="Tyle ofert ma ten ISBN; decyzja dla jednej obejmie pozostałe">×${job.sameIsbnCount}</span>` : ''}</strong><small><span class="source-dot" data-source="${escapeHtml(offer.source)}"></span>${escapeHtml(offer.source)} · ${offer.observedIsbn ? `ISBN ${escapeHtml(offer.observedIsbn)}` : 'brak ISBN'}</small>${reviewRowNote(job, offer)}</span><span class="review-price">${money(offer.currentPrice)}</span></button>`;
        })
        .join('') + (more ? `<button type="button" class="button secondary rv-more" id="reviewMore">Pokaż kolejne · widać ${rows.length} z ${page.total}</button>` : '')
    : '<div class="empty-detail"><h3>Brak pozycji</h3><p>Filtry nie zwracają ofert wymagających decyzji.</p></div>');
  $('#reviewMore')?.addEventListener('click', () => void loadMoreReview());
  $('#reviewRestoreSkipped')?.addEventListener('click', async () => {
    try {
      await json('/api/review/skipped', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clear: true }) });
      state.skippedReviewIds.clear();
      reloadReview();
    } catch (error) {
      toast('Nie udało się przywrócić pominiętych: ' + error.message);
    }
  });
  $('#reviewList').scrollTop = reviewListScroll;
  bulk.renderBar();
  $$('[data-review-id]').forEach((button) =>
    button.addEventListener('click', async (event) => {
      if (bulk.isSelecting()) return bulk.handleItemClick(button.dataset.reviewId, event);
      // Opening one offer leaves the batch grid of this tab.
      batch.leave(state.reviewBucket);
      state.selectedReviewId = button.dataset.reviewId;
      openDetailView('review');
      state.reviewDetail = null;
      // The detail is drawn once, with the fetched offer. Drawing it twice (list data first, the
      // offer a moment later) raced: the first drawing's ISBN preview could hold the second's.
      const job = state.reviewJobs.find((row) => row.id === state.selectedReviewId);
      $('#reviewDetail').dataset.jobId = job ? job.id : '';
      $('#reviewDetail').classList.add('is-loading');
      renderReview();
      $('#reviewList').querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
      if (job) {
        try {
          const detail = await json(`/api/offers/${encodeURIComponent(job.offerId)}`);
          if (state.selectedReviewId !== job.id) return;
          state.reviewDetail = detail;
        } catch (error) {
          if (state.selectedReviewId === job.id) toast(error.message);
        }
        if (state.selectedReviewId !== job.id) return;
        $('#reviewDetail').classList.remove('is-loading');
        $('#reviewDetail').dataset.jobId = '';
        renderReviewDetail();
      }
    }),
  );
  if ($('#reviewDetail').dataset.jobId !== (state.selectedReviewId || '') || (batch.wanted(state.reviewBucket) && $('#reviewDetail').dataset.jobId !== 'batch:' + state.reviewBucket && !bulk.isSelecting()))
    renderReviewDetail();
  // On a desktop the decision panel is never empty: open the first offer of the queue.
  if (!state.selectedReviewId && rows.length && state.activeView === 'review' && !bulk.isSelecting() && !batch.wanted(state.reviewBucket) &&
      window.matchMedia('(min-width: 901px)').matches && !reviewDecisionPending)
    queueMicrotask(() => {
      if (!state.selectedReviewId) $('#reviewList [data-review-id]')?.click();
    });
}

function normalizedIsbn(value) {
  return String(value || '')
    .replace(/[^0-9Xx]/g, '')
    .toUpperCase();
}
function reviewCandidateMarkup(offer, suggested) {
  if (!suggested)
    return '<p class="inline-note">Brak propozycji w załadowanym katalogu. Wyszukaj ręcznie wydanie poniżej.</p>';
  const { work, edition } = suggested;
  const observed = normalizedIsbn(offer.observedIsbn);
  const identifiers = (edition.identifiers || [])
    .filter((item) => String(item.scheme).startsWith('isbn'))
    .map((item) => normalizedIsbn(item.value));
  const conflict = Boolean(observed && identifiers.length && !identifiers.includes(observed));
  const fact = !observed
    ? 'Brak ISBN w ogłoszeniu'
    : !identifiers.length
      ? 'Brak ISBN w katalogowym wydaniu'
      : conflict
        ? 'RÓŻNE ISBN — sprawdź wydanie'
        : 'Zgodny ISBN';
  return `<div class="comparison-candidate"><span class="book-spine" aria-hidden="true">▤</span><span class="candidate-body"><b>${escapeHtml(work.title)}</b><small>${escapeHtml(work.authors.join(', ') || 'Autor nieznany')}</small><small>Wydanie: ${escapeHtml(edition.title)}</small><small>Wydawca: ${escapeHtml(edition.publisher || 'nieznany')} · Rok: ${escapeHtml(edition.publicationYear || 'nieznany')}</small><small>ISBN wydania: ${escapeHtml(identifiers.join(', ') || 'brak')}</small></span></div><div class="verification-fact ${conflict ? 'verification-conflict' : observed && identifiers.includes(observed) ? 'verification-match' : 'verification-unknown'}"><strong>Porównanie ISBN:</strong> ${escapeHtml(fact)}</div>`;
}

const editionFetches = new Set();
async function ensureEditionLoaded(editionId, jobId) {
  if (editionFetches.has(editionId)) return;
  editionFetches.add(editionId);
  try {
    const edition = await json('/api/catalog/editions/' + encodeURIComponent(editionId));
    const work = await json('/api/catalog/works/' + encodeURIComponent(edition.workId));
    const index = state.catalogWorks.findIndex((item) => item.id === work.id);
    if (index < 0) state.catalogWorks.push(work);
    else state.catalogWorks[index] = work;
    if (state.selectedReviewId === jobId) {
      $('#reviewDetail').dataset.jobId = '';
      renderReviewDetail();
    }
  } catch {
    // The edition may have been merged or removed; the operator can search by hand.
  }
}

function renderReviewDetail() {
  if (batch.wanted(state.reviewBucket) && !bulk.isSelecting()) {
    if ($('#reviewDetail').dataset.jobId !== 'batch:' + state.reviewBucket)
      void batch.render(state.reviewBucket).then((shown) => { if (!shown) renderReview(); });
    return;
  }
  const job = reviewOffers().find((row) => row.id === state.selectedReviewId);
  if (!job) {
    $('#reviewDetail').dataset.jobId = '';
    return ($('#reviewDetail').innerHTML =
      '<div class="empty-detail"><h3>Wybierz ofertę</h3><p>Po lewej pojawia się lista ofert wymagajacych decyzji.</p></div>');
  }
  $('#reviewDetail').dataset.jobId = job.id;
  const offer = state.reviewDetail || job.offer,
    result = job.result || {};
  const pendingEditionId = state.reviewPendingEdition?.jobId === job.id
    ? state.reviewPendingEdition.editionId : null;
  const suggested = (pendingEditionId || result.editionId)
    ? state.catalogWorks
        .flatMap((w) => w.editions.map((e) => ({ work: w, edition: e })))
        .find((x) => x.edition.id === (pendingEditionId || result.editionId))
    : null;
  if (pendingEditionId && suggested) state.reviewPendingEdition = null;
  // Only the first pages of works are loaded: fetch the suggested edition's work when missing.
  if (!suggested && (pendingEditionId || result.editionId)) void ensureEditionLoaded(pendingEditionId || result.editionId, job.id);
  const position = filteredReviewOffers().findIndex((row) => row.id === job.id);
  // Position among all decisions of the filtered queue, not only the loaded pages.
  const total = Math.max(filteredReviewOffers().length, state.catalogPages.jobs.total || 0);
  const photo = offer.image || job.offer.image || `/api/offers/${encodeURIComponent(job.offerId)}/image`;
  const offerTitle = tidyOfferTitle(offer.title);
  $('#reviewDetail').innerHTML =
    `<div class="lean-review simple-review rv">
      <header class="lean-review-header rv-head">
        <div class="rv-head-main">
          <p class="rv-kicker"><span class="source-chip" data-source="${escapeHtml(offer.source)}">${escapeHtml(offer.source)}</span><span>${position >= 0 ? `${position + 1} z ${total}` : ''}</span><span>${escapeHtml(reviewGroup(job))}</span></p>
          <h3 title="${escapeHtml(offer.title)}">${escapeHtml(offerTitle)}</h3>
        </div>
        <div class="rv-head-side"><strong class="rv-price">${money(offer.currentPrice)}</strong><a href="${escapeHtml(safeOfferHref(offer.url))}" target="_blank" rel="noreferrer">Ogłoszenie ↗</a></div>
      </header>
      <div class="lean-review-body rv-body">
        ${reviewPhotoMarkup({ photoMarkup: coverMarkup(photo, offerTitle, { size: 'xl', escapeHtml }), caption: 'Zdjęcie z ogłoszenia · widziana ' + date(offer.lastSeenAt), escapeHtml })}
        <div class="rv-work">
          ${titleMismatch(job) ? `<p class="rv-mismatch" role="note">ISBN z ogłoszenia prowadzi do <b>${escapeHtml(String(suggested?.edition.title || result.candidate?.title || 'innej książki').split(' / ')[0])}</b>, a tytuł ogłoszenia nie ma z nią nic wspólnego. Sprawdź zdjęcie: jeśli to ta książka, kliknij „Sprawdź ISBN” i zatwierdź; jeśli nie — wybierz właściwe wydanie.</p>` : ''}
          <section class="lean-review-proposals rv-proposals" id="reviewProposals" aria-live="polite" hidden></section>
          <section class="lean-review-isbn rv-isbn">
            <label for="reviewIsbnCheckInput">ISBN <span>wpisz, wklej albo wybierz propozycję</span></label>
            <div class="lean-review-isbn-tools"><input id="reviewIsbnCheckInput" type="text" inputmode="text" autocomplete="off" maxlength="32" value="${escapeHtml(offer.observedIsbn || '')}" placeholder="ISBN-10 / ISBN-13"><button class="button secondary" type="button" id="reviewIsbnMatchButton">Sprawdź ISBN</button></div>
            <p id="reviewIsbnCheckResult" class="lean-review-result" role="status" aria-live="polite"></p>
          </section>
          <section class="lean-review-choice">
            <label for="reviewBookSearch">Pozycja z katalogu <span>albo wyszukaj ręcznie</span></label>
            <div class="book-combobox"><input class="detail-select" id="reviewBookSearch" type="search" role="combobox" aria-controls="reviewBookOptions" aria-expanded="false" autocomplete="off" placeholder="Szukaj po tytule, autorze lub ISBN" data-edition-id=""><div class="book-options" id="reviewBookOptions" role="listbox"></div></div>
            <p id="reviewChosenEdition" class="lean-review-selected" role="status" aria-live="polite"></p>
          </section>
        </div>
      </div>
      <footer class="lean-review-footer rv-actions">
        <div class="lean-review-primary-actions"><button class="button primary" id="approveReview" type="button" disabled>Zatwierdź <kbd>Enter</kbd></button><button class="button primary" id="createOfferEdition" type="button" hidden>Utwórz wydanie i przypisz <kbd>Enter</kbd></button><button class="button secondary" id="rejectReview" type="button">Odrzuć <kbd>X</kbd></button><button class="button secondary" id="reviewSkip" type="button">Pomiń <kbd>S</kbd></button><details class="rv-more"><summary class="button ghost" aria-label="Więcej akcji">Więcej</summary><div class="rv-more-menu" role="group" aria-label="Więcej akcji"><button class="rv-more-item" id="rejectWithRule" type="button">Odrzuć z regułą… <kbd>R</kbd></button><button class="rv-more-item" id="approveBook" type="button" disabled title="Przypisz ofertę do książki z wybranej (albo pierwszej) propozycji bez ustalania wydania — gdy propozycje różnią się tylko rokiem lub wydawcą. Wydanie uzupełnisz później w katalogu.">Ta książka, wydanie nieustalone <kbd>N</kbd></button><button class="rv-more-item" id="markAsSet" type="button">Zestaw <kbd>Z</kbd></button><button class="rv-more-item" id="reviewAddEdition" type="button">Dodaj do katalogu</button><button class="rv-more-item" id="reviewFocusToggle" type="button" aria-pressed="${document.body.classList.contains('review-focus')}">Tryb skupienia <kbd>F</kbd></button></div></details></div>
        <p class="rv-approve-hint" id="reviewApproveHint" role="status" hidden></p>
      </footer>
    </div>`;
  // "Zestawy?": the set action is the likely answer, so it moves from "Więcej" to the main bar (same button, same handler).
  if (state.reviewBucket === 'bundle') {
    const setButton = $('#markAsSet');
    setButton.className = 'button secondary';
    $('#rejectReview').before(setButton);
  }
  $('#approveReview').disabled = !reviewTargetChosen();
  // Every guard writes the button's disabled state; the pinned primary action follows it.
  new MutationObserver(() => syncPrimaryAction()).observe($('#approveReview'), { attributes: true, attributeFilter: ['disabled'] });
  $('#createOfferEdition').addEventListener('click', () => $('#reviewProposals .rv-offer-edition-form')?.requestSubmit());
  syncPrimaryAction(true);
  const chosenEdition = $('#reviewChosenEdition');
  chosenEdition.textContent = suggested ? `Wybrane: ${suggested.work.title} — ${suggested.edition.title}` : 'Nie wybrano wydania.';
  const reviewPosition = filteredReviewOffers().findIndex((row) => row.id === job.id);
  void loadProposals(job);
  $('#reviewBookSearch').addEventListener('input', (event) => {
    event.target.dataset.editionId = '';
    event.target.dataset.workId = '';
    $('#approveReview').disabled = true;
    $('#reviewChosenEdition').textContent = 'Nie wybrano wydania.';
    $('#reviewBookOptions').classList.add('is-open');
    event.target.setAttribute('aria-expanded', 'true');
    renderReviewBookChoices(event.target.value);
    const query = event.target.value.trim();
    const reviewId = state.selectedReviewId;
    const requestId = ++reviewSearchRequest;
    if (reviewSearchTimer) clearTimeout(reviewSearchTimer);
    if (query.length < 2) return;
    reviewSearchTimer = setTimeout(async () => {
      try {
        const found = await json('/api/catalog/works?' + new URLSearchParams({ query, limit: '50' }));
        if (requestId !== reviewSearchRequest || state.selectedReviewId !== reviewId ||
            $('#reviewBookSearch') !== event.target || event.target.value.trim() !== query) return;
        renderReviewBookChoices(query, found.items || []);
      } catch (error) {
        if (requestId === reviewSearchRequest && state.selectedReviewId === reviewId)
          toast('Nie udało się wyszukać w SQLite: ' + error.message);
      }
    }, 300);
  });
  let returningFromOptions = false;
  $('#reviewBookSearch').addEventListener('focus', (event) => {
    if (returningFromOptions) { returningFromOptions = false; return; }
    $('#reviewBookOptions').classList.add('is-open');
    event.target.setAttribute('aria-expanded', 'true');
    renderReviewBookChoices(event.target.value);
  });
  $('#reviewBookSearch').addEventListener('keydown',event=>{
    const options=[...$('#reviewBookOptions').querySelectorAll('[role="option"]')];
    if(event.key==='ArrowDown'&&options.length){event.preventDefault();options[0].focus();}
    if(event.key==='Escape'){$('#reviewBookOptions').classList.remove('is-open');event.target.setAttribute('aria-expanded','false');}
  });
  $('#reviewBookOptions').addEventListener('keydown',event=>{
    const options=[...event.currentTarget.querySelectorAll('[role="option"]')];const index=options.indexOf(document.activeElement);
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();options[Math.max(0,Math.min(options.length-1,index+(event.key==='ArrowDown'?1:-1)))]?.focus();}
    if(event.key==='Escape'){event.preventDefault();$('#reviewBookOptions').classList.remove('is-open');$('#reviewBookSearch').setAttribute('aria-expanded','false');returningFromOptions=true;$('#reviewBookSearch').focus();}
  });
  renderReviewBookChoices('');
  if (suggested) {
    const input = $('#reviewBookSearch');
    input.value = suggested.work.title;
    input.dataset.editionId = suggested.edition.id;
    input.setAttribute('aria-expanded', 'false');
    $('#reviewBookOptions').innerHTML = '';
    const proposedIsbn = normalizedIsbn(offer.observedIsbn);
    const editionIsbns = suggested.edition.identifiers
      .filter((item) => String(item.scheme).startsWith('isbn'))
      .map((item) => normalizedIsbn(item.value));
    $('#approveReview').disabled = Boolean(
      proposedIsbn && editionIsbns.length && !editionIsbns.includes(proposedIsbn),
    );
    if ($('#approveReview').disabled) {
      input.dataset.editionId = '';
      input.dataset.workId = '';
      input.value = '';
      input.placeholder = 'Konflikt ISBN — wybierz wydanie ręcznie';
      chosenEdition.textContent = 'Konflikt ISBN — wybierz inne wydanie.';
    }
  }
  let pendingIsbn=null;
  $('#reviewIsbnCheckInput').addEventListener('input', () => {
    pendingIsbn=null;
    pendingRecordId=null;
    $('#reviewBookSearch').dataset.editionId = '';
    $('#reviewBookSearch').dataset.workId = '';
    $('#reviewChosenEdition').textContent = 'ISBN zmieniony — dopasuj ponownie.';
    $('#approveReview').disabled = true;
    $('#reviewIsbnCheckResult').textContent = 'ISBN zmieniony — dopasuj ponownie przed zatwierdzeniem.';
  });
  $('#reviewIsbnMatchButton').addEventListener('click', async () => {
    if (reviewDecisionPending) return;
    const button = $('#reviewIsbnMatchButton');
    const output = $('#reviewIsbnCheckResult');
    const isbn = $('#reviewIsbnCheckInput').value.trim();
    pendingIsbn=null;
    if (reviewSearchTimer) clearTimeout(reviewSearchTimer);
    reviewSearchRequest++;
    $('#reviewBookOptions').classList.remove('is-open');
    $('#reviewBookOptions').innerHTML = '';
    $('#reviewBookSearch').setAttribute('aria-expanded', 'false');
    $('#approveReview').disabled=true;
    if (!isbn) {
      output.textContent = 'Wpisz ISBN lub wybierz pozycję z katalogu.';
      return;
    }
    reviewDecisionPending = true;
    const controls = ['reviewIsbnMatchButton', 'reviewIsbnCheckInput', 'approveReview',
      'rejectReview', 'rejectProposal', 'markAsSet', 'requeueReview', 'reviewPrev', 'reviewNext']
      .map((id) => $('#' + id)).filter(Boolean);
    const previousDisabled = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    output.textContent = 'Sprawdzam katalog. Jeśli brak wpisu — sprawdzę API…';
    try {
      const response = await json(`/api/identification-jobs/${encodeURIComponent(job.id)}/match-isbn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn, preview:true, ...(pendingRecordId ? { recordId: pendingRecordId } : {}) }),
      });
      if (state.selectedReviewId !== job.id || !button.isConnected) return;
      if (response.canConfirm) {
        if (response.source === 'catalog' && response.candidate) {
          const input = $('#reviewBookSearch');
          input.value = response.candidate.title;
          input.dataset.editionId = response.editionId;
          input.dataset.workId = '';
          input.setAttribute('aria-expanded', 'false');
          $('#reviewBookOptions').innerHTML = '';
          output.textContent = 'Znaleziono w katalogu: ' + response.candidate.title;
          $('#reviewChosenEdition').textContent = 'Wybrano z katalogu: ' + response.candidate.title;
          return;
        }
        pendingIsbn=isbn;
        $('#approveReview').disabled=false;
        output.textContent='Znaleziono zgodne wydanie. Nic nie przypisano. Sprawdź dane i zatwierdź poniżej.';

        if(response.candidate) output.textContent='Propozycja: '+response.candidate.title+' · '+(response.candidate.authors?.join(', ') || 'autor nieznany')+' · '+(response.candidate.publisher || 'wydawca nieznany')+' · '+(response.candidate.publicationYear || 'rok nieznany')+' · '+(response.candidate.language || 'język nieznany')+' · ISBN '+isbn+'. Nic nie przypisano — zatwierdź wydanie.';
        $('#reviewChosenEdition').textContent='Wybrano propozycję dla ISBN '+isbn+'; oczekuje na zatwierdzenie.';
        return;
      }
      const reasons = {
        isbn_not_found_in_metadata_sources: 'Tego ISBN nie znają: Biblioteka Narodowa, Open Library ani rejestr e-ISBN.',
        metadata_source_temporary_error: 'Zewnętrzne API jest chwilowo niedostępne. Spróbuj ponownie.',
        metadata_sources_conflict: 'Źródła podają sprzeczne informacje. Weryfikacja ręczna jest konieczna.',
        offer_metadata_conflict: 'Dane ogłoszenia są sprzeczne z metadanymi książki.',
        offer_catalog_conflict: 'Dane ogłoszenia są sprzeczne z istniejącym wydaniem.',
        insufficient_offer_context: 'Za mało zgodnych informacji, żeby bezpiecznie przypisać ofertę.',
        metadata_invalid_or_incomplete: 'Metadane z zewnętrznych katalogów są niekompletne.',
        multiple_conflicting_isbn: 'Ogłoszenie ma sprzeczne numery ISBN.',
        isbn_title_mismatch: 'Tytuł ogłoszenia nie pasuje do książki o tym ISBN.',
        manual_unassigned: 'Przypisanie odłączono ręcznie w katalogu. Wybierz właściwe wydanie albo oznacz ofertę.',
        operator_rejected_edition: 'ISBN wskazuje wydanie, które ręcznie odłączono od tej oferty. Wybierz inne wydanie albo potwierdź ISBN ręcznie.',
        possible_bundle: 'Ogłoszenie wygląda na zestaw kilku książek, a ISBN dotyczy jednej. Oznacz jako zestaw (Z) albo potwierdź ISBN ręcznie.',
      };
      output.textContent = response.reason?.map((code) => reasons[code] || code).join(' · ')
        || 'Nie można bezpiecznie dopasować. Wybierz wydanie ręcznie.';

    } catch (error) {
      if (state.selectedReviewId === job.id)
        output.textContent = error.message === 'INVALID_ISBN'
          ? 'Nieprawidłowy ISBN — popraw numer i spróbuj ponownie.'
          : error.message === 'ISBN_REQUIRED'
            ? 'Wpisz ISBN lub wyszukaj wydanie ręcznie.'
            : 'Nie udało się dopasować: ' + error.message;
    } finally {
      reviewDecisionPending = false;
      controls.forEach((control, index) => {
        if (control.isConnected) control.disabled = previousDisabled[index];
      });
      if (button.isConnected) {
        $('#approveReview').disabled = !pendingIsbn && !reviewTargetChosen();
        syncPrimaryAction();
      }
    }
  });
  $('#reviewBookSearch').addEventListener('input',()=>{pendingIsbn=null;pendingRecordId=null;});
  $('#reviewBookOptions').addEventListener('click',()=>{pendingIsbn=null;});
  $('#approveReview').addEventListener('click',async()=>{
    if(!pendingIsbn) return approveReview();
    if(reviewDecisionPending) return;
    reviewDecisionPending=true;$('#approveReview').disabled=true;
    try {
      const result=await json('/api/identification-jobs/'+encodeURIComponent(job.id)+'/match-isbn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({isbn:pendingIsbn,confirm:true,...(pendingRecordId?{recordId:pendingRecordId}:{})})});
      if(!result.matched) {$('#reviewIsbnCheckResult').textContent='Dane zmieniły się od podglądu. Wyszukaj i sprawdź wydanie ponownie.';pendingIsbn=null;return;}
      state.selectedReviewId=null;state.reviewDetail=null;await loadCatalogData();
      const rows=filteredReviewOffers();const next=rows[Math.min(Math.max(reviewPosition,0),rows.length-1)];
      if(next){state.selectedReviewId=next.id;renderReview();}
      toast('Zatwierdzono wydanie i zapisano decyzję.');
    }catch(error){toast('Nie zapisano przypisania. Sprawdź dane i spróbuj ponownie.');}
    finally{reviewDecisionPending=false;if($('#approveReview'))$('#approveReview').disabled=false;}
  });
  // "Więcej" closes after a choice, on Escape and on a click elsewhere; shortcuts press the
  // buttons inside it whether it is open or not.
  const more = $('#reviewDetail .rv-more');
  more.querySelector('.rv-more-menu').addEventListener('click', () => { more.open = false; });
  more.addEventListener('keydown', (event) => { if (event.key === 'Escape' && more.open) { event.stopPropagation(); more.open = false; more.querySelector('summary').focus(); } });
  $('#reviewSkip').addEventListener('click', () => skipReview());
  $('#approveBook').addEventListener('click', () => approveAsBook());
  $('#reviewFocusToggle').addEventListener('click', () => toggleReviewFocus());
  $('#reviewAddEdition').addEventListener('click',()=>{
    openCatalogForReview({ jobId: job.id, isbn: $('#reviewIsbnCheckInput').value });
  });
  $('#rejectReview').addEventListener('click', () => decideReview('excluded', null, 'Odrzucono podczas weryfikacji.'));
  // Reject and, if ticked, "odrzucaj takie zawsze" (reject-rule.js).
  $('#rejectWithRule').addEventListener('click', () =>
    rejectRule.open({ offer: { ...offer, id: job.offerId }, reject: () => decideReview('excluded', null, 'Odrzucono podczas weryfikacji.') }),
  );
  $('#markAsSet').addEventListener('click', async () => {
    if (reviewDecisionPending) return;
    const current = state.selectedReviewId;
    const offerId = job.offerId;
    if (!current || !offerId) return;
    // No confirmation: one key / click, and the toast can undo it.
    const position = filteredReviewOffers().findIndex((row) => row.id === current);
    const button = $('#markAsSet');
    button.disabled = true;
    reviewDecisionPending = true;
    try {
      await json('/api/sets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId }),
      });
      reviewDecisionPending = false;
      if (state.selectedReviewId === current) await moveToNext(position);
      else await loadCatalogData();
      toast('Zestaw zapisany. Książki dodasz w zakładce Zestawy.', {
        label: 'Cofnij',
        onClick: async () => {
          await json('/api/sets/' + encodeURIComponent(offerId), {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}',
          });
          await loadCatalogData();
          toast('Cofnięto — oferta wraca do identyfikacji.');
        },
        onError: () => toast('Nie udało się cofnąć oznaczenia zestawu.'),
      });
    } catch (error) {
      toast('Nie udało się oznaczyć zestawu: ' + error.message);
      if (button.isConnected) button.disabled = false;
    } finally {
      reviewDecisionPending = false;
    }
  });

}

// Suggestions for offers without ISBN. Editions already in the catalogue come first (instant,
// offline; choosing one selects that edition). Title proposals from BN / Open Library follow
// (choosing one fills the ISBN field and runs the normal preview). Nothing is assigned until the
// operator confirms.
function renderLocalCandidates(box, localBox, items) {
      localBox.innerHTML =
        `<div class="rv-section-title"><h4>Już w Twoim katalogu</h4><small>wybór wskazuje książkę, <kbd>Enter</kbd> przypisuje</small></div><ol class="proposal-list rv-cands">` +
        items
          .map((item) => {
            const title = tidyWorkTitle(item.title);
            const author = parseBnPeople(item.authors.join(' '), item.authors)[0] || '';
            const facts = [...editionFacts(item), /^(?:pol|pl|polski)?$/i.test(item.language) ? '' : 'język: ' + item.language, item.offers ? `${item.offers} ${item.offers === 1 ? 'oferta' : [2, 3, 4].includes(item.offers % 10) && ![12, 13, 14].includes(item.offers % 100) ? 'oferty' : 'ofert'}` : '']
              .filter(Boolean)
              .map((text) => `<span class="fact">${escapeHtml(String(text))}</span>`)
              .join('');
            return `<li><button class="rv-cand is-local" type="button" data-proposal-edition="${escapeHtml(item.editionId || '')}" data-proposal-work="${escapeHtml(item.workId)}" data-proposal-title="${escapeHtml(title)}" aria-label="Wybierz książkę z katalogu: ${escapeHtml(title)}"><kbd class="rv-key"></kbd>${coverMarkup(item.cover || isbnCover(item.isbn), title, { size: 'sm', escapeHtml })}<span class="rv-cand-body"><b>${escapeHtml(title)}</b><small>${escapeHtml(author || 'autor nieznany')}</small><span class="rv-facts">${facts}</span><small class="rv-isbn-line">${item.isbn ? 'ISBN ' + escapeHtml(item.isbn) + ' · ' : ''}katalog</small></span><span class="rv-score" data-score="${Math.round(item.score * 10)}"><span class="rv-meter"><i></i></span>${Math.round(item.score * 100)}%</span></button></li>`;
          })
          .join('') +
        '</ol>';
      localBox.querySelectorAll('[data-proposal-work]').forEach((button) =>
        button.addEventListener('click', () => {
          markChosen(box, button);
          chooseCatalogEdition(button.dataset.proposalEdition, button.dataset.proposalTitle, button.dataset.proposalWork);
        }),
      );
      renumberProposals(box);
      const plan = localPreselection(items);
      if (plan.note) localBox.querySelector('.rv-section-title').insertAdjacentHTML('afterend', `<p class="inline-note rv-cand-note${plan.tie ? ' is-tie' : ''}">${escapeHtml(plan.note)}</p>`);
      // One clearly best book: its most used edition is chosen, so Enter alone confirms. Never
      // when the operator typed an ISBN or already picked something.
      if (plan.preselect && !$('#reviewIsbnCheckInput')?.value && !reviewTargetChosen() && !box.querySelector('.rv-cand.is-chosen'))
        localBox.querySelector('.rv-cand')?.click();
}


// Reasons for which no source gave a usable record for the offer's ISBN: the edition can be
// created from the listing itself.
const OFFER_EDITION_REASONS = ['isbn_not_found_in_metadata_sources', 'metadata_invalid_or_incomplete', 'metadata_isbn_mismatch'];
let pendingRecordId = null;

/**
 * Offers that carry an ISBN but are still waiting: editions of the same book already in the
 * catalogue (by title — often a reprint), the records to choose from when BN holds several, and
 * "create the edition from the listing" when no source knows the ISBN.
 */
async function loadIsbnHelp(job, box) {
  const reason = [].concat(job.result?.reason ?? [])[0];
  const current = () => state.selectedReviewId === job.id && box.isConnected;
  box.hidden = false;
  box.innerHTML = '<div class="rv-records"></div><div class="rv-offer-edition"></div><div class="rv-local-cands"></div>';
  const tasks = [];
  tasks.push(jobJson(job.id, 'local-candidates')
    .then(({ items = [] }) => {
      if (current() && items.length) renderLocalCandidates(box, box.querySelector('.rv-local-cands'), items);
    })
    .catch(() => {}));
  if (reason === 'multiple_metadata_records') tasks.push(renderRecordChoice(job, box, current));
  if (OFFER_EDITION_REASONS.includes(reason)) tasks.push(renderOfferEdition(job, box, current));
  await Promise.all(tasks);
  if (current()) renumberProposals(box);
}

async function renderRecordChoice(job, box, current) {
  const mount = box.querySelector('.rv-records');
  let records = job.result?.records;
  if (!records?.length) {
    try {
      const preview = await json('/api/catalog/lookup-preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn: job.offer.observedIsbn }),
      });
      const source = [preview.bn, preview.openLibrary].find((entry) => (entry?.records || []).length > 1);
      records = (source?.records || []).map((record) => ({ id: record.externalRecordId, source: record.source, title: record.title,
        authors: record.authors, publisher: record.publisher, publicationYear: record.publicationYear }));
    } catch {
      records = [];
    }
  }
  if (!current() || !records.length) return;
  mount.innerHTML = `<div class="rv-section-title"><h4>Ten ISBN ma kilka opisów w ${escapeHtml(records[0].source === 'bn' ? 'Bibliotece Narodowej' : 'katalogu')}</h4><small>wybierz właściwy, potem <kbd>Enter</kbd></small></div><ol class="proposal-list rv-cands">` +
    records.map((record) => {
      const title = tidyWorkTitle(record.title);
      const author = parseBnPeople([].concat(record.authors ?? []).join(' '), [].concat(record.authors ?? []))[0] || '';
      const facts = [record.publicationYear, cleanPublisher(record.publisher)].filter(Boolean)
        .map((text) => `<span class="fact">${escapeHtml(String(text))}</span>`).join('');
      return `<li><button class="rv-cand" type="button" data-record-id="${escapeHtml(record.id)}" aria-label="Użyj opisu: ${escapeHtml(title)}"><kbd class="rv-key"></kbd>${coverMarkup(isbnCover(job.offer.observedIsbn), title, { size: 'sm', escapeHtml })}<span class="rv-cand-body"><b>${escapeHtml(title)}</b><small>${escapeHtml(author || 'autor nieznany')}</small><span class="rv-facts">${facts}</span><small class="rv-isbn-line">rekord ${escapeHtml(record.id)}</small></span></button></li>`;
    }).join('') + '</ol>';
  mount.querySelectorAll('[data-record-id]').forEach((button) => button.addEventListener('click', () => {
    markChosen(box, button);
    pendingRecordId = button.dataset.recordId;
    const input = $('#reviewIsbnCheckInput');
    if (input) input.value = job.offer.observedIsbn;
    $('#reviewIsbnMatchButton')?.click();
  }));
}

async function renderOfferEdition(job, box, current) {
  const mount = box.querySelector('.rv-offer-edition');
  let draft;
  try {
    draft = await jobJson(job.id, 'offer-edition');
  } catch {
    return;
  }
  if (!current()) return;
  const siblings = draft.siblings
    ? ` Obejmie też ${draft.siblings} ${draft.siblings === 1 ? 'inną ofertę' : [2, 3, 4].includes(draft.siblings % 10) && ![12, 13, 14].includes(draft.siblings % 100) ? 'inne oferty' : 'innych ofert'} z tym ISBN.`
    : '';
  mount.innerHTML = `<form class="rv-offer-edition-form" novalidate>
      <div class="rv-section-title"><h4>BN, Open Library i e-ISBN nie znają tego ISBN — utwórz wydanie z ogłoszenia</h4><small>BN sprawdzi je ponownie za tydzień</small></div>
      <label class="field"><span>Tytuł</span><input name="title" type="text" maxlength="300" required value="${escapeHtml(draft.title)}"></label>
      <label class="field"><span>Autor <small>(kilku: po przecinku)</small></span><input name="authors" type="text" maxlength="250" value="${escapeHtml(draft.authors.join(', '))}" placeholder="np. Dan Abnett"></label>
      <div class="rv-offer-edition-row"><label class="field"><span>Wydawca</span><input name="publisher" type="text" maxlength="200" value="${escapeHtml(draft.record?.publisher || '')}"></label><label class="field"><span>Rok</span><input name="publicationYear" type="number" min="1400" max="2100" value="${escapeHtml(draft.record?.publicationYear || '')}"></label></div>
      ${draft.record ? `<p class="inline-note rv-record-note">Dane z <a href="${escapeHtml(draft.record.url || 'https://lubimyczytac.pl')}" target="_blank" rel="noreferrer">lubimyczytac.pl ↗</a> — strona z tym samym ISBN${draft.record.cycle?.name ? ' · cykl ' + escapeHtml(draft.record.cycle.name) + (draft.record.cycle.volume ? ', tom ' + escapeHtml(draft.record.cycle.volume) : '') : ''}${draft.record.pages ? ' · ' + escapeHtml(draft.record.pages) + ' s.' : ''}.</p>` : ''}
      <p class="inline-note">ISBN ${escapeHtml(draft.isbn || '')}${draft.universe ? ' · ' + escapeHtml(draft.universe) : ''}.${escapeHtml(siblings)}</p>
      <div class="offer-assignment-actions"><button class="button primary compact" type="submit">Utwórz wydanie i przypisz</button></div>
    </form>`;
  const form = mount.querySelector('form');
  syncPrimaryAction(true);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (reviewDecisionPending) return;
    const title = form.elements.title.value.trim();
    if (!title) return form.elements.title.focus();
    const position = filteredReviewOffers().findIndex((row) => row.id === job.id);
    reviewDecisionPending = true;
    form.querySelector('button').disabled = true;
    try {
      const result = await json(`/api/identification-jobs/${encodeURIComponent(job.id)}/offer-edition`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          authors: form.elements.authors.value.split(',').map((name) => name.trim()).filter(Boolean),
          isbn: draft.isbn,
          publisher: form.elements.publisher.value.trim(),
          publicationYear: form.elements.publicationYear.value,
        }),
      });
      toast(result.created
        ? `Utworzono wydanie „${title}”.${draft.siblings ? ' Pozostałe oferty z tym ISBN przypiszą się same.' : ''}`
        : 'To ISBN jest już w katalogu — przypisano do istniejącego wydania.');
      await moveToNext(position);
    } catch (error) {
      toast('Nie utworzono wydania: ' + error.message);
      if (form.isConnected) form.querySelector('button').disabled = false;
    } finally {
      reviewDecisionPending = false;
    }
  });
}

/** After a decision: reload the queue and open the offer that took the decided one's place. */
async function moveToNext(position) {
  state.selectedReviewId = null;
  state.reviewDetail = null;
  const refreshed = await loadCatalogData();
  if (refreshed === false) return;
  const after = filteredReviewOffers();
  const next = after[Math.min(Math.max(position, 0), after.length - 1)];
  if (!next) return renderReview();
  state.selectedReviewId = next.id;
  try {
    state.reviewDetail = await json(`/api/offers/${encodeURIComponent(next.offerId)}`);
  } catch {
    state.reviewDetail = null;
  }
  renderReview();
}

// The detail is drawn twice per click (list selection, then the fetched offer): the suggestion
// requests of one job are shared for a short while instead of being sent again.
const jobRequests = new Map();
const JOB_REQUEST_TTL_MS = 30_000;
function jobJson(jobId, kind) {
  const key = jobId + '/' + kind;
  const known = jobRequests.get(key);
  if (known && Date.now() - known.at < JOB_REQUEST_TTL_MS) return known.promise;
  const promise = json(`/api/identification-jobs/${encodeURIComponent(jobId)}/${kind}`).catch((error) => {
    jobRequests.delete(key);
    throw error;
  });
  jobRequests.set(key, { at: Date.now(), promise });
  if (jobRequests.size > 60) jobRequests.delete(jobRequests.keys().next().value);
  return promise;
}

// Suggestions for offers without ISBN (see renderLocalCandidates and the title proposals below).
async function loadProposals(job) {
  const box = $('#reviewProposals');
  if (!box) return;
  pendingRecordId = null;
  if (job.offer?.observedIsbn) return loadIsbnHelp(job, box);
  box.hidden = false;
  box.innerHTML = '<div class="rv-local-cands"></div><div class="rv-external-cands"><p class="inline-note">Szukam propozycji po tytule…</p></div>';
  const localBox = box.querySelector('.rv-local-cands');
  const externalBox = box.querySelector('.rv-external-cands');
  const current = () => state.selectedReviewId === job.id && box.isConnected;
  let localCount = 0;
  const localTask = jobJson(job.id, 'local-candidates')
    .then(({ items = [] }) => {
      if (!current() || !items.length) return;
      localCount = items.length;
      renderLocalCandidates(box, localBox, items);
    })
    .catch(() => {});
  try {
    const proposal = await jobJson(job.id, 'proposals');
    await localTask;
    if (!current()) return;
    const items = (proposal.candidates || []).slice(0, Math.max(2, 5 - localCount));
    if (!items.length) {
      externalBox.innerHTML = localCount
        ? ''
        : proposal.unavailable?.length
          ? '<p class="inline-note">Katalog zewnętrzny jest chwilowo niedostępny — propozycji nie udało się pobrać.</p>'
          : '<p class="inline-note">Brak propozycji po tytule. Wyszukaj wydanie ręcznie.</p>';
      return;
    }
    const described = items.map(describeCandidate);
    const differs = differingFields(described);
    const onlyIsbn = !differs.size && described.length > 1;
    const fact = (field, text) => text ? `<span class="fact${differs.has(field) ? ' is-diff' : ''}">${escapeHtml(text)}</span>` : '';
    externalBox.innerHTML =
      `<div class="rv-section-title"><h4>${localCount ? 'Inne wydania (BN / Open Library)' : 'Propozycje po tytule'}</h4><small>${differs.size ? 'Podświetlono to, czym się różnią' : onlyIsbn ? 'Różnią się tylko numerem ISBN' : ''}</small></div><ol class="proposal-list rv-cands${onlyIsbn ? ' is-isbn-only' : ''}">` +
      described
        .map(
          (item) =>
            `<li><button class="rv-cand" type="button" data-proposal-isbn="${escapeHtml(item.isbn)}" aria-label="Użyj propozycji: ${escapeHtml(item.title)}"><kbd class="rv-key"></kbd>${coverMarkup(isbnCover(item.isbn), item.title, { size: 'sm', escapeHtml })}<span class="rv-cand-body"><b title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</b><small>${escapeHtml([item.author, ...item.contributors.slice(0, 1)].filter(Boolean).join(' · ') || 'autor nieznany')}</small><span class="rv-facts">${fact('year', item.year)}${fact('series', item.series ? item.series + (item.volume ? ' · t. ' + item.volume : '') : item.cycle)}${fact('publisher', item.publisher)}</span><small class="rv-isbn-line">ISBN ${escapeHtml(item.isbn)} · ${escapeHtml(item.source)}</small></span><span class="rv-score" data-score="${Math.round(item.score * 10)}"><span class="rv-meter"><i></i></span>${Math.round(item.score * 100)}%</span></button></li>`,
        )
        .join('') +
      '</ol>';
    externalBox.querySelectorAll('[data-proposal-isbn]').forEach((button) =>
      button.addEventListener('click', () => {
        markChosen(box, button);
        useProposal(button.dataset.proposalIsbn);
      }),
    );
    renumberProposals(box);
    // A single sure proposal is previewed right away (read-only); the operator still confirms with
    // Enter. With several editions — or a known catalogue edition — nothing is preselected.
    if (proposal.confidence === 'high' && items.length === 1 && !localCount && !$('#reviewIsbnCheckInput')?.value)
      externalBox.querySelector('.rv-cand')?.click();
  } catch {
    await localTask;
    if (current()) externalBox.innerHTML = localCount ? '' : '<p class="inline-note">Nie udało się pobrać propozycji.</p>';
  }
}

/** Marks one proposal as chosen and puts its cover next to the listing photo. */
function markChosen(box, button) {
  box.querySelectorAll('.rv-cand').forEach((other) => other.classList.toggle('is-chosen', other === button));
  const title = button.dataset.proposalTitle || button.querySelector('.rv-cand-body > b')?.textContent || '';
  showCoverComparison($('#reviewDetail .rv-photo'), proposalCoverSrc(button), { title });
}

/** Keys 1–9 follow the on-screen order: catalogue editions first, then external proposals. */
function renumberProposals(box) {
  const bookButton = $('#approveBook');
  if (bookButton && box.querySelector('.rv-cand')) bookButton.disabled = false;
  box.querySelectorAll('.rv-cand').forEach((button, index) => {
    const key = button.querySelector('.rv-key');
    if (key) key.textContent = index < 9 ? String(index + 1) : '';
  });
}

/** A catalogue edition, or a book whose edition the server picks from the listing (else unknown). */
function chooseCatalogEdition(editionId, title, workId = '') {
  const input = $('#reviewBookSearch');
  if (!input || !(editionId || workId)) return;
  input.value = title;
  input.dataset.editionId = editionId || '';
  input.dataset.workId = editionId ? '' : workId;
  $('#reviewChosenEdition').textContent = editionId
    ? `Wybrane z katalogu: ${title}`
    : `Wybrana książka: ${title} — wydanie nieustalone (uzupełnisz je później w katalogu)`;
  $('#approveReview').disabled = false;
}

/**
 * The pinned primary button is the action of the case at hand: "Zatwierdź" once an edition or an
 * ISBN is chosen, "Utwórz wydanie i przypisz" when no source knows the ISBN and the form built
 * from the listing is the way forward. When neither applies, one sentence says what is missing.
 */
let primaryActionTimer = null;
function syncPrimaryAction(freshRender = false) {
  const approve = $('#approveReview');
  const create = $('#createOfferEdition');
  const hint = $('#reviewApproveHint');
  if (!approve || !create || !hint) return;
  // While a decision is being saved every button is disabled for a moment: keep what is shown
  // and look again afterwards. A freshly rendered offer is always laid out at once.
  clearTimeout(primaryActionTimer);
  if (reviewDecisionPending && !freshRender) {
    primaryActionTimer = setTimeout(syncPrimaryAction, 200);
    return;
  }
  const useCreate = approve.disabled && Boolean($('#reviewProposals .rv-offer-edition-form'));
  approve.hidden = useCreate;
  create.hidden = !useCreate;
  const blocked = approve.disabled && !useCreate;
  hint.hidden = !blocked;
  hint.textContent = blocked
    ? 'Zatwierdzenie czeka na wybór: propozycja (1–9), „Sprawdź ISBN” albo książka z wyszukiwarki.'
    : '';
}

function reviewTargetChosen() {
  const input = $('#reviewBookSearch');
  return Boolean(input?.dataset.editionId || input?.dataset.workId);
}

/** What the candidate says about its edition: named from the listing, the only one, or not yet. */
function editionFacts(item) {
  if (item.editionId) {
    const why = String(item.editionReason || '').startsWith('listing') ? 'wydanie z ogłoszenia' : item.editionReason === 'isbn' ? 'wydanie po ISBN' : '';
    return [item.publicationYear, cleanPublisher(item.publisher), item.editionCount > 1 ? why : ''];
  }
  const count = item.editionCount || 0;
  return [count + ' ' + (count === 1 ? 'wydanie' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? 'wydania' : 'wydań') + ' · wydanie nieustalone'];
}

function useProposal(isbn) {
  const input = $('#reviewIsbnCheckInput');
  if (!input || !isbn) return;
  input.value = isbn;
  $('#reviewIsbnMatchButton')?.click();
}

function skipReview() {
  const id = state.selectedReviewId;
  if (!id || reviewDecisionPending) return;
  const rows = filteredReviewOffers();
  const index = rows.findIndex((row) => row.id === id);
  state.skippedReviewIds.add(id);
  void json('/api/review/skipped', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ add: [id] }) })
    .catch((error) => toast('Nie udało się zapisać pominięcia: ' + error.message));
  const next = rows[index + 1] || rows[index - 1];
  state.selectedReviewId = null;
  state.reviewDetail = null;
  renderReview();
  if (next) document.querySelector('[data-review-id="' + CSS.escape(next.id) + '"]')?.click();
}

function toggleReviewFocus(force) {
  const on = document.body.classList.toggle('review-focus', force);
  try { localStorage.setItem('bookflip.reviewFocus', on ? '1' : ''); } catch {}
  $('#reviewFocusToggle')?.setAttribute('aria-pressed', String(on));
}
try { if (localStorage.getItem('bookflip.reviewFocus')) document.body.classList.add('review-focus'); } catch {}

async function navigateReview(step) {
  if (reviewDecisionPending) return;
  let rows = filteredReviewOffers();
  const index = rows.findIndex((row) => row.id === state.selectedReviewId);
  // Past the last loaded offer: the next page from the server first.
  if (!rows[index + step] && step > 0 && index >= 0 && (await loadMoreReview())) rows = filteredReviewOffers();
  const target = rows[index + step];
  if (!target) return;
  document.querySelector('[data-review-id="' + CSS.escape(target.id) + '"]')?.click();
}

/** Next page of the review queue (button at the end of the list, scrolling, ↓ past the end). */
let loadingMoreReview = null;
function loadMoreReview() {
  const page = state.catalogPages.jobs;
  if (page.offset >= page.total) return Promise.resolve(false);
  loadingMoreReview ||= loadCatalogPage('jobs')
    .then((loaded) => {
      if (loaded) renderReview();
      return loaded;
    })
    .catch((error) => {
      toast('Nie udało się wczytać dalszych ofert: ' + error.message);
      return false;
    })
    .finally(() => {
      loadingMoreReview = null;
    });
  return loadingMoreReview;
}

let reviewSearchRequest = 0;
let reviewSearchTimer = null;
function renderReviewBookChoices(query = '', works = state.catalogWorks) {
  const list = $('#reviewBookOptions'),
    input = $('#reviewBookSearch');
  if (!list || !input) return;
  const needle = query.trim().toLocaleLowerCase('pl');
  // A book with several editions comes first as "the book" (edition not named), then its editions.
  const editions = works
    .flatMap((work) => [
      ...(work.editions.length > 1 ? [{ work, edition: null }] : []),
      ...work.editions.map((edition) => ({ work, edition })),
    ])
    .filter(
      ({ work, edition }) =>
        !needle ||
        `${work.title} ${work.authors.join(' ')} ${(edition ? edition.identifiers : work.editions.flatMap((item) => item.identifiers)).map((row) => row.value).join(' ')}`
          .toLocaleLowerCase('pl')
          .includes(needle),
    )
    .slice(0, 30);
  list.innerHTML = editions.length
    ? editions
        .map(({ work, edition }) =>
          edition
            ? `<button type="button" role="option" data-review-edition-id="${escapeHtml(edition.id)}" data-review-book-title="${escapeHtml(work.title)}"><strong>${escapeHtml(work.title)}</strong><small>${escapeHtml(edition.identifiers.find((row) => row.scheme.startsWith('isbn'))?.value || 'Bez ISBN')} - ${escapeHtml([edition.publisher || 'wydawca nieznany', edition.publicationYear].filter(Boolean).join(', '))}</small></button>`
            : `<button type="button" role="option" class="is-work-option" data-review-edition-id="" data-review-work-id="${escapeHtml(work.id)}" data-review-book-title="${escapeHtml(work.title)}"><strong>${escapeHtml(work.title)}</strong><small>cała książka — ${work.editions.length} ${[2, 3, 4].includes(work.editions.length % 10) && ![12, 13, 14].includes(work.editions.length % 100) ? 'wydania' : 'wydań'}, wydanie nieustalone</small></button>`,
        )
        .join('')
    : '<p>Brak rekordów pasujących do wpisanej frazy.</p>';
  $$('[data-review-edition-id]').forEach((button) =>
    button.addEventListener('click', () => {
      input.value = button.dataset.reviewBookTitle;
      input.dataset.editionId = button.dataset.reviewEditionId;
      input.dataset.workId = button.dataset.reviewWorkId || '';
      $('#reviewChosenEdition').textContent = button.dataset.reviewWorkId
        ? `Wybrana książka: ${button.dataset.reviewBookTitle} — wydanie nieustalone`
        : `Wybrane ręcznie: ${button.dataset.reviewBookTitle}`;
      input.setAttribute('aria-expanded', 'false');
      list.innerHTML = '';
      list.classList.remove('is-open');
      $('#approveReview').disabled = false;
    }),
  );
}

/**
 * "This book, edition not settled" (key N): the chosen proposal, or the first one. A catalogue
 * proposal names the book; a BN / Open Library proposal names it by ISBN (the server finds or adds
 * the book). The offer goes to the book's unknown edition — or to the edition the listing points at.
 */
function approveAsBook() {
  const proposals = [...document.querySelectorAll('#reviewProposals .rv-cand')];
  if (!proposals.length) return toast('Brak propozycji: wybierz książkę w wyszukiwarce poniżej.');
  // Without a chosen proposal only when every proposal is the same title (editions differing by
  // year or publisher); otherwise the first one may be another book of the series.
  const titleOf = (button) =>
    (button.dataset.proposalTitle || button.querySelector('.rv-cand-body > b')?.textContent || '')
      .toLocaleLowerCase('pl')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  const chosen = proposals.find((button) => button.classList.contains('is-chosen'));
  const target = chosen || (new Set(proposals.map(titleOf)).size === 1 ? proposals[0] : null);
  if (!target) return toast('Propozycje to różne książki: wybierz jedną klawiszem 1–9, potem N.');
  if (target.dataset.proposalWork) return decideReview('approved', null, null, target.dataset.proposalWork);
  if (target.dataset.proposalIsbn) return decideReview('approved', null, null, null, target.dataset.proposalIsbn);
}

async function approveReview() {
  const { editionId, workId } = $('#reviewBookSearch').dataset;
  if (editionId) return decideReview('approved', editionId);
  if (workId) return decideReview('approved', null, null, workId);
}

let reviewDecisionPending = false;
async function decideReview(action, editionId = null, reason = null, workId = null, bookIsbn = null) {
  const jobId = state.selectedReviewId;
  if (!jobId || reviewDecisionPending) return;
  const position=filteredReviewOffers().findIndex(row=>row.id===jobId);
  reviewDecisionPending = true;
  const buttons = ['approveReview', 'approveBook', 'rejectProposal', 'rejectReview', 'markAsSet', 'requeueReview']
    .map((id) => $('#' + id))
    .filter(Boolean);
  const disabledBefore = buttons.map((button) => button.disabled);
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const saved = await json(`/api/identification-jobs/${encodeURIComponent(jobId)}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, editionId, reason, ...(workId ? { workId } : {}), ...(bookIsbn ? { bookIsbn } : {}) }),
    });
    state.selectedReviewId = null;
    state.reviewDetail = null;
    const refreshed = await loadCatalogData();
    if (refreshed !== false) {
      const after=filteredReviewOffers();
      const next = after[Math.min(Math.max(position,0),after.length-1)];
      if (next) {
        state.selectedReviewId = next.id;
        try {
          state.reviewDetail = await json(`/api/offers/${encodeURIComponent(next.offerId)}`);
        } catch {
          state.reviewDetail = null;
        }
        renderReview();
      }
    }
    if (action === 'excluded' && refreshed !== false) {
      toast('Oferta została odrzucona.', {
        label: 'Cofnij',
        onClick: async () => {
          const reopened = await json(`/api/review-decisions/${encodeURIComponent(saved.decision.id)}/reopen`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
          });
          await loadCatalogData();
          state.selectedReviewId = reopened.jobId;
          state.reviewDetail = null;
          renderReview();
        },
        onError: () => toast('Nie udało się cofnąć decyzji. Oferta mogła zostać już zmieniona.'),
      });
    } else toast(refreshed === false
      ? 'Decyzja zapisana w SQLite, ale nie udało się odświeżyć widoku.'
      : (workId || bookIsbn) && saved?.decision?.unknownEdition === false
        ? 'Zapisano: książka z wydaniem wskazanym w ogłoszeniu. Możesz to poprawić w historii decyzji.'
        : 'Zapisano decyzję. Możesz ją poprawić w historii decyzji.');
  } catch (error) {
    toast(`Nie udało się zapisać decyzji: ${error.message}`);
  } finally {
    reviewDecisionPending = false;
    buttons.forEach((button, index) => {
      if (button.isConnected) button.disabled = disabledBefore[index];
    });
  }
}

installPhotoZoom($('#reviewDetail'));
document.addEventListener('click', (event) => {
  const more = document.querySelector('#reviewDetail .rv-more[open]');
  if (more && !more.contains(event.target)) more.open = false;
});

// Keyboard-first review. Plain keys work when no text field has focus; Alt+key works everywhere.
// Decisions still go through the same buttons, so every guard (disabled state, pending) applies.
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.shiftKey) return;
  const view = document.querySelector('#view-review');
  if (!view || view.hidden || document.querySelector('dialog[open]')) return;
  // While ticking several offers, single-offer shortcuts (Enter, X, Z…) would act on the hidden detail.
  if (bulk.isSelecting()) return;
  // Batch grid: Enter approves the ticked cards, Esc goes to one offer at a time.
  if (batch.active()) {
    if (event.key === 'Enter' && !event.target?.closest?.('button,a,summary,textarea')) {
      event.preventDefault();
      void batch.apply();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      batch.single();
    }
    return;
  }
  const typing = event.target?.closest?.('input,select,textarea,[contenteditable="true"]');
  if (typing && !event.altKey) {
    if (event.key === 'Enter' && event.target.id === 'reviewIsbnCheckInput') {
      event.preventDefault();
      $('#reviewIsbnMatchButton')?.click();
    }
    if (event.key === 'Escape') event.target.blur();
    return;
  }
  const key = event.key.length === 1 ? event.key.toLocaleLowerCase('pl') : event.key;
  const press = (selector) => {
    const button = $(selector);
    if (button && !button.disabled) button.click();
  };
  if (key === 'Enter') {
    // A focused ordinary button keeps its own Enter behaviour.
    if (!event.altKey && event.target?.closest?.('button:not(.rv-cand),a,summary')) return;
    event.preventDefault();
    return press($('#createOfferEdition:not([hidden])') ? '#createOfferEdition' : '#approveReview');
  }
  if (/^[1-9]$/.test(key)) {
    event.preventDefault();
    return document.querySelectorAll('#reviewProposals .rv-cand')[Number(key) - 1]?.click();
  }
  const actions = {
    x: () => press('#rejectReview'),
    r: () => press('#rejectWithRule'),
    z: () => press('#markAsSet'),
    n: () => press('#approveBook'),
    s: () => skipReview(),
    ArrowRight: () => skipReview(),
    f: () => toggleReviewFocus(),
    Escape: () => toggleReviewFocus(false),
    '/': () => $('#reviewSearch')?.focus(),
    i: () => $('#reviewIsbnCheckInput')?.focus(),
    ArrowDown: () => navigateReview(1),
    j: () => navigateReview(1),
    ArrowUp: () => navigateReview(-1),
    k: () => navigateReview(-1),
  };
  if (!actions[key]) return;
  event.preventDefault();
  actions[key]();
});

// Phone: a horizontal swipe on the offer moves through the queue — left skips to the next offer,
// right goes back. Nothing is approved or rejected by a gesture; those stay explicit taps.
let swipeStart = null;
$('#reviewDetail').addEventListener('touchstart', (event) => {
  const touch = event.touches[0];
  const inControl = event.target.closest('input, textarea, select, .series-shelf, .rv-cands, [contenteditable]');
  swipeStart = event.touches.length === 1 && !inControl ? { x: touch.clientX, y: touch.clientY, at: Date.now() } : null;
}, { passive: true });
$('#reviewDetail').addEventListener('touchend', (event) => {
  if (!swipeStart || reviewDecisionPending) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - swipeStart.x;
  const dy = touch.clientY - swipeStart.y;
  const quick = Date.now() - swipeStart.at < 600;
  swipeStart = null;
  if (!quick || Math.abs(dx) < 90 || Math.abs(dy) > 60) return;
  if (dx < 0) skipReview();
  else navigateReview(-1);
}, { passive: true });

return { filteredReviewOffers, visibleCatalogRows, renderReview, loadMoreReview, normalizedIsbn, reviewCandidateMarkup, renderReviewDetail, renderReviewBookChoices, approveReview, decideReview };
}

/**
 * Whether the first catalogue candidate is clear enough to preselect, and a note for the operator.
 * Editions of one work share the work's score, so "tie" only counts between different works.
 */
export function localPreselection(items = []) {
  const [first] = items;
  if (!first) return { preselect: false, tie: false, note: '' };
  const rivals = items.filter((item) => item.workId !== first.workId);
  const bestRival = rivals.reduce((best, item) => Math.max(best, item.score), 0);
  // One item per book now (editionCount); older per-edition lists are counted the old way.
  const editions = first.editionCount ?? items.filter((item) => item.workId === first.workId).length;
  const tie = rivals.length > 0 && first.score - bestRival < 0.03;
  const preselect = !tie && first.score >= 0.85 && first.score - bestRival >= 0.06;
  const note = tie
    ? 'Różne książki z prawie tym samym wynikiem — porównaj okładki, autora i tom ze zdjęciem.'
    : editions > 1
      ? first.editionCount != null && !first.editionId
        ? `${editions} wydania tej książki — ogłoszenie nie wskazuje które; przypiszesz książkę, a wydanie uzupełnisz później w katalogu (jeśli zechcesz).`
        : `${editions} wydania tej samej książki — ${preselect ? (first.editionCount != null ? 'zaznaczono wydanie wskazane przez ogłoszenie; ' : 'zaznaczono najczęściej używane; ') : ''}sprawdź wydawcę i okładkę.`
      : '';
  return { preselect, tie, note };
}
