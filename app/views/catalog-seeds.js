// "Zasilanie katalogu z BN" panel: the operator names an author, publisher or title and the server
// adds every book the national library lists with an ISBN as a reference edition, slowly, in the
// background. No offer is assigned; the catalogue just learns the whole universe.
const KIND_LABELS = { author: 'Autor', publisher: 'Wydawca', title: 'Tytuł / seria' };
const STATUS_LABELS = { active: 'w toku', done: 'zakończone', paused: 'wstrzymane', error: 'błąd' };

export function mountCatalogSeeds({ $, json, escapeHtml, toast, loadCatalogData }) {
  const panel = $('#catalogSeeds');
  const body = $('#catalogSeedsBody');
  if (!panel || !body) return { refresh() {} };
  let timer = null;

  const seedMarkup = (seed) =>
    `<li class="seed-row"><span><strong>${escapeHtml(KIND_LABELS[seed.kind] || seed.kind)}: ${escapeHtml(seed.query)}</strong>${
      seed.publisher ? ` <small>· wydawca ${escapeHtml(seed.publisher)}</small>` : ''
    }<small>${escapeHtml(STATUS_LABELS[seed.status] || seed.status)} · nowe wydania: ${seed.editionsCreated} · znane: ${seed.alreadyKnown} · pominięte: ${seed.skipped} · rekordów BN: ${seed.recordsSeen}${
      seed.lastError ? ` · ostatni błąd: ${escapeHtml(seed.lastError)}` : ''
    }</small></span><span class="seed-actions">${
      seed.status === 'active'
        ? `<button class="button secondary" type="button" data-seed-status="paused" data-seed="${escapeHtml(seed.id)}">Wstrzymaj</button>`
        : `<button class="button secondary" type="button" data-seed-status="active" data-seed="${escapeHtml(seed.id)}">${seed.status === 'done' ? 'Sprawdź ponownie' : 'Wznów'}</button>`
    }<button class="button secondary" type="button" data-seed-remove="${escapeHtml(seed.id)}">Usuń</button></span></li>`;

  async function refresh() {
    clearTimeout(timer);
    try {
      const data = await json('/api/catalog/seeds');
      const active = data.seeds.filter((seed) => seed.status === 'active').length;
      panel.querySelector('summary').textContent = active
        ? `Zasilanie katalogu z Biblioteki Narodowej (${active} w toku)`
        : 'Zasilanie katalogu z Biblioteki Narodowej';
      const list = body.querySelector('#catalogSeedList');
      const outage = data.lastOutage
        ? `<p class="inline-alert">BN nie odpowiada (${escapeHtml(data.lastOutage.reason)}). Zasilanie wznowi się samo${
            data.pausedUntil ? ' około ' + escapeHtml(new Date(data.pausedUntil).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })) : ''
          }.</p>`
        : '';
      list.innerHTML = outage + (data.seeds.length ? `<ul class="seed-list">${data.seeds.map(seedMarkup).join('')}</ul>` : '<p class="inline-note">Brak źródeł zasilania.</p>');
      list.querySelectorAll('[data-seed-status]').forEach((button) =>
        button.addEventListener('click', () => update(button.dataset.seed, { method: 'PUT', body: JSON.stringify({ status: button.dataset.seedStatus }) })),
      );
      list.querySelectorAll('[data-seed-remove]').forEach((button) =>
        button.addEventListener('click', () => update(button.dataset.seedRemove, { method: 'DELETE' })),
      );
      // Progress is visible while the panel is open; the server works on its own either way.
      if (active && panel.open) timer = setTimeout(() => void refresh(), 15_000);
    } catch (error) {
      body.querySelector('#catalogSeedList').innerHTML = `<p class="inline-note">Nie udało się wczytać: ${escapeHtml(error.message)}</p>`;
    }
  }

  async function update(id, init) {
    try {
      await json('/api/catalog/seeds/' + encodeURIComponent(id), { headers: { 'Content-Type': 'application/json' }, ...init });
      await refresh();
      await loadCatalogData();
    } catch (error) {
      toast('Zasilanie: ' + error.message);
    }
  }

  body.innerHTML = `<p class="inline-note">Podaj autora, wydawcę albo tytuł serii. BookFlip pobierze z Biblioteki Narodowej wszystkie książki z ISBN i doda je do katalogu jako wydania wzorcowe (bez ofert), w tempie 1 zapytania na sekundę. Dzięki temu oferty bez ISBN łatwiej dopasować, a w widoku serii widać brakujące tomy.</p>
  <form class="seed-form filterbar" id="catalogSeedForm"><label class="field"><span>Rodzaj</span><select name="kind"><option value="author">Autor</option><option value="publisher">Wydawca</option><option value="title">Tytuł / seria</option></select></label><label class="field"><span>Fraza</span><input name="query" required minlength="2" maxlength="120" placeholder="np. Abnett, Dan"></label><label class="field"><span>Tylko wydawca (opcjonalnie)</span><input name="publisher" maxlength="120" placeholder="np. Copernicus"></label><label class="toggle-chip"><input type="checkbox" name="polishOnly" checked><span>Tylko po polsku</span></label><button class="button primary" type="submit">Dodaj</button></form>
  <div id="catalogSeedList"></div>`;
  body.querySelector('#catalogSeedForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await json('/api/catalog/seeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: data.get('kind'), query: data.get('query'), publisher: data.get('publisher'), polishOnly: data.get('polishOnly') === 'on' }),
      });
      form.reset();
      toast('Dodano źródło zasilania. Katalog będzie się uzupełniał w tle.');
      await refresh();
    } catch (error) {
      toast('Nie dodano: ' + error.message);
    }
  });
  panel.addEventListener('toggle', () => {
    if (panel.open) void refresh();
    else clearTimeout(timer);
  });
  return { refresh };
}
