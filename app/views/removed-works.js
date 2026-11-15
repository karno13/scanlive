// "Usuń z katalogu": a button in the book page's action bar and the "Usunięte z katalogu" panel among the
// catalogue tools. Removal hides the book with its editions and rejects its offers, also future
// ones (catalog-removal.mjs); the toast and the panel restore it exactly.

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

/**
 * Removes a book at once, without a confirmation (owner request 2026-11-15): the removal is fully
 * reversible, so the toast's „Cofnij” and the „Usunięte z katalogu” panel are the safety net.
 */
export async function removeWork(workId, { json, toast, loadCatalogData }) {
  const result = await json('/api/catalog/works/' + encodeURIComponent(workId) + '/removal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  toast(`Usunięto z katalogu: „${String(result.title).split(' / ')[0]}”${result.offers ? ` (odrzucone oferty: ${result.offers})` : ''}.`, {
    label: 'Cofnij',
    onClick: () => restore(workId, { json, toast, loadCatalogData }),
    onError: (error) => toast('Nie przywrócono: ' + error.message),
  });
  await loadCatalogData();
  changed();
  return result;
}

/** "Usuń z katalogu" in the book page's action bar. */
export function mountWorkRemoval({ row, button, json, toast, loadCatalogData, onRemoved }) {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await removeWork(row.id, { json, toast, loadCatalogData });
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
