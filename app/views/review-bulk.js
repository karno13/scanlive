// Multi-select in "Do weryfikacji": tick several offers and apply one action to all of them
// (assign to one edition, mark as sets, send back to identification, reject). Every action is
// confirmed first and goes through the same endpoints as a single decision, one offer at a time,
// so protected manual assignments and other guards still apply per offer.
import { confirmDialog } from '../core/dialogs.js';

const isbnOf = (edition) => edition.identifiers?.find((item) => String(item.scheme).startsWith('isbn'))?.value || 'bez ISBN';
const plural = (n, one, few, many) => {
  if (n === 1) return one;
  const last = n % 10, lastTwo = n % 100;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
};
const offersWord = (n) => `${n} ${plural(n, 'ofertę', 'oferty', 'ofert')}`;

const ERRORS = {
  MANUAL_ASSIGNMENT_PROTECTED: 'ma ręczne przypisanie do innego wydania',
  IDENTIFICATION_JOB_NOT_FOUND: 'już rozstrzygnięta',
  EDITION_NOT_FOUND: 'wydanie nie istnieje',
};

export function createReviewBulk({ state, $, json, toast, escapeHtml, loadCatalogData, filteredRows, rerender, loadAllRows = async () => {} }) {
  state.reviewSelection ??= new Set();
  state.reviewSelectMode ??= false;
  let lastClickedId = null;
  let running = false;
  let searchTimer = null;
  let searchSerial = 0;

  const bar = $('#reviewBulkBar');
  const toggle = $('#reviewSelectToggle');
  const selectedJobs = () => (state.reviewJobs || []).filter((job) => state.reviewSelection.has(job.id));

  function setMode(on) {
    state.reviewSelectMode = on;
    if (!on) state.reviewSelection.clear();
    lastClickedId = null;
    document.body.classList.toggle('review-selecting', on);
    toggle?.setAttribute('aria-pressed', String(on));
    if (toggle) toggle.textContent = on ? 'Zakończ zaznaczanie' : 'Zaznacz wiele';
    rerender();
  }
  toggle?.addEventListener('click', () => setMode(!state.reviewSelectMode));

  /** Click on a list item in select mode. Shift+click selects the range from the last click. */
  function handleItemClick(id, event) {
    if (running) return;
    const rows = filteredRows();
    if (event?.shiftKey && lastClickedId) {
      const from = rows.findIndex((row) => row.id === lastClickedId);
      const to = rows.findIndex((row) => row.id === id);
      if (from >= 0 && to >= 0) {
        const select = !state.reviewSelection.has(id) || state.reviewSelection.has(lastClickedId);
        for (const row of rows.slice(Math.min(from, to), Math.max(from, to) + 1))
          select ? state.reviewSelection.add(row.id) : state.reviewSelection.delete(row.id);
      }
    } else if (state.reviewSelection.has(id)) state.reviewSelection.delete(id);
    else state.reviewSelection.add(id);
    lastClickedId = id;
    rerender();
  }

  /** Item markup additions: checkbox and selected class (only in select mode). */
  function itemExtras(id) {
    if (!state.reviewSelectMode) return { className: '', checkbox: '', pressed: '' };
    const on = state.reviewSelection.has(id);
    return { className: on ? ' is-selected' : '', checkbox: `<span class="rv-check" aria-hidden="true">${on ? '✓' : ''}</span>`, pressed: ` aria-pressed="${on}"` };
  }

  // Skeleton built once, so an open edition search survives selection changes.
  if (bar) {
    bar.innerHTML = `<div class="rv-bulk-head"><strong data-bulk-count></strong><small>Shift+klik zaznacza zakres.</small><span class="rv-bulk-links"><button type="button" class="link-button" data-bulk-all></button><button type="button" class="link-button" data-bulk-clear>Wyczyść</button></span></div>
      <div class="rv-bulk-actions"><button type="button" class="button primary compact" data-bulk="assign">Przypisz do wydania…</button><button type="button" class="button secondary compact" data-bulk="set">Oznacz jako zestawy</button><button type="button" class="button secondary compact" data-bulk="requeue">Ponów identyfikację</button><button type="button" class="button secondary compact danger-text" data-bulk="reject">Odrzuć</button></div>
      <div class="rv-bulk-picker" hidden><label class="field"><span>Wydanie dla wszystkich zaznaczonych</span><input type="search" data-bulk-query placeholder="Tytuł, autor, tłumacz lub ISBN" maxlength="120"></label><div class="offer-assignment-results" data-bulk-results aria-live="polite"></div></div>
      <p class="inline-note" data-bulk-status role="status"></p>`;
    bar.querySelector('[data-bulk-all]').addEventListener('click', async () => {
      // The whole filtered queue, not only the pages loaded so far.
      try {
        await loadAllRows();
      } catch (error) {
        toast('Nie udało się wczytać całej kolejki: ' + error.message);
      }
      const rows = filteredRows();
      const all = rows.length > 0 && rows.every((row) => state.reviewSelection.has(row.id));
      rows.forEach((row) => (all ? state.reviewSelection.delete(row.id) : state.reviewSelection.add(row.id)));
      rerender();
    });
    bar.querySelector('[data-bulk-clear]').addEventListener('click', () => { state.reviewSelection.clear(); rerender(); });
    bar.querySelector('[data-bulk="assign"]').addEventListener('click', openPicker);
    bar.querySelector('[data-bulk="set"]').addEventListener('click', () => void bulkSets());
    bar.querySelector('[data-bulk="requeue"]').addEventListener('click', () => void bulkDecision('requeued'));
    bar.querySelector('[data-bulk="reject"]').addEventListener('click', () => void bulkDecision('excluded'));
    bar.querySelector('[data-bulk-query]').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => void search(), 300);
    });
  }

  function renderBar() {
    if (!bar) return;
    bar.hidden = !state.reviewSelectMode;
    const picker = bar.querySelector('.rv-bulk-picker');
    if (!state.reviewSelectMode) { picker.hidden = true; return; }
    const rows = filteredRows();
    const known = new Set((state.reviewJobs || []).map((job) => job.id));
    // Drop selections whose job is no longer pending (decided elsewhere, refreshed).
    for (const id of state.reviewSelection) if (!known.has(id)) state.reviewSelection.delete(id);
    const count = state.reviewSelection.size;
    const allVisibleSelected = rows.length > 0 && rows.every((row) => state.reviewSelection.has(row.id));
    bar.querySelector('[data-bulk-count]').textContent = count ? 'Zaznaczono: ' + count : 'Kliknij oferty, aby je zaznaczyć';
    const page = state.catalogPages?.jobs;
    const pending = page && page.offset < page.total ? page.total : rows.length;
    bar.querySelector('[data-bulk-all]').textContent = allVisibleSelected ? 'Odznacz wszystkie z filtra' : `Zaznacz wszystkie z filtra (${pending})`;
    bar.querySelector('[data-bulk-clear]').hidden = !count;
    bar.querySelectorAll('[data-bulk]').forEach((button) => { button.disabled = running || !count; });
    bar.querySelectorAll('[data-bulk-all],[data-bulk-clear],[data-bulk-query],[data-bulk-results] button').forEach((element) => { element.disabled = running; });
    if (!count) picker.hidden = true;
  }

  // Edition search for "assign all to one edition"; starts from the first selected offer's title.
  function openPicker() {
    const picker = bar.querySelector('.rv-bulk-picker');
    picker.hidden = !picker.hidden;
    if (picker.hidden) return;
    const input = picker.querySelector('[data-bulk-query]');
    const first = selectedJobs()[0];
    if (!input.value && first) input.value = String(first.offer?.title || '').split(/\s+/).slice(0, 2).join(' ');
    input.focus();
    void search();
  }

  async function search() {
    const input = bar.querySelector('[data-bulk-query]');
    const results = bar.querySelector('[data-bulk-results]');
    const query = input.value.trim();
    const request = ++searchSerial;
    if (query.length < 2) { results.innerHTML = '<p class="inline-note">Wpisz co najmniej 2 znaki.</p>'; return; }
    results.innerHTML = '<p class="inline-note">Szukam…</p>';
    try {
      const data = await json('/api/catalog/works?' + new URLSearchParams({ query, limit: '15' }));
      if (request !== searchSerial) return;
      const editions = data.items.flatMap((work) => work.editions.map((edition) => ({ ...edition, authors: work.authors })));
      results.innerHTML = editions.length
        ? editions
            .map((edition) => `<button type="button" class="offer-assignment-option" data-edition="${escapeHtml(edition.id)}"><strong>${escapeHtml(edition.title)}</strong><small>${escapeHtml([edition.authors?.[0], edition.publisher, edition.publicationYear, edition.binding, isbnOf(edition)].filter(Boolean).join(' · '))}</small></button>`)
            .join('')
        : '<p class="inline-note">Nic nie znaleziono. Jeśli wydania nie ma w katalogu, dodaj je przez weryfikację ISBN jednej z ofert.</p>';
      results.querySelectorAll('[data-edition]').forEach((button) =>
        button.addEventListener('click', () => void bulkAssign(editions.find((edition) => edition.id === button.dataset.edition))),
      );
    } catch (error) {
      if (request === searchSerial) results.innerHTML = `<p class="inline-note">Nie udało się wyszukać: ${escapeHtml(error.message)}</p>`;
    }
  }

  /** Runs one request per selected job; failed ones stay selected so they can be retried. */
  async function runBulk(label, jobs, perJob) {
    running = true;
    renderBar();
    const status = bar.querySelector('[data-bulk-status]');
    let done = 0;
    const failures = [];
    for (const [index, job] of jobs.entries()) {
      status.textContent = `${label}: ${index + 1} z ${jobs.length}…`;
      try {
        await perJob(job);
        done++;
        state.reviewSelection.delete(job.id);
        state.skippedReviewIds?.delete(job.id);
        if (state.selectedReviewId === job.id) { state.selectedReviewId = null; state.reviewDetail = null; }
      } catch (error) {
        failures.push({ job, reason: ERRORS[error.message] || error.message });
      }
    }
    running = false;
    bar.querySelector('.rv-bulk-picker').hidden = true;
    const refreshed = await loadCatalogData();
    if (refreshed === false) rerender();
    else renderBar();
    const summary = `${label}: ${done} z ${jobs.length}.` + (failures.length ? ` Nie udało się: ${failures.length} (zostały zaznaczone).` : '');
    toast(summary);
    status.textContent = failures.length
      ? summary + ' ' + failures.slice(0, 5).map((item) => `„${String(item.job.offer?.title || '').slice(0, 40)}” — ${item.reason}`).join('; ')
      : '';
  }

  const decide = (job, body) =>
    json(`/api/identification-jobs/${encodeURIComponent(job.id)}/decision`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });

  async function bulkAssign(edition) {
    const jobs = selectedJobs();
    if (!edition || !jobs.length || running) return;
    const ok = await confirmDialog(
      `Przypisać ${offersWord(jobs.length)} do wydania „${edition.title}” (${[edition.publisher, edition.publicationYear, isbnOf(edition)].filter(Boolean).join(', ')})? Każda zapisze się jako ręczna decyzja.`,
      { title: 'Przypisanie zaznaczonych', confirmLabel: 'Przypisz wszystkie' },
    );
    if (!ok) return;
    await runBulk('Przypisano', jobs, (job) => decide(job, { action: 'approved', editionId: edition.id, reason: 'Przypisane zbiorczo podczas weryfikacji.' }));
  }

  async function bulkDecision(action) {
    const jobs = selectedJobs();
    if (!jobs.length || running) return;
    const reject = action === 'excluded';
    const ok = await confirmDialog(
      reject
        ? `Odrzucić ${offersWord(jobs.length)}? Znikną z weryfikacji. Każdą decyzję można cofnąć w „Ostatnie decyzje i poprawianie pomyłek”.`
        : `Wysłać ${offersWord(jobs.length)} ponownie do automatycznej identyfikacji? Może to wykonać zapytania do zewnętrznych źródeł.`,
      { title: reject ? 'Odrzucenie zaznaczonych' : 'Ponowna identyfikacja', confirmLabel: reject ? 'Odrzuć wszystkie' : 'Ponów', danger: reject },
    );
    if (!ok) return;
    await runBulk(reject ? 'Odrzucono' : 'Ponowiono', jobs, (job) =>
      decide(job, { action, reason: reject ? 'Odrzucono zbiorczo podczas weryfikacji.' : 'Ponowiono zbiorczo podczas weryfikacji.' }),
    );
  }

  async function bulkSets() {
    const jobs = selectedJobs();
    if (!jobs.length || running) return;
    const ok = await confirmDialog(
      `Oznaczyć ${offersWord(jobs.length)} jako zestawy? Znikną z weryfikacji pojedynczych książek; skład ustawisz w zakładce Zestawy.`,
      { title: 'Oznaczanie jako zestawy', confirmLabel: 'Oznacz jako zestawy' },
    );
    if (!ok) return;
    await runBulk('Oznaczono jako zestawy', jobs, (job) =>
      json('/api/sets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ offerId: job.offerId }) }),
    );
  }

  return { handleItemClick, itemExtras, renderBar, isSelecting: () => state.reviewSelectMode, isRunning: () => running };
}
