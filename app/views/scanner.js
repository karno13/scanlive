import { problemTasks } from '../core/formatters.js';
import { readSearchStream } from '../scan-stream.js';
import { MAX_SCAN_QUERIES } from '../core/scan-limits.js';

export async function requestScanCancellation({ $, toast }) {
  const button = $('#cancelSearch');
  button.disabled = true;
  button.textContent = 'Anulowanie…';
  try {
    const response = await fetch('/api/search/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!response.ok) throw Error('CANCEL_HTTP_' + response.status);
    $('#scanGuardMessage').textContent = 'Trwa zatrzymywanie skanu. Wcześniej zapisane oferty pozostają w katalogu.';
  } catch (error) {
    toast('Nie udało się anulować skanu: ' + error.message);
    button.disabled = false;
    button.textContent = 'Anuluj skan';
  }
}


// Scanner view: starts a scan and follows its stream. Counters and the per-source table live in
// the "Przebieg skanu" panel (scan-run.js), read from the server, so they are right whichever tab
// or schedule started the scan; the stream only makes this tab's panel update without delay.
export function createScannerView({ state, $, escapeHtml, shortTime, readQueries, selectedSources, toast, loadHistory, loadCatalogStatus, loadCatalogData, scanRun = null, storage = globalThis.localStorage }) {
// A scan takes minutes: when the tab is in the background, say that it finished.
function askToNotify() {
  try {
    if (globalThis.Notification?.permission === 'default') void Notification.requestPermission().catch(() => {});
  } catch {}
}
function notifyDone(text) {
  try {
    if (typeof document !== 'undefined' && document.hidden && globalThis.Notification?.permission === 'granted') new Notification('BookFlip', { body: text, tag: 'bookflip-scan' });
  } catch {}
}

function resetScanUi(queries, sources, tasks = null) {
  state.scan.total = tasks?.length || queries.length * sources.length;
  state.scan.completed = 0;
  $('#scanRun').hidden = false;
  $('#progressBar').style.width = '0%';
  $('#progressTrack').dataset.indeterminate = 'true';
  $('#progressMessage').textContent = 'Przygotowywanie skanu…';
  $('#progressDetail').textContent = '';
  $('#scanStateBadge').textContent = 'Skanowanie';
  $('#scanStateBadge').className = 'state-badge warning';
  scanRun?.setLocal(true);
  scanRun?.refreshSoon();
}

// Kept for callers that render the table after a scan; the run panel owns it now.
function renderSourceRows() {
  scanRun?.refreshSoon();
}

// Offers saved during the scan: refresh the lists at most every few seconds.
let liveRefreshTimer = null;
function scheduleLiveRefresh() {
  if (liveRefreshTimer) return;
  liveRefreshTimer = setTimeout(async () => {
    liveRefreshTimer = null;
    try {
      await Promise.all([loadHistory(), loadCatalogData()]);
    } catch {
      // The final refresh after the scan will retry.
    }
  }, 3000);
}

function updateProgress(event) {
  if (event.type === 'offers-saved') {
    $('#progressDetail').textContent = `zapisano ${event.saved} ofert (${event.newOffers || 0} nowych)`;
    scheduleLiveRefresh();
  }
  if (event.type === 'source-start' || event.type === 'page-start') {
    $('#progressMessage').textContent = `${event.source}: ${event.query}`;
    $('#progressDetail').textContent = event.type === 'page-start' ? `strona ${event.page}` : 'Łączenie ze źródłem';
  }
  if (event.type === 'page-done') $('#progressDetail').textContent = `strona ${event.page}: ${event.count} ofert`;
  if (event.type === 'language-progress')
    // Vinted listings without a stated language are left out (they may be foreign books): say how many.
    $('#progressDetail').textContent = `Weryfikacja języka ${event.checked}/${event.total}` + (event.unknown ? ` · bez podanego języka: ${event.unknown} (pominięte)` : '');
  if (event.type === 'retry') $('#progressDetail').textContent = `ponowienie ${event.attempt}/${event.maxAttempts} (${event.code || 'błąd tymczasowy'})`;
  if (event.type === 'source-done') state.scan.completed += 1;
  if (['source-done', 'source-error', 'offers-saved'].includes(event.type)) scanRun?.refreshSoon();
}

async function startSearch(options = {}) {
  if (state.scan.running) return;
  const tasks = Array.isArray(options.tasks) ? options.tasks : null;
  const queries = tasks ? [...new Set(tasks.map(task=>task.query))] : readQueries(),
    sources = tasks ? [...new Set(tasks.map(task=>task.source))] : selectedSources();
  if (!queries.length) return toast('Dodaj przynajmniej jedną frazę.');
  if (queries.length > MAX_SCAN_QUERIES) return toast(`Wpisano ${queries.length} fraz. Maksymalnie ${MAX_SCAN_QUERIES} — usuń nadmiar lub podziel je na profile.`);
  if (!sources.length) return toast('Wybierz przynajmniej jedno źródło.');
  const fingerprint = JSON.stringify({ queries, sources: [...sources].sort() });
  if (state.scan.fingerprint === fingerprint && Date.now() - state.scan.lastStart < 5000)
    return toast('Ten sam skan został przed chwilą uruchomiony.');
  askToNotify();
  state.scan.running = true;
  state.scan.fingerprint = fingerprint;
  state.scan.lastStart = Date.now();
  state.scan.startedAt = Date.now();
  try {
    storage.setItem('bookflip-search', JSON.stringify({ queries, sources }));
  } catch {
    // Storage may be unavailable; scanning should still work.
  }
  resetScanUi(queries, sources, tasks);
  state.scan.liveNew = 0;
  $('#startSearch').disabled = true;
  $('#cancelSearch').hidden = false;
  $('#cancelSearch').disabled = false;
  $('#cancelSearch').textContent = 'Anuluj skan';
  $('#startSearch').textContent = 'Skanowanie...';
  $('#scanGuardMessage').textContent = 'Skan trwa na serwerze także po zamknięciu karty. Aby go zatrzymać, kliknij Anuluj skan.';
  state.scan.timer = setInterval(() => {
    const seconds = Math.floor((Date.now() - state.scan.startedAt) / 1000);
    $('#progressElapsed').textContent = seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
  }, 1000);
  try {
    const response = await fetch('/api/search?stream=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries, sources, ...(tasks ? {tasks} : {}) }),
    });
    if (!response.ok) throw Error(`SEARCH_HTTP_${response.status}`);
    state.scan.result = await readSearchStream(response, updateProgress);
    state.scan.completed = state.scan.total;
    const summary = state.scan.result.summary || {};
    const problems=(state.scan.result.results || []).filter(row=>row.status!=='ok').length;
    $('#progressMessage').textContent=problems ? `Zapisano ${summary.offers || 0} ofert; ${problemTasks(problems)}` : `Zapisano ${summary.offers || 0} ofert`;
    $('#progressDetail').textContent = '';
    document.dispatchEvent(new CustomEvent('bookflip-scan-complete'));
    $('#scanStateBadge').textContent = problems ? 'Zakończony z problemami' : 'Zakończony';
    $('#scanStateBadge').className = problems ? 'state-badge warning' : 'state-badge neutral';
    await Promise.all([loadHistory(), loadCatalogStatus(), loadCatalogData()]);
    toast(`Skan zakończony: ${summary.offers || 0} ofert.`);
    notifyDone(`Skan zakończony: ${summary.offers || 0} ofert` + (summary.newOffers != null ? `, ${summary.newOffers} nowych` : "") + (problems ? `, ${problemTasks(problems)}.` : "."));
  } catch (error) {
    if (error.message === 'SCAN_CANCELLED') {
      $('#progressMessage').textContent = 'Skan anulowany';
      $('#progressDetail').textContent = 'Oferty z zadań ukończonych przed anulowaniem zostały zapisane.';
      void Promise.all([loadHistory(), loadCatalogData()]).catch(() => {});
      $('#scanStateBadge').textContent = 'Anulowany';
      $('#scanStateBadge').className = 'state-badge neutral';
      toast('Skan został anulowany.');
      return;
    }
    $('#progressMessage').textContent = 'Nie udało się potwierdzić zakończenia skanu';
    $('#progressDetail').textContent = error.message;
    $('#scanStateBadge').textContent = 'Błąd';
    $('#scanStateBadge').className = 'state-badge warning';
    toast(`Nie udało się wykonać skanu: ${error.message}`);
  } finally {
    scanRun?.setLocal(false);
    void scanRun?.refresh();
    clearInterval(state.scan.timer);
    state.scan.running = false;
    $('#cancelSearch').hidden = true;
    $('#startSearch').disabled = false;
    $('#startSearch').textContent = 'Skanuj';
    $('#progressElapsed').textContent = '';
    $('#scanGuardMessage').textContent = '';
  }
}


  if(typeof document!=='undefined') document.addEventListener('bookflip-retry-scan',event=>{void startSearch({tasks:event.detail});});
  return { startSearch, resetScanUi, renderSourceRows, updateProgress };
}
