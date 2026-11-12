import { openDetailView } from '../core/detail-navigation.js';
import { money, safeOfferHref } from '../core/formatters.js';
import { confirmDiscard } from '../core/ux.js';
import { mountSetTrading } from './set-trading.js';
import { confirmDialog } from '../core/dialogs.js';
import { coverMarkup, tidyOfferTitle, tidyWorkTitle, isbnCover, parseBnPeople, cleanPublisher } from '../core/bibliography.js';

// Sets: one marketplace offer that holds several books. Laid out like the review workspace: the
// list with photos on the left; on the right the listing (photo, price, link to check what is
// really in it), the books already in the set, suggestions from the catalogue (the works and
// cycles the listing names), search, unrecognised items and the composition check.
const TABS = [
  ['', 'Wszystkie'],
  ['empty', 'Do uzupełnienia'],
  ['open', 'Niepotwierdzone'],
  ['confirmed', 'Potwierdzone'],
  ['dismissed', 'Nie interesują mnie'],
];
// "Nie interesuje mnie" (from the list, review 11.2026 stage 2) takes a set out of every other tab.
const stateOf = (set) => (set.dismissedAt ? 'dismissed' : set.compositionConfirmed ? 'confirmed' : set.editions.length || set.unknownItems?.length ? 'open' : 'empty');
/**
 * Third line of a set row. An empty set already says "brak książek" on the line above, so it gets
 * no badge; colour is kept for the states that need a look.
 */
function setRowNote(status, availability) {
  const parts = [
    status === 'empty' ? '' : `<span class="proposal-chip is-${status === 'confirmed' ? 'high' : 'medium'}">${STATE_LABEL[status]}</span>`,
    ['not_seen', 'sold', 'unavailable'].includes(availability) ? '<span class="proposal-chip is-stale">mogła zniknąć</span>' : '',
  ].filter(Boolean);
  return parts.length ? `<small>${parts.join(' · ')}</small>` : '';
}
const STATE_LABEL = { empty: 'pusty', open: 'skład do potwierdzenia', confirmed: 'skład potwierdzony' };
const books = (count) =>
  count === 1 ? '1 książka' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? `${count} książki` : `${count} książek`;
const setsWord = (count) =>
  count === 1 ? '1 zestaw' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? `${count} zestawy` : `${count} zestawów`;

