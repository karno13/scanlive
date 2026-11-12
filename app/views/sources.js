// "Źródła": the state of every source on top of the scan form — whether it works, since when it
// does not and why, when it last worked — each with a link to its offers. Same data and wording as
// the "Dziś" list (source-status.mjs on the server, sourceLine in today.js).
import { sourceLine, whenLabel } from './today.js';

export function installSources({ $, json, escapeHtml, openOffers }) {
  const mount = $('#sourcesStatus');
  if (!mount) return { refresh: async () => {} };
  async function refresh() {
    let items;
    try {
      ({ items } = await json('/api/source-status'));
    } catch {
      mount.innerHTML = '<p class="inline-note">Nie udało się odczytać stanu źródeł.</p>';
      return;
    }
    const now = new Date();
    const down = items.filter((row) => row.state === 'down' || row.state === 'never').length;
    mount.innerHTML = `<div class="panel-heading"><div><h3>Stan źródeł</h3><p>${items.length - down} z ${items.length} działa${down ? ` · ${down} nie działa — nie są zaznaczane w nowym skanie` : ''}.</p></div></div>
      <ul class="today-sources-list">${items
        .map(
          (row) =>
            `<li class="is-${escapeHtml(row.state)}"><button type="button" data-source="${escapeHtml(row.source)}" title="Oferty z tego źródła"><i class="source-dot-state" aria-hidden="true"></i><b>${escapeHtml(row.source)}</b><span>${escapeHtml(sourceLine(row, now))}${row.state !== 'ok' && row.lastCheckedAt ? ` · sprawdzone ${escapeHtml(whenLabel(row.lastCheckedAt, now))}` : ''}</span></button></li>`,
        )
        .join('')}</ul>`;
    mount.querySelectorAll('[data-source]').forEach((button) =>
      button.addEventListener('click', () => openOffers({ source: button.dataset.source, sort: 'newest' })),
    );
  }
  return { refresh };
}
