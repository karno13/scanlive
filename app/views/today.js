// "Dziś" — the start view: what changed since the previous visit, what waits for a decision, which
// sources work, the last and the next scan. Every tile opens the list it counts (same filters as
// the count, from /api/today). Scans run on a schedule; the scan form is its own view.
import { visitBaseline } from './since-last-visit.js';

const plural = (n, one, few, many) =>
  n === 1 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;

/** "dziś 20:10", "wczoraj 08:16", "jutro 07:16" or "11.11, 20:10". */
export function whenLabel(value, now = new Date()) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = (time) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((day(date) - day(now)) / 86_400_000);
  const time = date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return 'dziś ' + time;
  if (days === -1) return 'wczoraj ' + time;
  if (days === 1) return 'jutro ' + time;
  return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'numeric' }) + ', ' + time;
}

/** One sentence per source state, e.g. "nie działa od 11.11, 09:30 — serwis żąda CAPTCHA". */
export function sourceLine(row, now = new Date()) {
  if (row.state === 'ok') return row.lastSuccessAt ? 'działa · ostatnio ' + whenLabel(row.lastSuccessAt, now) : 'działa';
  if (row.state === 'unknown') return 'jeszcze nie sprawdzany';
  if (row.state === 'no_access') return row.reason || 'brak legalnego dostępu';
  const since = row.downSince ? whenLabel(row.downSince, now) : '';
  const head = row.state === 'never' ? 'nigdy nie zadziałał' + (since ? ' (próby od ' + since + ')' : '') : 'nie działa' + (since ? ' od ' + since : '');
  return head + (row.reason ? ' — ' + row.reason : '');
}

/**
 * Tiles of the view from the /api/today answer. Pure (tested); `go` names what a tile opens:
 * { offers: filters } | { view: name }.
 */
export function todayTiles(data, now = new Date()) {
  const tiles = [];
  const scopeNote = data.scope === 'visit' ? 'od ostatniej wizyty' : 'w ostatnim skanie';
  if (data.newOffers)
    tiles.push({
      id: 'new',
      label: 'Nowe oferty',
      value: data.newOffers.count,
      note: scopeNote,
      go: { offers: data.newOffers.filters },
    });
  if (data.priceChanges)
    tiles.push({
      id: 'price',
      label: 'Zmiany cen',
      value: data.priceChanges.count,
      note: scopeNote,
      go: { offers: data.priceChanges.filters },
    });
  tiles.push({
    id: 'queue',
    label: 'Do decyzji',
    value: data.queue?.decisions ?? 0,
    note: `${data.queue?.offers ?? 0} ${plural(data.queue?.offers ?? 0, 'oferta', 'oferty', 'ofert')} w kolejce`,
    go: { view: 'review' },
    attention: (data.queue?.decisions ?? 0) > 0,
  });
  // Sources without legal access (Allegro, OLX) are neither working nor failing: not counted.
  const counted = (data.sources || []).filter((row) => row.state !== 'no_access');
  const down = counted.filter((row) => row.state === 'down' || row.state === 'never');
  tiles.push({
    id: 'sources',
    label: 'Źródła',
    value: `${counted.length - down.length}/${counted.length}`,
    note: down.length ? `nie ${down.length === 1 ? 'działa' : 'działają'}: ${down.map((row) => row.source).join(', ')}` : 'wszystkie działają',
    go: { anchor: 'todaySources' },
    warn: down.length > 0,
  });
  if (data.lastScan)
    tiles.push({
      id: 'last-scan',
      label: 'Ostatni skan',
      value: whenLabel(data.lastScan.at, now),
      note: `${data.lastScan.found} ${plural(data.lastScan.found, 'wynik', 'wyniki', 'wyników')} · ${data.lastScan.newOffers} ${plural(data.lastScan.newOffers, 'nowa', 'nowe', 'nowych')}${data.lastScan.failedSources.length ? ' · błąd: ' + data.lastScan.failedSources.join(', ') : ''}`,
      go: { offers: data.lastScan.filters },
    });
  const next = [data.nextScan?.at, data.nextScan?.quickAt].filter(Boolean).sort()[0];
  tiles.push({
    id: 'next-scan',
    label: 'Następny skan',
    value: next ? whenLabel(Date.parse(next) < now.getTime() ? now.toISOString() : next, now) : 'wyłączony',
    note: next ? (Date.parse(next) < now.getTime() ? 'zaległy — ruszy przy najbliższym sprawdzeniu' : 'według harmonogramu') : 'włącz harmonogram w widoku Skan',
    go: { view: 'scanner' },
  });
  return tiles;
}

