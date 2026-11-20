// Katalog → "Wydawcy i serie": publishers and publisher / universe series with the number of
// editions. Variant spellings are joined into one name ("Discworld series" → "Świat Dysku"); the
// join renames stored editions and applies to editions saved later. The publisher filter offers
// the joined names.
import { confirmDialog } from '../core/dialogs.js';

export function mountCatalogNames({ $, json, escapeHtml, toast, loadCatalogData }) {
  const panel = $('#catalogNames');
  const body = $('#catalogNamesBody');
  if (!panel || !body) return { refresh() {} };
  const post = (url, data) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

  function fillPublisherList(publishers) {
    const list = $('#publisherNames');
    if (list) list.innerHTML = publishers.map((row) => `<option value="${escapeHtml(row.name)}">`).join('');
  }

  function section(kind, title, rows) {
    const options = rows.map((row) => `<option value="${escapeHtml(row.name)}">${escapeHtml(row.name)} (${row.editions})</option>`).join('');
    return `<section class="names-section"><h4>${title} <small>${rows.length}</small></h4><ul class="names-list">${rows
      .map(
        (row) => `<li data-kind="${kind}" data-name="${escapeHtml(row.name)}">
          <span class="names-main"><b>${escapeHtml(row.name)}</b><small>${row.editions} wyd.${row.kind && row.kind !== 'publisher_line' ? ' · uniwersum' : ''}</small>
          ${row.variants.length ? `<small class="names-variants">także: ${row.variants.map((alias) => `<span>${escapeHtml(alias)} <button type="button" class="link-button" data-unalias="${escapeHtml(alias)}" aria-label="Usuń wariant ${escapeHtml(alias)}">×</button></span>`).join(', ')}</small>` : ''}</span>
          <span class="names-merge"><select aria-label="Połącz „${escapeHtml(row.name)}” z"><option value="">Połącz z…</option>${options}</select></span>
        </li>`,
      )
      .join('')}</ul></section>`;
  }

  // Universes as data: names (spellings of the universe), lines (publisher lines tied to it) and
  // markers (cycles / heroes that tell it). Used to strip branding from titles, to tell a universe
  // from a cycle in the series view and to widen searches.
  const list = (value) => String(value ?? '').split(';').map((item) => item.trim()).filter(Boolean);
  function universeRow(row = { name: '', names: [], lines: [], markers: [] }) {
    const field = (key, label, value, hint) =>
      `<label class="field"><span>${label}</span><input type="text" data-field="${key}" value="${escapeHtml(value)}" placeholder="${escapeHtml(hint)}" autocomplete="off"></label>`;
    return `<li class="universe-row" data-universe="${escapeHtml(row.name)}">
      ${field('name', 'Nazwa', row.name, 'np. Wiedźmin')}
      ${field('names', 'Inne zapisy (oddziel średnikiem)', row.names.join('; '), 'np. The Witcher; Saga o wiedźminie')}
      ${field('lines', 'Serie wydawnicze', row.lines.join('; '), 'np. Black Library')}
      ${field('markers', 'Cykle i postacie', row.markers.join('; '), 'np. Herezja Horusa; Drizzt')}
      <span class="universe-actions"><button type="button" class="button secondary compact" data-universe-save>${row.name ? 'Zapisz' : 'Dodaj uniwersum'}</button>${row.name ? '<button type="button" class="link-button" data-universe-delete>Usuń</button>' : ''}</span>
    </li>`;
  }
  function universesSection(items) {
    return `<section class="names-section universes-section"><h4>Uniwersa <small>${items.length}</small></h4>
      <p class="inline-note">Nazwy uniwersów są na okładkach i w ogłoszeniach: aplikacja usuwa je z tytułów („World of Warcraft: Illidan” = „Illidan”), odróżnia uniwersum od cyklu w widoku serii i poszerza wyszukiwanie. „Cykle i postacie” wskazują uniwersum, ale zostają w tytule.</p>
      <ul class="names-list universes-list">${items.map(universeRow).join('')}${universeRow()}</ul></section>`;
  }
  function bindUniverses() {
    body.querySelectorAll('.universe-row').forEach((item) => {
      const value = (key) => item.querySelector(`[data-field="${key}"]`).value;
      item.querySelector('[data-universe-save]').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          await json('/api/catalog/universes', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ previousName: item.dataset.universe || undefined, name: value('name'), names: list(value('names')), lines: list(value('lines')), markers: list(value('markers')) }),
          });
          toast('Zapisano uniwersum. Obowiązuje dla tytułów czytanych od teraz.');
          await refresh();
        } catch (error) {
          button.disabled = false;
          toast(error.message === 'UNIVERSE_NAME_TAKEN' ? 'Ten zapis należy już do innego uniwersum.' : error.message === 'INVALID_UNIVERSE_NAME' ? 'Podaj nazwę uniwersum.' : 'Nie zapisano: ' + error.message);
        }
      });
      item.querySelector('[data-universe-delete]')?.addEventListener('click', async () => {
        const name = item.dataset.universe;
        if (!(await confirmDialog(`Usunąć uniwersum „${name}”? Jego nazwy przestaną być usuwane z tytułów i rozpoznawane w widoku serii.`, { title: 'Usuwanie uniwersum', confirmLabel: 'Usuń', danger: true }))) return;
        try {
          await json('/api/catalog/universes/' + encodeURIComponent(name), { method: 'DELETE' });
          toast('Usunięto uniwersum.');
          await refresh();
        } catch (error) {
          toast('Nie usunięto: ' + error.message);
        }
      });
    });
  }

  async function refresh() {
    body.innerHTML = '<p class="inline-note">Wczytywanie…</p>';
    try {
      const [data, universes] = await Promise.all([json('/api/catalog/names'), json('/api/catalog/universes').catch(() => ({ items: [] }))]);
      fillPublisherList(data.publishers);
      body.innerHTML =
        '<p class="inline-note">Wybierz w „Połącz z…” właściwą nazwę: wydania z wariantem dostaną ją od razu, a nowe wydania — przy zapisie.</p>' +
        section('publisher', 'Wydawcy', data.publishers) +
        section('series', 'Serie wydawnicze i uniwersa', data.series) +
        universesSection(universes.items || []);
      bindUniverses();
      body.querySelectorAll('.names-list li[data-kind]').forEach((item) => {
        const { kind, name } = item.dataset;
        const select = item.querySelector('select');
        select.querySelector(`option[value="${CSS.escape(name)}"]`)?.remove();
        select.addEventListener('change', async () => {
          const into = select.value;
          if (!into) return;
          const ok = await confirmDialog(`„${name}” stanie się wariantem „${into}”. Wydania z tą nazwą zostaną przemianowane.`, {
            title: kind === 'publisher' ? 'Połączenie wydawców' : 'Połączenie serii',
            confirmLabel: 'Połącz',
          });
          if (!ok) {
            select.value = '';
            return;
          }
          try {
            const result = await post('/api/catalog/names/merge', { kind, from: name, into });
            toast(`Połączono: ${result.from} → ${result.into} (${result.renamed} wyd.).`);
            await refresh();
            void loadCatalogData?.();
          } catch (error) {
            toast('Nie udało się połączyć nazw: ' + error.message);
            select.value = '';
          }
        });
        item.querySelectorAll('[data-unalias]').forEach((button) =>
          button.addEventListener('click', async () => {
            try {
              await post('/api/catalog/names/unalias', { kind, alias: button.dataset.unalias });
              toast('Usunięto wariant. Nowe wydania zachowają swoją pisownię.');
              await refresh();
            } catch (error) {
              toast('Nie udało się usunąć wariantu: ' + error.message);
            }
          }),
        );
      });
    } catch {
      body.innerHTML = '<p class="inline-note">Nie udało się wczytać wydawców i serii.</p>';
    }
  }
  panel.addEventListener('toggle', () => {
    if (panel.open) void refresh();
  });
  // The author filter's suggestions: one name per author, most books first.
  void json('/api/catalog/authors')
    .then((data) => {
      const list = $('#authorNames');
      if (list) list.innerHTML = data.items.map((row) => `<option value="${escapeHtml(row.name)}">${row.works} ${row.works === 1 ? 'książka' : 'książek'}</option>`).join('');
    })
    .catch(() => {});
  // The publisher filter's suggestions, without opening the panel.
  void json('/api/catalog/names').then((data) => fillPublisherList(data.publishers)).catch(() => {});
  return { refresh };
}