export function createSetsView({ $, json, escapeHtml, toast, openOfferDrawer, onSelect = () => {} }) {
  let sets = [];
  let activeId = null;
  let tab = '';
  let searchSerial = 0;
  let suggestionSerial = 0;
  let editionSearchTimer = null;
  const request = (method, path, body) => json(path, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const safe = (value) => escapeHtml(String(value ?? ''));
  const active = () => sets.find((item) => item.offerId === activeId) || null;
  const included = () => new Set((active()?.editions || []).map((item) => item.editionId));

  // Most expensive first by default (resale value); offers without a price last. "Ostatnio
  // zmienione" keeps the server's order.
  function filtered() {
    const needle = $('#setFilter').value.trim().toLocaleLowerCase('pl');
    const rows = sets.filter((item) => (tab ? stateOf(item) === tab : stateOf(item) !== 'dismissed') && `${item.title} ${item.source}`.toLocaleLowerCase('pl').includes(needle));
    if ($('#setSort')?.value !== 'recent')
      rows.sort((a, b) => (a.currentPrice == null) - (b.currentPrice == null) || (b.currentPrice ?? 0) - (a.currentPrice ?? 0));
    return rows;
  }

  function renderTabs() {
    const counts = Object.fromEntries(TABS.map(([key]) => [key, key ? sets.filter((item) => stateOf(item) === key).length : sets.filter((item) => stateOf(item) !== 'dismissed').length]));
    $('#setTabs').innerHTML = TABS.filter(([key]) => key !== 'dismissed' || counts.dismissed || tab === 'dismissed').map(([key, label]) =>
      `<button type="button" class="rv-tab${key === tab ? ' is-active' : ''}" data-set-tab="${key}" aria-pressed="${key === tab}">${safe(label)} <span>${counts[key]}</span></button>`).join('');
    $('#setTabs').querySelectorAll('[data-set-tab]').forEach((button) => button.addEventListener('click', () => {
      tab = button.dataset.setTab;
      renderTabs();
      renderList();
    }));
  }

  function renderList() {
    const rows = filtered();
    $('#setTotal').textContent = setsWord(sets.filter((item) => !item.dismissedAt).length);
    $('#setList').innerHTML = rows.length ? rows.map((row) => {
      const title = tidyOfferTitle(row.title);
      const count = row.editions.reduce((sum, item) => sum + (item.quantity || 1), 0) + (row.unknownItems || []).reduce((sum, item) => sum + item.quantity, 0);
      const status = stateOf(row);
      const dismissed = status === 'dismissed';
      return `<div class="set-row${dismissed ? ' is-dismissed' : ''}"><button class="review-item rv-item ${row.offerId === activeId ? 'active' : ''}" type="button" data-set-id="${safe(row.offerId)}" aria-current="${row.offerId === activeId}" title="${safe(row.title)}">
        ${coverMarkup(row.image, title, { size: 'sm', escapeHtml })}
        <span class="rv-item-copy"><strong>${safe(title)}</strong>
          <small><span class="source-dot" data-source="${safe(row.source)}"></span>${safe(row.source)} · ${count ? books(count) : 'brak książek'}</small>
          ${setRowNote(status, row.availability)}</span>
        <span class="review-price">${money(row.currentPrice)}</span></button><button type="button" class="set-dismiss" data-set-dismiss="${safe(row.offerId)}" data-dismissed="${dismissed}" title="${dismissed ? 'Przywróć do kolejki' : 'Nie interesuje mnie — zestaw znika z kolejki (klawisz X)'}" aria-label="${dismissed ? 'Przywróć' : 'Nie interesuje mnie'}: ${safe(title)}">${dismissed ? 'Przywróć' : '<span aria-hidden="true">✕</span>'}</button></div>`;
    }).join('') : '<div class="empty-detail"><h3>Brak zestawów</h3><p>Zmień filtr albo oznacz ofertę jako zestaw w weryfikacji (klawisz Z).</p></div>';
    $('#setList').querySelectorAll('[data-set-id]').forEach((button) => button.addEventListener('click', () => selectSet(button.dataset.setId)));
    $('#setList').querySelectorAll('[data-set-dismiss]').forEach((button) =>
      button.addEventListener('click', () => void dismiss(button.dataset.setDismiss, button.dataset.dismissed !== 'true')),
    );
  }

  /** "Nie interesuje mnie" (or "Przywróć") without opening the set; the next set takes its place. */
  async function dismiss(offerId, dismissed = true) {
    const rows = filtered();
    const index = rows.findIndex((row) => row.offerId === offerId);
    const next = rows[index + 1] || rows[index - 1] || null;
    try {
      await request('POST', '/api/sets/' + encodeURIComponent(offerId) + '/dismiss', { dismissed });
      await refreshSets(offerId === activeId && dismissed ? next?.offerId ?? null : activeId);
      toast(dismissed ? 'Zestaw usunięty z kolejki.' : 'Zestaw wrócił do kolejki.', dismissed ? {
        label: 'Cofnij',
        onClick: async () => { await request('POST', '/api/sets/' + encodeURIComponent(offerId) + '/dismiss', { dismissed: false }); await refreshSets(offerId); },
        onError: () => toast('Nie udało się cofnąć.'),
      } : null);
    } catch (error) {
      toast('Nie zapisano: ' + error.message);
    }
  }

  // The queue's shortcuts (same keys as Weryfikacja): ↑/↓ or K/J move, S next, Enter confirms the
  // composition when it can be confirmed, X "Nie interesuje mnie".
  document.addEventListener('keydown', (event) => {
    const view = document.querySelector('#view-sets');
    if (!view || view.hidden || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (document.querySelector('dialog[open]') || event.target?.closest?.('input,select,textarea,[contenteditable="true"]')) return;
    const key = event.key.length === 1 ? event.key.toLocaleLowerCase('pl') : event.key;
    if (key === 'Enter' && event.target?.closest?.('button,a,summary')) return;
    const rows = filtered();
    const index = rows.findIndex((row) => row.offerId === activeId);
    const move = (step) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, (index < 0 ? 0 : index + step)))];
      if (target) void selectSet(target.offerId);
    };
    const actions = {
      ArrowDown: () => move(1), j: () => move(1), s: () => move(1),
      ArrowUp: () => move(-1), k: () => move(-1),
      x: () => activeId && !active()?.dismissedAt && dismiss(activeId),
      Enter: () => {
        const box = document.querySelector('#setUnknown [data-set-confirm]');
        if (box && !box.disabled && !box.checked) box.click();
      },
    };
    if (!actions[key]) return;
    event.preventDefault();
    actions[key]();
  });

  async function selectSet(id) {
    if (id === activeId) { openDetailView('sets'); return; }
    if (!await confirmDiscard()) return;
    openDetailView('sets');
    activeId = id;
    $('#setCurrent').value = id || '';
    renderList();
    renderDetail();
    if (matchMedia('(min-width: 901px)').matches) $('#setList .active')?.scrollIntoView({ block: 'nearest' });
    onSelect();
  }

  async function refreshSets(preferred = null) {
    const response = await json('/api/sets');
    sets = response.items || [];
    const selected = preferred || activeId;
    activeId = sets.some((item) => item.offerId === selected) ? selected : filtered()[0]?.offerId || sets[0]?.offerId || null;
    $('#setCurrent').innerHTML = sets.map((item) => `<option value="${safe(item.offerId)}">${safe(item.title)}</option>`).join('');
    $('#setCurrent').value = activeId || '';
    renderTabs();
    renderList();
    renderDetail();
    onSelect();
  }

  function editionCard(item, { action, member = false }) {
    const title = tidyWorkTitle(item.workTitle || item.title);
    const author = parseBnPeople([].concat(item.authors || []).join(' '), [].concat(item.authors || []))[0] || '';
    // Why it is proposed: the ISBN the seller filled in (often one volume of the set), a cycle volume.
    const facts = [item.fromIsbn ? 'ISBN podany w ogłoszeniu' : '', item.cycle ? item.cycle + (item.volume ? ' · t. ' + item.volume : '') : '', item.publicationYear, cleanPublisher(item.publisher || ''), item.isbn ? 'ISBN ' + item.isbn : '']
      .filter(Boolean).map((text) => `<span class="fact">${safe(text)}</span>`).join('');
    return `<li class="sets-card${member ? ' is-member' : ''}">${coverMarkup(item.cover || isbnCover(item.isbn), title, { size: 'sm', escapeHtml })}
      <span class="rv-cand-body"><b>${safe(title)}</b>${author ? `<small>${safe(author)}</small>` : ''}<span class="rv-facts">${facts}</span></span>${action}</li>`;
  }

  function renderDetail() {
    const set = active();
    $('#setSelectedTitle').textContent = set ? tidyOfferTitle(set.title) : 'Wybierz zestaw z listy';
    $('#setSelectedTitle').title = set?.title || '';
    $('#setPrice').textContent = set ? money(set.currentPrice) : '';
    const link = $('#setOfferLink');
    link.hidden = !set;
    if (set) link.href = safeOfferHref(set.url);
    $('#setKicker').innerHTML = set
      ? `<span class="source-chip" data-source="${safe(set.source)}">${safe(set.source)}</span>${set.lastSeenAt ? `<span>widziana ${safe(new Date(set.lastSeenAt).toLocaleDateString('pl-PL'))}</span>` : ''}${['not_seen', 'sold', 'unavailable'].includes(set.availability) ? '<span class="proposal-chip is-stale">mogła zniknąć</span>' : ''}`
      : '';
    document.querySelector('#view-sets .sets-search-panel').hidden = !set;
    $('#setBulkPanel').hidden = !set;
    if (!set) {
      $('#setSelectedMeta').textContent = 'Zawartość zestawu pojawi się tutaj.';
      $('#setPhoto').innerHTML = '';
      $('#setMembers').innerHTML = '<p class="sets-empty">Wybierz zestaw po lewej stronie.</p>';
      for (const id of ['#setSuggestions', '#setUnknown', '#setActions', '#setTradingMount', '#setEditionResults']) $(id).innerHTML = '';
      $('#setSelectedCount').textContent = '';
      return;
    }
    const known = set.editions.reduce((sum, item) => sum + (item.quantity || 1), 0);
    const unknown = (set.unknownItems || []).reduce((sum, item) => sum + item.quantity, 0);
    $('#setSelectedMeta').textContent = stateOf(set) === 'empty' ? 'Skład do ustalenia — dodaj książki z propozycji albo z wyszukiwarki' : `${STATE_LABEL[stateOf(set)][0].toUpperCase()}${STATE_LABEL[stateOf(set)].slice(1)} · ${books(known + unknown)}${unknown ? ` (${unknown} nierozpoznanych)` : ''}`;
    $('#setSelectedCount').textContent = set.editions.length ? `${known} egz. z katalogu` : '';
    $('#setPhoto').innerHTML = `${coverMarkup(set.image, tidyOfferTitle(set.title), { size: 'xl', escapeHtml })}<figcaption>Zdjęcie z ogłoszenia · <a href="${safe(safeOfferHref(set.url))}" target="_blank" rel="noreferrer">pełna treść i więcej zdjęć w ogłoszeniu ↗</a></figcaption>`;
    renderMembers(set);
    renderUnknown(set);
    renderActions(set);
    $('#setEditionResults').innerHTML = '';
    $('#setDescriptionResults').innerHTML = '';
    $('#setRangeResult').textContent = '';
    void renderSuggestions(set);
    $('#setTradingMount').innerHTML = '';
    mountSetTrading({ active: set, target: $('#setTradingMount'), json, refresh: refreshSets, toast });
  }

  function renderMembers(set) {
    const target = $('#setMembers');
    if (!set.editions.length) {
      target.innerHTML = '<p class="sets-empty">Brak książek. Otwórz ogłoszenie, sprawdź, co jest w zestawie, i dodaj książki z propozycji albo z wyszukiwarki poniżej.</p>';
      return;
    }
    target.innerHTML = '<ol class="sets-cards">' + set.editions.map((item) => editionCard(item, {
      member: true,
      action: `<span class="sets-card-actions"><label class="sets-qty"><span class="sr-only">Liczba egzemplarzy</span><input type="number" min="1" max="10000" step="1" value="${safe(item.quantity)}" data-member-quantity="${safe(item.editionId)}" aria-label="Liczba egzemplarzy: ${safe(item.title)}"> szt.</label>
        <button class="link-button danger-text" type="button" data-set-remove="${safe(item.editionId)}" aria-label="Usuń ${safe(item.title)} z zestawu">Usuń</button></span>`,
    })).join('') + '</ol>';
    // The number of copies is saved as soon as it changes.
    target.querySelectorAll('[data-member-quantity]').forEach((input) => input.addEventListener('change', async () => {
      const item = set.editions.find((entry) => entry.editionId === input.dataset.memberQuantity);
      const quantity = Number(input.value);
      if (!Number.isSafeInteger(quantity) || quantity < 1) { input.value = item.quantity; return toast('Podaj liczbę egzemplarzy (1 lub więcej).'); }
      input.disabled = true;
      try {
        await request('PUT', '/api/set-items/' + encodeURIComponent(set.offerId) + '/' + encodeURIComponent(item.editionId), { quantity, resalePrice: item.resalePrice ?? null });
        await refreshSets(activeId);
      } catch (error) {
        toast('Nie zapisano liczby egzemplarzy: ' + error.message);
        input.disabled = false;
      }
    }));
    target.querySelectorAll('[data-set-remove]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await request('DELETE', '/api/sets/' + encodeURIComponent(set.offerId) + '/editions/' + encodeURIComponent(button.dataset.setRemove));
        await refreshSets(activeId);
      } catch (error) { button.disabled = false; toast(error.message); }
    }));
  }

  async function addEditions(ids) {
    for (const editionId of ids) await request('POST', '/api/sets/' + encodeURIComponent(activeId) + '/editions', { editionId });
    await refreshSets(activeId);
  }

  // What the listing itself names: works whose title it contains, the ISBN it shows, and the rest
  // of the cycles those belong to (a set is usually a whole cycle).
  async function renderSuggestions(set) {
    const mount = $('#setSuggestions');
    const serial = ++suggestionSerial;
    mount.innerHTML = '';
    let items = [];
    try {
      items = (await json('/api/sets/' + encodeURIComponent(set.offerId) + '/candidates')).items || [];
    } catch {
      return;
    }
    if (serial !== suggestionSerial || activeId !== set.offerId) return;
    const have = included();
    const fresh = items.filter((item) => !have.has(item.editionId));
    if (!fresh.length) return;
    mount.innerHTML = `<div class="rv-section-title"><h4>Propozycje z tytułu ogłoszenia</h4>${fresh.length > 1 ? `<button type="button" class="link-button" data-add-all>Dodaj wszystkie (${fresh.length})</button>` : ''}</div>
      <ol class="sets-cards">${fresh.map((item) => editionCard(item, {
        action: `<button type="button" class="button secondary compact" data-add-edition="${safe(item.editionId)}">Dodaj</button>`,
      })).join('')}</ol>`;
    wireAdd(mount);
    mount.querySelector('[data-add-all]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try { await addEditions(fresh.map((item) => item.editionId)); toast(`Dodano ${books(fresh.length)}. Sprawdź z ogłoszeniem, czy to pełny skład.`); }
      catch (error) { toast('Nie dodano wszystkich: ' + error.message); await refreshSets(activeId); }
    });
  }

  function wireAdd(root) {
    root.querySelectorAll('[data-add-edition]').forEach((button) => button.addEventListener('click', async () => {
      if (!activeId) return toast('Najpierw wybierz zestaw.');
      button.disabled = true;
      try {
        await request('POST', '/api/sets/' + encodeURIComponent(activeId) + '/editions', { editionId: button.dataset.addEdition });
        button.textContent = 'Dodano';
        await refreshSets(activeId);
      } catch (error) { button.disabled = false; toast(error.message); }
    }));
  }

  function renderUnknown(set) {
    const mount = $('#setUnknown');
    const canConfirm = set.editions.length > 0 && !(set.unknownItems || []).length;
    mount.innerHTML = `<div class="rv-section-title"><h4>Nie ma w katalogu</h4><small>opisz książkę, której nie da się znaleźć</small></div>
      ${(set.unknownItems || []).map((item) => `<div class="sets-unknown-row"><span>${safe(item.title)} · ${safe(item.quantity)} szt.</span><button type="button" class="link-button danger-text" data-unknown-remove="${safe(item.id)}">Usuń</button></div>`).join('')}
      <form class="set-unknown-form"><input name="title" maxlength="300" required placeholder="Np. Gotrek i Felix: Zabójca demonów" aria-label="Opis nierozpoznanej książki"><input name="quantity" type="number" min="1" max="10000" step="1" value="1" aria-label="Liczba egzemplarzy"><button type="submit" class="button secondary compact">Dodaj</button></form>
      ${set.composedFromDescriptionAt && !set.compositionConfirmed && set.editions.length ? '<p class="inline-note">Książki dodane automatycznie z opisu ogłoszenia — porównaj ze zdjęciem, usuń nadmiarowe, dopisz brakujące.</p>' : ''}
      <label class="sets-confirm"><input type="checkbox" data-set-confirm ${set.compositionConfirmed ? 'checked' : ''} ${canConfirm || set.compositionConfirmed ? '' : 'disabled'}> Skład sprawdzony z ogłoszeniem — kompletny</label>
      ${canConfirm || set.compositionConfirmed ? '' : `<p class="inline-note">${set.editions.length ? 'Najpierw rozpoznaj albo usuń pozycje spoza katalogu.' : 'Dodaj książki, aby potwierdzić skład.'}</p>`}`;
    mount.querySelectorAll('[data-unknown-remove]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await request('DELETE', '/api/set-unknown/' + encodeURIComponent(set.offerId) + '/' + encodeURIComponent(button.dataset.unknownRemove)); await refreshSets(activeId); }
      catch { button.disabled = false; toast('Nie usunięto pozycji. Spróbuj ponownie.'); }
    }));
    const form = mount.querySelector('form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const title = form.elements.title.value.trim();
      if (!title) return form.elements.title.focus();
      form.querySelector('button').disabled = true;
      try { await request('POST', '/api/set-unknown/' + encodeURIComponent(set.offerId), { title, quantity: Number(form.elements.quantity.value) }); await refreshSets(activeId); }
      catch { form.querySelector('button').disabled = false; toast('Nie zapisano pozycji. Sprawdź opis i liczbę.'); }
    });
    mount.querySelector('[data-set-confirm]').addEventListener('change', async (event) => {
      const box = event.currentTarget;
      box.disabled = true;
      try { await request('PUT', '/api/set-details/' + encodeURIComponent(set.offerId), { confirmed: box.checked }); await refreshSets(activeId); }
      catch { box.checked = !box.checked; box.disabled = false; toast('Nie zapisano potwierdzenia składu.'); }
    });
  }

  function renderActions(set) {
    $('#setActions').innerHTML = `<div class="lean-review-primary-actions"><a class="button primary" href="${safe(safeOfferHref(set.url))}" target="_blank" rel="noreferrer">Otwórz ogłoszenie ↗</a><button class="button secondary" type="button" id="setOfferDetails">Szczegóły oferty</button></div>
      <div class="lean-review-secondary-actions"><button class="button ghost danger-text" type="button" id="setUnmark">To nie zestaw — wróć do weryfikacji</button></div>`;
    $('#setOfferDetails').addEventListener('click', () => openOfferDrawer(set.offerId));
    $('#setUnmark').addEventListener('click', async () => {
      if (!await confirmDiscard()) return;
      if (!(await confirmDialog('Usunąć oznaczenie zestawu? Oferta wróci do kolejki identyfikacji, a lista książek zestawu zostanie usunięta.', { title: 'Oznaczenie zestawu', confirmLabel: 'Usuń oznaczenie', danger: true }))) return;
      try { await request('DELETE', '/api/sets/' + encodeURIComponent(set.offerId)); await refreshSets(); }
      catch (error) { toast(error.message); }
    });
  }

  async function searchOffers() {
    const query = $('#setOfferQuery').value.trim();
    if (!query) { $('#setFeedback').textContent = 'Wpisz tytuł lub ISBN oferty.'; return; }
    const found = await json('/api/offers?' + new URLSearchParams({ query, limit: '100' }));
    $('#setOfferSelect').innerHTML = (found.items || []).map((row) =>
      `<option value="${safe(row.id)}">${safe(row.title)} — ${safe(row.source)}</option>`).join('');
    $('#setFeedback').textContent = `Znaleziono ${found.total} ofert.`;
  }

  async function searchEditions() {
    const query = $('#setEditionQuery').value.trim();
    const output = $('#setEditionResults');
    if (query.length < 2) { output.innerHTML = '<p class="sets-empty">Wpisz co najmniej 2 znaki.</p>'; return; }
    const serial = ++searchSerial;
    output.innerHTML = '<p class="sets-empty">Szukam w katalogu…</p>';
    try {
      const response = await json('/api/catalog/works?' + new URLSearchParams({ query, limit: '50' }));
      if (serial !== searchSerial || $('#setEditionQuery').value.trim() !== query) return;
      const rows = (response.items || []).flatMap((work) => (work.editions || []).map((edition) => ({
        id: edition.id, title: edition.title, workTitle: work.title, authors: work.authors || [], publisher: edition.publisher,
        publicationYear: edition.publicationYear, isbn: (edition.identifiers || []).find((item) => String(item.scheme).startsWith('isbn'))?.value || '',
      })));
      const have = included();
      output.innerHTML = rows.length
        ? '<ol class="sets-cards">' + rows.slice(0, 30).map((row) => editionCard({ ...row, editionId: row.id }, {
          action: `<button type="button" class="button ${have.has(row.id) ? 'ghost' : 'secondary'} compact" data-add-edition="${safe(row.id)}" ${have.has(row.id) || !activeId ? 'disabled' : ''} title="${safe(row.title)}">${have.has(row.id) ? 'Dodano' : 'Dodaj'}</button>`,
        })).join('') + '</ol>'
        : '<p class="sets-empty">Nie znaleziono. Spróbuj innego tytułu albo dopisz książkę niżej, w „Nie ma w katalogu”.</p>';
      wireAdd(output);
    } catch (error) {
      if (serial === searchSerial) output.innerHTML = '<p class="sets-empty">Nie udało się wyszukać: ' + safe(error.message) + '</p>';
    }
  }

  function wire(id, callback) {
    $(id).addEventListener('click', async () => {
      const button = $(id);
      button.disabled = true;
      try { await callback(); } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    });
  }
  // Books named in a pasted description: each found one is offered with "Dodaj", like suggestions.
  async function fromDescription() {
    if (!activeId) return toast('Najpierw wybierz zestaw.');
    const text = $('#setDescription').value;
    const mount = $('#setDescriptionResults');
    if (!text.trim()) return toast('Wklej opis ogłoszenia.');
    mount.innerHTML = '<p class="inline-note">Szukam w katalogu…</p>';
    const { items = [] } = await request('POST', '/api/sets/' + encodeURIComponent(activeId) + '/candidates', { text });
    const have = included();
    const fresh = items.filter((item) => !have.has(item.editionId));
    if (!fresh.length) {
      mount.innerHTML = '<p class="inline-note">' + (items.length ? 'Wszystkie znalezione książki są już w zestawie.' : 'Nie rozpoznano tytułów z katalogu. Brakujące dopisz jako „Nie ma w katalogu”.') + '</p>';
      return;
    }
    mount.innerHTML = `<div class="rv-section-title"><h4>Znalezione w opisie</h4>${fresh.length > 1 ? `<button type="button" class="link-button" data-add-all>Dodaj wszystkie (${fresh.length})</button>` : ''}</div>
      <ol class="sets-cards">${fresh.map((item) => editionCard(item, { action: `<button type="button" class="button secondary compact" data-add-edition="${safe(item.editionId)}">Dodaj</button>` })).join('')}</ol>`;
    wireAdd(mount);
    mount.querySelector('[data-add-all]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try { await addEditions(fresh.map((item) => item.editionId)); mount.innerHTML = ''; toast(`Dodano ${books(fresh.length)} z opisu.`); }
      catch (error) { toast('Nie dodano wszystkich: ' + error.message); await refreshSets(activeId); }
    });
  }

  // "Świat Dysku tomy 1–4": the volumes of a cycle as numbered in the series view.
  async function addRange() {
    if (!activeId) return toast('Najpierw wybierz zestaw.');
    const name = $('#setCycleName').value.trim();
    const from = $('#setVolumeFrom').value;
    const to = $('#setVolumeTo').value || from;
    if (!name || !from) return toast('Podaj cykl i numer pierwszego tomu.');
    const result = await json('/api/sets-cycle-volumes?' + new URLSearchParams({ name, from, to }));
    const have = included();
    const fresh = result.items.filter((item) => !have.has(item.editionId));
    if (fresh.length) await addEditions(fresh.map((item) => item.editionId));
    $('#setRangeResult').textContent =
      (fresh.length ? `Dodano ${books(fresh.length)}.` : 'Nic nowego do dodania.') +
      (result.missing.length ? ` Brak w katalogu tomów: ${result.missing.join(', ')} — dopisz je jako „Nie ma w katalogu” albo nadaj numery w widoku Serie.` : '');
  }

  async function fillCycleNames() {
    try {
      const tree = await json('/api/catalog/series-tree');
      const names = [...new Set(tree.universes.flatMap((universe) => universe.cycles.map((cycle) => cycle.name).filter(Boolean)))].sort((a, b) => a.localeCompare(b, 'pl'));
      $('#setCycleNames').innerHTML = names.map((name) => `<option value="${safe(name)}"></option>`).join('');
    } catch {}
  }
  $('#setBulkPanel').addEventListener('toggle', () => { if ($('#setBulkPanel').open && !$('#setCycleNames').children.length) void fillCycleNames(); });
  wire('#setFromDescription', fromDescription);
  wire('#setAddRange', addRange);
  wire('#setSearchOffers', searchOffers);
  wire('#setSearchEditions', searchEditions);
  wire('#setMarkOffer', async () => {
    if (!await confirmDiscard()) return;
    const offerId = $('#setOfferSelect').value;
    if (!offerId) return toast('Najpierw wyszukaj i wybierz ofertę.');
    await request('POST', '/api/sets', { offerId });
    await refreshSets(offerId);
    $('#setFeedback').textContent = 'Zestaw utworzony.';
    const details = $('#setOfferQuery').closest('details');
    if (details) details.open = false;
  });
  $('#setFilter').addEventListener('input', renderList);
  $('#setSort')?.addEventListener('change', renderList);
  $('#setCurrent').addEventListener('change', () => selectSet($('#setCurrent').value));
  $('#setEditionQuery').addEventListener('input', () => {
    clearTimeout(editionSearchTimer);
    if ($('#setEditionQuery').value.trim().length < 2) { ++searchSerial; $('#setEditionResults').innerHTML = ''; return; }
    editionSearchTimer = setTimeout(() => { void searchEditions(); }, 350);
  });
  $('#setEditionQuery').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); clearTimeout(editionSearchTimer); void searchEditions(); }
  });
  $('#setOfferQuery').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); void searchOffers().catch((error) => toast(error.message)); }
  });
  return { refreshSets, activeId: () => activeId, refreshActive: () => refreshSets(activeId) };
}