export function installTodayView({ $, json, escapeHtml, showView, openOffers }) {
  const root = $('#todayBody');
  if (!root) return { refresh: async () => {} };
  const since = visitBaseline();
  let serial = 0;
  let last = null;

  function render(data) {
    const now = new Date();
    const tiles = todayTiles(data, now);
    const scan = data.scan?.status === 'running'
      ? `<button type="button" class="today-banner" data-go-view="scanner"><b>Skan trwa</b> od ${escapeHtml(whenLabel(data.scan.startedAt, now))} — przebieg w widoku Skan</button>`
      : '';
    $('#todaySince').textContent = data.scope === 'visit'
      ? 'od ostatniej wizyty: ' + whenLabel(data.since, now)
      : data.lastScan ? 'liczby z ostatniego skanu' : 'jeszcze nie było skanu';
    const reviewButton = $('#todayReview');
    reviewButton.textContent = data.queue?.decisions ? `Weryfikuj (${data.queue.decisions})` : 'Weryfikacja';
    root.innerHTML = `${scan}<div class="today-tiles">${tiles
      .map(
        (tile, index) =>
          `<button type="button" class="today-tile${tile.attention ? ' is-attention' : ''}${tile.warn ? ' is-warn' : ''}" data-tile="${index}"><span class="today-tile-label">${escapeHtml(tile.label)}</span><strong>${escapeHtml(String(tile.value))}</strong><small>${escapeHtml(tile.note)}</small></button>`,
      )
      .join('')}</div>
      <section class="today-sources" id="todaySources" aria-labelledby="todaySourcesTitle">
        <h3 id="todaySourcesTitle">Źródła</h3>
        <ul>${(data.sources || [])
          .map(
            (row) =>
              `<li class="is-${escapeHtml(row.state)}"><button type="button" data-source="${escapeHtml(row.source)}" title="Oferty z tego źródła"><i class="source-dot-state" aria-hidden="true"></i><b>${escapeHtml(row.source)}</b><span>${escapeHtml(sourceLine(row, now))}</span></button></li>`,
          )
          .join('')}</ul>
      </section>`;
    root.querySelectorAll('[data-tile]').forEach((button) =>
      button.addEventListener('click', () => {
        const tile = tiles[Number(button.dataset.tile)];
        if (tile.go.offers) openOffers(tile.go.offers);
        else if (tile.go.view) showView(tile.go.view);
        else if (tile.go.anchor) $('#' + tile.go.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }),
    );
    root.querySelectorAll('[data-source]').forEach((button) =>
      button.addEventListener('click', () => openOffers({ source: button.dataset.source, sort: 'newest' })),
    );
    root.querySelector('[data-go-view]')?.addEventListener('click', () => showView('scanner'));
  }

  async function refresh() {
    const request = ++serial;
    try {
      const data = await json('/api/today' + (since ? '?' + new URLSearchParams({ since }) : ''));
      if (request !== serial) return last;
      last = data;
      render(data);
      return data;
    } catch {
      if (!last) root.innerHTML = '<p class="inline-note">Nie udało się wczytać podsumowania. Spróbuję ponownie po odzyskaniu połączenia.</p>';
      return last;
    }
  }
  $('#todayScan')?.addEventListener('click', () => showView('scanner'));
  $('#todayReview')?.addEventListener('click', () => showView('review'));
  return { refresh, last: () => last };
}
