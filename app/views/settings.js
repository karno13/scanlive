export function createSettingsView({ state, $, escapeHtml, loadCatalogStatus, fetcher = fetch, clock = performance }) {
function renderSettings() {
  if (!state.catalog) loadCatalogStatus();
}
async function runDiagnostics() {
  const button = $('#runDiagnostics');
  button.disabled = true;
  $('#diagnosticResults').innerHTML =
    '<div class="diagnostic-result"><strong>Trwa test...</strong><small>Lokalne endpointy</small></div>';
  const checks = [
    ['Źródła', '/api/sources'],
    ['Historia ofert', '/api/history'],
    ['Katalog', '/api/catalog/status'],
  ];
  try {
  const results = await Promise.all(
    checks.map(async ([name, url]) => {
      const started = clock.now();
      try {
        const response = await fetcher(url);
        return {
          name,
          ok: response.ok,
          ms: Math.round(clock.now() - started),
          code: response.status,
        };
      } catch {
        return { name, ok: false, ms: Math.round(clock.now() - started), code: 'ERR' };
      }
    }),
  );
  $('#diagnosticResults').innerHTML = results
    .map(
      (result) =>
        `<div class="diagnostic-result"><strong>${escapeHtml(result.name)} - ${result.ok ? 'OK' : 'BLAD'}</strong><small>${result.code} / ${result.ms} ms</small></div>`,
    )
    .join('');
  } finally {
    button.disabled = false;
  }
}


// Per-phrase yield: shows which searches feed the catalogue and which only add manual work.
function mountQueryStats(json) {
  const panel = $('#queryStats');
  const body = $('#queryStatsBody');
  if (!panel || !body) return;
  let loaded = false;
  panel.addEventListener('toggle', async () => {
    if (!panel.open || loaded) return;
    loaded = true;
    body.textContent = 'Wczytuję…';
    try {
      const { items, profiles = [], soldWithinDays = 14 } = await json('/api/scan-queries/stats');
      const zl = (grosze) => (grosze == null ? '–' : (grosze / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł');
      // Sold within 14 days: of the offers seen at least 14 days ago; "–" until there are any.
      const fast = (row) =>
        row.soldWithin14Base ? `${row.soldWithin14}/${row.soldWithin14Base} (${Math.round(100 * row.soldWithin14Share)}%)` : '–';
      const market = (row) => `<td>${fast(row)}</td><td>${row.sold ? `${zl(row.soldMedian)} <small>(${row.sold})</small>` : '–'}</td><td>${row.over50}</td>`;
      const profileTable = profiles.length
        ? `<h4>Profile skanu — porównanie nisz</h4><table class="niche-table"><thead><tr><th>Profil</th><th>Oferty</th><th>Mediana dostępnych</th><th>Sprzedane w ${soldWithinDays} dni</th><th>Mediana sprzedanych</th><th>Powyżej 50 zł</th></tr></thead><tbody>${profiles
            .map((row) => `<tr><td><b>${escapeHtml(row.name)}</b><small>${escapeHtml((row.queries || []).join(', '))}</small></td><td>${row.offers}</td><td>${zl(row.liveMedian)}</td>${market(row)}</tr>`)
            .join('')}</tbody></table><p class="inline-note">„Sprzedane w ${soldWithinDays} dni” liczy tylko oferty widziane po raz pierwszy co najmniej ${soldWithinDays} dni temu — nowy profil pokaże wynik po dwóch tygodniach. Sprzedaż to strona ogłoszenia ze statusem „Sprzedane” (Vinted).</p>`
        : '';
      body.innerHTML = items.length
        ? `${profileTable}<h4>Frazy</h4><table><thead><tr><th>Fraza</th><th>Źródło</th><th>Oferty</th><th>W katalogu</th><th>Czeka</th><th>Bez ISBN</th><th>Sprzedane w ${soldWithinDays} dni</th><th>Mediana sprzedanych</th><th>Powyżej 50 zł</th></tr></thead><tbody>${items
            .map(
              (row) =>
                `<tr><td>${escapeHtml(row.query)}</td><td>${escapeHtml(row.source)}</td><td>${row.offers}</td><td>${row.matched} (${Math.round((100 * row.matched) / row.offers)}%)</td><td>${row.waiting}</td><td>${row.withoutIsbn}</td>${market(row)}</tr>`,
            )
            .join('')}</tbody></table>`
        : '<p class="inline-note">Brak danych — wykonaj skan.</p>';
    } catch (error) {
      loaded = false;
      body.textContent = 'Nie udało się wczytać statystyk: ' + error.message;
    }
  });
}

return { renderSettings, runDiagnostics, mountQueryStats };
}
