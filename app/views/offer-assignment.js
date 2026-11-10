// Change or remove an offer's edition: used in the catalogue edition card (per linked offer) and in
// the offer panel. Search runs over the catalogue (title, author, translator, ISBN); the choice is
// confirmed before anything is saved, and every change stays in the offer's decision history.
import { confirmDialog } from '../core/dialogs.js';

const isbnOf = (edition) => edition.identifiers?.find((item) => String(item.scheme).startsWith('isbn'))?.value || 'bez ISBN';

export function mountOfferAssignment({ container, offer, currentEditionId = null, initialQuery = '', json, escapeHtml, toast, onChanged = () => {} }) {
  const box = document.createElement('div');
  box.className = 'offer-assignment';
  box.innerHTML = `<div class="offer-assignment-actions">
      <button type="button" class="button secondary compact" data-assign-toggle>${currentEditionId ? 'Zmień wydanie' : 'Przypisz do wydania'}</button>
      ${currentEditionId ? '<button type="button" class="button secondary compact danger-text" data-unassign>Odłącz</button>' : ''}
    </div>
    <div class="offer-assignment-search" hidden>
      <label class="field"><span>Szukaj wydania w katalogu</span><input type="search" data-assign-query placeholder="Tytuł, autor, tłumacz lub ISBN" maxlength="120"></label>
      <div class="offer-assignment-results" data-assign-results aria-live="polite"><p class="inline-note">Wpisz co najmniej 2 znaki.</p></div>
    </div>`;
  container.append(box);
  const search = box.querySelector('.offer-assignment-search');
  const results = box.querySelector('[data-assign-results]');
  const input = box.querySelector('[data-assign-query]');
  let timer = null;
  let serial = 0;

  box.querySelector('[data-assign-toggle]').addEventListener('click', () => {
    search.hidden = !search.hidden;
    if (!search.hidden) {
      // Catalogue search matches whole phrases: start from the edition title, or the listing's first words.
      if (!input.value) input.value = initialQuery || String(offer.title || '').split(/\s+/).slice(0, 2).join(' ');
      input.focus();
      void find();
    }
  });

  async function find() {
    const query = input.value.trim();
    const request = ++serial;
    if (query.length < 2) {
      results.innerHTML = '<p class="inline-note">Wpisz co najmniej 2 znaki.</p>';
      return;
    }
    results.innerHTML = '<p class="inline-note">Szukam…</p>';
    try {
      const data = await json('/api/catalog/works?' + new URLSearchParams({ query, limit: '15' }));
      if (request !== serial) return;
      // A book with several editions is offered whole too: the edition stays unknown unless the listing names it.
      const books = data.items.filter((work) => work.editions.length > 1);
      const editions = data.items.flatMap((work) => work.editions.map((edition) => ({ ...edition, workTitle: work.title, authors: work.authors })));
      const bookButtons = books
        .map((work) => `<button type="button" class="offer-assignment-option is-work-option" data-work="${escapeHtml(work.id)}"><strong>${escapeHtml(work.title)} — cała książka</strong><small>${escapeHtml([work.authors?.[0], 'wydania w katalogu: ' + work.editions.length, 'wydanie nieustalone, chyba że ogłoszenie je wskazuje'].filter(Boolean).join(' · '))}</small></button>`)
        .join('');
      results.innerHTML = editions.length
        ? bookButtons + editions
            .map(
              (edition) =>
                `<button type="button" class="offer-assignment-option" data-edition="${escapeHtml(edition.id)}"${edition.id === currentEditionId ? ' disabled' : ''}><strong>${escapeHtml(edition.title)}</strong><small>${escapeHtml(
                  [edition.authors?.[0], edition.publisher, edition.publicationYear, edition.binding, isbnOf(edition)].filter(Boolean).join(' · '),
                )}${edition.id === currentEditionId ? ' · obecne' : ''}</small></button>`,
            )
            .join('')
        : '<p class="inline-note">Nic nie znaleziono. Jeśli wydania nie ma w katalogu, dodaj je przez weryfikację ISBN.</p>';
      results.querySelectorAll('[data-work]').forEach((button) =>
        button.addEventListener('click', () => chooseWork(books.find((work) => work.id === button.dataset.work))),
      );
      results.querySelectorAll('[data-edition]').forEach((button) =>
        button.addEventListener('click', () => choose(editions.find((edition) => edition.id === button.dataset.edition))),
      );
    } catch (error) {
      if (request === serial) results.innerHTML = `<p class="inline-note">Nie udało się wyszukać: ${escapeHtml(error.message)}</p>`;
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void find(), 300);
  });

  async function choose(edition) {
    if (!edition) return;
    const ok = await confirmDialog(
      `Przypisać ofertę „${String(offer.title || '').slice(0, 80)}” do wydania „${edition.title}” (${[edition.publisher, edition.publicationYear, isbnOf(edition)].filter(Boolean).join(', ')})? Zapisze się to jako ręczna decyzja.`,
      { title: currentEditionId ? 'Zmiana przypisania' : 'Przypisanie oferty', confirmLabel: 'Przypisz' },
    );
    if (!ok) return;
    try {
      await json('/api/offers/' + encodeURIComponent(offer.id) + '/assignment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editionId: edition.id }),
      });
      toast('Zmieniono przypisanie oferty.');
      await onChanged({ editionId: edition.id });
    } catch (error) {
      toast(error.message === 'OFFER_IS_SET' ? 'To zestaw — skład zmienisz w zakładce Zestawy.' : 'Nie zmieniono przypisania: ' + error.message);
    }
  }

  async function chooseWork(work) {
    if (!work) return;
    const ok = await confirmDialog(
      `Przypisać ofertę „${String(offer.title || '').slice(0, 80)}” do książki „${work.title}” bez wskazywania wydania? Jeśli ogłoszenie wskazuje wydanie (ISBN, rok, oprawa, wydawca), zostanie ono wybrane; inaczej oferta trafi do „Wydanie nieustalone”.`,
      { title: currentEditionId ? 'Zmiana przypisania' : 'Przypisanie oferty', confirmLabel: 'Przypisz' },
    );
    if (!ok) return;
    try {
      const result = await json('/api/offers/' + encodeURIComponent(offer.id) + '/assignment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workId: work.id }),
      });
      toast('Przypisano do książki.');
      await onChanged({ editionId: result.editionId });
    } catch (error) {
      toast(error.message === 'OFFER_IS_SET' ? 'To zestaw — skład zmienisz w zakładce Zestawy.' : 'Nie zmieniono przypisania: ' + error.message);
    }
  }

  box.querySelector('[data-unassign]')?.addEventListener('click', async () => {
    const ok = await confirmDialog(
      `Odłączyć ofertę „${String(offer.title || '').slice(0, 80)}” od tego wydania? Oferta wróci do zakładki Do weryfikacji, a automatyczna identyfikacja nie przypisze jej ponownie do tego wydania.`,
      { title: 'Odłączenie oferty', confirmLabel: 'Odłącz', danger: true },
    );
    if (!ok) return;
    try {
      await json('/api/offers/' + encodeURIComponent(offer.id) + '/assignment', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      toast('Odłączono ofertę. Czeka w zakładce Do weryfikacji.');
      await onChanged({ editionId: null });
    } catch (error) {
      toast(error.message === 'OFFER_IS_SET' ? 'To zestaw — skład zmienisz w zakładce Zestawy.' : 'Nie odłączono: ' + error.message);
    }
  });
  return box;
}
