// "Usuń z katalogu": a button on the book page and the "Usunięte z katalogu" panel among the
// catalogue tools. Removal hides the book with its editions and rejects its offers, also future
// ones (catalog-removal.mjs); the toast and the panel restore it exactly.
import { confirmDialog } from '../core/dialogs.js';

const offersWord = (n) =>
  n === 1 ? '1 oferta' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? `${n} oferty` : `${n} ofert`;
const changed = () => document.dispatchEvent(new CustomEvent('bookflip-catalog-removed'));

async function restore(workId, { json, toast, loadCatalogData }) {
  const result = await json('/api/catalog/removed-works/' + encodeURIComponent(workId) + '/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  toast(`Przywrócono „${result.title}” (${offersWord(result.offers)}).`);
  await loadCatalogData();
  changed();
}

/** Danger-zone section at the bottom of the book page. */
export function mountWorkRemoval({ row, detail, json, toast, loadCatalogData, onRemoved }) {
  const section = document.createElement('section');
  section.className = 'detail-section work-removal';
  section.innerHTML =
    '<h4>Usuń z katalogu</h4><p class="inline-note">Dla pozycji, które nie należą do kolekcji. Książka zniknie z list razem z wydaniami, jej oferty zostaną odrzucone, a nowe oferty tej książki będą odrzucane same. Przywrócisz ją w „Narzędzia katalogu → Usunięte z katalogu”.</p>';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button secondary danger-text';
  button.textContent = 'Usuń z katalogu';
  section.append(button);
  detail.append(section);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const url = '/api/catalog/works/' + encodeURIComponent(row.id) + '/removal';
      const preview = await json(url);
      const confirmed = await confirmDialog(
        `„${preview.title}”: ${preview.editions} ${preview.editions === 1 ? 'wydanie' : 'wydań'} i ${offersWord(preview.offers)} znikną z katalogu i z weryfikacji. Nowe oferty tej książki będą odrzucane automatycznie.`,
        { title: 'Usunąć z katalogu?', confirmLabel: 'Usuń z katalogu', danger: true },
      );
      if (!confirmed) return;
      await json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      toast(`Usunięto z katalogu: „${preview.title}”.`, {
        label: 'Cofnij',
        onClick: () => restore(row.id, { json, toast, loadCatalogData }),
        onError: (error) => toast('Nie przywrócono: ' + error.message),
      });
      await loadCatalogData();
      changed();
      onRemoved?.();
    } catch (error) {
      toast('Nie usunięto: ' + error.message);
    } finally {
      button.disabled = false;
    }
  });
}

/** "Usunięte z katalogu" panel: every removed book with "Przywróć". */
export function mountRemovedWorks({ $, json, escapeHtml, toast, loadCatalogData }) {
  const panel = $('#catalogRemoved');
  const body = $('#catalogRemovedBody');
  if (!panel || !body) return;
  async function refresh() {
    try {
      const { items } = await json('/api/catalog/removed-works');
      panel.querySelector('summary').textContent = items.length
        ? `Usunięte z katalogu (${items.length})`
        : 'Usunięte z katalogu';
      body.innerHTML = items.length
        ? '<ul class="removed-works">' +
          items
            .map(
              (item) =>
                `<li><span>${escapeHtml(item.title.split(' / ')[0])}</span><small>${escapeHtml(new Date(item.removedAt).toLocaleDateString('pl-PL'))} · odrzucone: ${escapeHtml(offersWord(item.rejectedOffers))}</small><button class="button secondary compact" type="button" data-restore-work="${escapeHtml(item.workId)}">Przywróć</button></li>`,
            )
            .join('') +
          '</ul>'
        : '<p class="inline-note">Nic nie zostało usunięte.</p>';
      body.querySelectorAll('[data-restore-work]').forEach((button) =>
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await restore(button.dataset.restoreWork, { json, toast, loadCatalogData });
          } catch (error) {
            toast('Nie przywrócono: ' + error.message);
            button.disabled = false;
          }
        }),
      );
    } catch (error) {
      body.innerHTML = `<p class="inline-note">Nie udało się wczytać listy: ${escapeHtml(error.message)}</p>`;
    }
  }
  panel.addEventListener('toggle', () => {
    if (panel.open) void refresh();
  });
  document.addEventListener('bookflip-catalog-removed', () => void refresh());
  void refresh();
}
