import { json } from '../core/api.js';
import { escapeHtml, SOURCE_PROBLEMS, problemLabel } from '../core/formatters.js';

export { SOURCE_PROBLEMS, problemLabel };

// "Przebieg skanu": one panel for the running or last scan, read from the server's diagnostics.
// It works the same whichever tab, phone or schedule started the scan, and after a reload.

// Errors that pass by themselves; worth retrying. Bot checks (CAPTCHA, 403) and broken adapters are not.
export const TRANSIENT_CODES = new Set(['SOURCE_HTTP_429', 'SOURCE_HTTP_500', 'SOURCE_HTTP_502', 'SOURCE_HTTP_503', 'SOURCE_HTTP_504', 'SOURCE_TIMEOUT', 'SOURCE_REQUEST_FAILED']);
/** One failed task of a saved scan run: should "retry" send it again? */
export const isRetryableError = (error = {}) => !error.blocked && !error.skipped && error.retryable !== false && TRANSIENT_CODES.has(error.code);

/** One source row: state label and tone from the diagnostics counters. */
export function sourceState(row = {}) {
  if (row.status === 'pending') return { label: 'czeka', tone: 'neutral' };
  if (row.status === 'running' || row.status === 'retrying') return { label: row.status === 'retrying' ? 'ponawia…' : 'skanuje…', tone: 'warning' };
  if (!row.errors) return { label: 'OK', tone: 'success' };
  if (row.offers > 0) return { label: 'częściowo', tone: 'warning' };
  // HTTP 429 alone: the source answers, only slower. Amber, not red.
  if (row.lastError === 'SOURCE_HTTP_429') return { label: 'ogranicza tempo', tone: 'warning' };
  return { label: 'nie działa', tone: 'error' };
}

