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

  async function refresh() {
    body.innerHTML = '<p class="inline-note">Wczytywanie…</p>';
    try {
      const data = await json('/api/catalog/names');
      fillPublisherList(data.publishers);
      body.innerHTML =
        '<p class="inline-note">Wybierz w „Połącz z…” właściwą nazwę: wydania z wariantem dostaną ją od razu, a nowe wydania — przy zapisie.</p>' +
        section('publisher', 'Wydawcy', data.publishers) +
        section('series', 'Serie wydawnicze i uniwersa', data.series);
      body.querySelectorAll('.names-list li').forEach((item) => {
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
  // The publisher filter's suggestions, without opening the panel.
  void json('/api/catalog/names').then((data) => fillPublisherList(data.publishers)).catch(() => {});
  return { refresh };
}