export const REJECTION_LABELS = {
  language: 'w obcym języku',
  language_unknown: 'bez podanego języka (Vinted)',
  topic: 'spoza tematu frazy',
  product: 'to nie książki (gry, figurki…)',
};
const minutes = (seconds) => (!Number.isFinite(seconds) ? '—' : seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`);
const when = (value) => (value ? new Date(value).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export function createScanRun({ $ }) {
  let timer = null;
  let soon = null;
  let busy = false;
  let last = null;
  let lastStatus = null;
  // Seconds one source × phrase task took in the last finished scan (for the estimate before a scan).
  let perTask = null;
  try {
    perTask = Number(globalThis.localStorage?.getItem('bookflip.secondsPerTask')) || null;
  } catch {}

  function render(data) {
    last = data;
    const panel = $('#scanRun');
    const diagnostics = data.diagnostics || {};
    const status = data.status || 'idle';
    const entries = Object.entries(diagnostics.sources || {});
    // After a server restart the diagnostics are empty, but the saved run's actions (#scanResults) stay.
    panel.hidden = !entries.length && $('#scanResults').hidden;
    for (const part of panel.querySelectorAll?.('.scan-run-totals, .table-wrap, .progress-track, .scan-run-current') || []) part.hidden = !entries.length;
    if (!entries.length) {
      $('#scanRunTitle').textContent = 'Ostatni skan';
      $('#scanRunMeta').textContent = '';
      $('#scanRunAdvice').innerHTML = '';
      return;
    }
    const running = status === 'running';
    const progress = data.progress || {};
    const telemetry = data.telemetry || {};
    const defaultTasks = entries.length ? Math.round((diagnostics.totalTasks || 0) / entries.length) : 0;
    panel.dataset.state = status;
    $('#scanRunTitle').textContent = running ? 'Skan trwa' : ({ completed: 'Ostatni skan', cancelled: 'Skan anulowany', failed: 'Skan nieudany', interrupted: 'Skan przerwany' })[status] || 'Ostatni skan';
    const elapsed = running
      ? telemetry.elapsedSeconds
      : Math.max(0, Math.round((Date.parse(data.finishedAt || '') - Date.parse(data.startedAt || diagnostics.startedAt || '')) / 1000));
    if (!running && Number.isFinite(elapsed) && elapsed > 0 && progress.total) {
      perTask = elapsed / progress.total;
      try {
        globalThis.localStorage?.setItem('bookflip.secondsPerTask', String(perTask));
      } catch {}
    }
    $('#scanRunMeta').textContent = [
      when(data.startedAt || diagnostics.startedAt),
      Number.isFinite(elapsed) ? (running ? 'trwa ' : 'trwał ') + minutes(elapsed) : '',
      running && telemetry.etaSeconds != null ? 'zostało ok. ' + minutes(telemetry.etaSeconds) : '',
    ].filter(Boolean).join(' · ');
    $('#progressBar').style.width = `${progress.percent || (running ? 0 : 100)}%`;
    $('#progressTrack').dataset.indeterminate = running && !progress.completed ? 'true' : 'false';
    if (!panel.dataset.local) {
      // Another tab, the phone or the schedule runs it: describe the current task from the server.
      const active = telemetry.active;
      $('#progressMessage').textContent = running
        ? active ? `${active.source}: ${active.query}` : 'Oczekiwanie na następne zadanie'
        : `Zapisano ${Number(data.summary?.offers ?? diagnostics.offersSeen ?? 0)} ofert`;
      $('#progressDetail').textContent = running && active?.page ? `strona ${active.page}` : '';
    }
    const problems = entries.filter(([, row]) => row.errors).length;
    const fresh = Number(data.summary?.newOffers ?? diagnostics.newOffers ?? 0);
    $('#scanRunTotals').innerHTML = [
      ['Zapytania', `${progress.completed || 0} / ${progress.total || 0}`],
      ['Oferty', Number(diagnostics.offersSeen || 0)],
      ['Nowe', fresh],
      ['Źródła z problemami', problems],
    ].map(([label, value], index) => `<div class="${index === 3 && problems ? 'is-warn' : ''}"><span>${label}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('');
    $('#scanRunSources').innerHTML = entries
      .map(([name, row]) => {
        const state = sourceState(row);
        const tasks = row.tasks || defaultTasks;
        const issue = row.lastError ? problemLabel(row.lastError) : '';
        return `<tr><td><span class="source-dot" data-source="${escapeHtml(name)}"></span><strong>${escapeHtml(name)}</strong></td><td>${row.completed || 0}/${tasks}</td><td>${Number(row.offers || 0)}</td><td>${row.newOffers == null ? '—' : Number(row.newOffers)}</td><td><span class="status-pill ${state.tone}">${state.label}</span>${issue ? `<small class="scan-run-issue">${escapeHtml(issue)}${row.errors > 1 ? ` · ${row.errors}×` : ''}</small>` : ''}</td></tr>`;
      })
      .join('');
    // Advice once per kind of problem, with the sources that hit it.
    const byCode = new Map();
    for (const [name, row] of entries) if (row.lastError) byCode.set(row.lastError, [...(byCode.get(row.lastError) || []), name]);
    const dead = entries.filter(([, row]) => sourceState(row).label === 'nie działa').map(([name]) => name);
    // Listings the scan left out before saving them, by reason.
    const rejected = Object.entries(data.summary?.rejected || {}).filter(([, count]) => Number(count) > 0);
    const rejectedLine = running || !rejected.length
      ? ''
      : `<p class="scan-run-rejected"><b>Pominięte przed zapisem:</b> ${rejected
          .map(([reason, count]) => `${Number(count)} ${escapeHtml(REJECTION_LABELS[reason] || reason)}`)
          .join(' · ')}</p>`;
    $('#scanRunAdvice').innerHTML = rejectedLine + (running || !byCode.size
      ? ''
      : [...byCode].map(([code, names]) => `<p><b>${escapeHtml(names.join(', '))}:</b> ${escapeHtml(SOURCE_PROBLEMS[code]?.[1] || 'Źródło zgłosiło nieznany błąd.')}${TRANSIENT_CODES.has(code) ? '' : ' <small>(„Ponów chwilowe błędy” pomija ten problem)</small>'}</p>`).join('') +
        (dead.length ? `<button type="button" class="button secondary compact" id="scanRunUncheck">Odznacz niedziałające źródła (${escapeHtml(dead.join(', '))})</button>` : ''));
    $('#scanRunUncheck')?.addEventListener('click', () => {
      for (const input of document.querySelectorAll('#sourceGrid input'))
        if (dead.includes(input.value) && input.checked) {
          input.checked = false;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      $('#scanRunUncheck').textContent = 'Odznaczono — zapisz wybór w profilu, jeśli ma zostać na stałe';
      $('#scanRunUncheck').disabled = true;
    });
  }

  async function refresh() {
    if (busy) return last;
    busy = true;
    clearTimeout(timer);
    try {
      const data = await json('/api/scan/diagnostics');
      render(data);
      // A scan this tab did not start (schedule, phone, another tab) just ended: refresh the lists.
      if (lastStatus === 'running' && data.status !== 'running' && !$('#scanRun').dataset.local && typeof document !== 'undefined')
        document.dispatchEvent(new CustomEvent('bookflip-remote-scan-complete'));
      lastStatus = data.status;
      // While a scan runs the server's live channel (scan events) asks for the next refresh.
      return data;
    } catch {
      return last;
    } finally {
      busy = false;
    }
  }
  /** Coalesces bursts of stream events into one refresh. */
  function refreshSoon() {
    if (soon) return;
    soon = setTimeout(() => {
      soon = null;
      void refresh();
    }, 600);
  }
  /** This tab started the scan: its stream writes the current-task line itself. */
  function setLocal(local) {
    if (local) $('#scanRun').dataset.local = '1';
    else delete $('#scanRun').dataset.local;
  }
  /** Seconds per task measured in the last finished scan, or null before the first one. */
  const secondsPerTask = () => perTask;
  return { refresh, refreshSoon, setLocal, secondsPerTask };
}
