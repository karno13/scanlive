// Automatic recurring scan of one saved profile. Settings live in SQLite; the server runs the scans
// while the app is open, using the same endpoint and limits as a manual scan.
const when = (value) => new Date(value).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

/** What the last automatic run did, in words. */
export function describeResult(schedule) {
  const result = schedule.lastResult;
  const problems = schedule.lastProblems || [];
  const skipped = schedule.lastSkipped || [];
  const label =
    result === 'ok' ? 'udany'
      : result === 'partial' ? 'częściowo udany — błędy: ' + problems.join(', ')
        : result === 'all-sources-down' ? 'pominięty — żadne źródło profilu nie działało'
          : result === 'profile-missing' ? 'nie odbył się — profil nie istnieje'
            : result || 'brak wyniku';
  return label + (skipped.length ? '; pominięto niedziałające: ' + skipped.join(', ') : '');
}

const QUICK_RESULTS = { ok: 'udany', 'no-sortable-source': 'pominięty — profil nie ma źródła sortowanego od najnowszych (Vinted)', 'all-sources-down': 'pominięty — źródło nie działało', 'profile-missing': 'nie odbył się — profil nie istnieje' };
/** The quick scan of the newest listings, in words. */
export function describeQuick(schedule) {
  const quick = schedule.quick;
  if (!quick?.enabled) return 'Szybki skan jest wyłączony.';
  const last = quick.lastRunAt ? `Ostatni: ${when(quick.lastRunAt)} (${QUICK_RESULTS[quick.lastResult] || quick.lastResult || 'brak wyniku'}).` : 'Jeszcze się nie odbył.';
  const next = schedule.nextQuickRunAt ? ` Następny: ${when(Math.max(schedule.nextQuickRunAt, Date.now()))}.` : '';
  return `Co ${quick.everyHours} h. ${last}${next}`;
}

/** One line for the folded section header: on/off, interval and the next run. */
export function scheduleHeadline(schedule) {
  if (!schedule.enabled) return 'Automatyczny skan: wyłączony';
  const profile = schedule.profile === '__all__' ? 'wszystkie profile po kolei' : schedule.profile;
  const next = schedule.nextRunAt ? ' · następny ' + when(Math.max(schedule.nextRunAt, Date.now())) : '';
  const warn = schedule.lastResult && schedule.lastResult !== 'ok' ? ' · ostatni: ' + (schedule.lastResult === 'partial' ? 'z błędami' : 'nieudany') : '';
  return `Automatyczny skan: co ${schedule.everyHours} h (${profile})${next}${warn}`;
}

export async function mountScanSchedule({ panel, json, toast, escapeHtml }) {
  if (!panel) return;
  const root = document.createElement('details');
  root.className = 'scan-schedule';
  root.innerHTML = `<summary id="scheduleHeadline">Automatyczny skan</summary>
    <div class="scan-schedule-body">
      <label class="field"><span>Profil do skanowania</span><select id="scheduleProfile" aria-label="Profil do automatycznego skanu"></select></label>
      <label class="field"><span>Co ile godzin</span><input id="scheduleHours" type="number" min="1" max="168" step="1" value="24" inputmode="numeric"></label>
      <label class="check"><input id="scheduleEnabled" type="checkbox"> Skanuj automatycznie, gdy aplikacja jest uruchomiona</label>
      <p class="inline-note">Źródła, które nie działały w ostatnim skanie, są pomijane przez dobę, potem sprawdzane ponownie.</p>
      <fieldset class="quick-scan"><legend>Szybki skan najnowszych ofert</legend>
        <label class="check"><input id="quickEnabled" type="checkbox"> Między pełnymi skanami sprawdzaj tylko najnowsze ogłoszenia</label>
        <label class="field"><span>Co ile godzin</span><input id="quickHours" type="number" min="1" max="24" step="1" value="2" inputmode="numeric"></label>
        <p class="inline-note">Jedna strona wyników na frazę, posortowana od najnowszych — tylko w źródłach, które to umożliwiają (obecnie Vinted). Nie oznacza ofert jako znikniętych; robi to wyłącznie pełny skan. Nowe oferty widać w pasku „Od ostatniej wizyty”.</p>
        <p id="quickStatus" class="inline-note"></p>
      </fieldset>
      <button id="scheduleSave" class="button secondary compact" type="button">Zapisz harmonogram</button>
      <p id="scheduleStatus" class="inline-note" role="status" aria-live="polite"></p>
    </div>`;
  panel.append(root);
  const $ = (selector) => root.querySelector(selector);

  const describe = (schedule) => {
    if (!schedule.enabled) return 'Automatyczny skan jest wyłączony.';
    const last = schedule.lastRunAt ? `Ostatni: ${new Date(schedule.lastRunAt).toLocaleString('pl-PL')} (${describeResult(schedule)}).` : 'Jeszcze się nie odbył.';
    const rotation = schedule.profile === '__all__' && schedule.lastProfile ? ` Ostatni profil: ${schedule.lastProfile}.` : '';
    const next = schedule.nextRunAt ? ` Następny: ${new Date(Math.max(schedule.nextRunAt, Date.now())).toLocaleString('pl-PL')}.` : '';
    return last + rotation + next;
  };
  const show = (schedule) => {
    // Name, then interval and next run in muted text, then a flag when off or when the last run had errors.
    const meta = [
      schedule.enabled ? 'co ' + schedule.everyHours + ' h' + (schedule.nextRunAt ? ' · następny ' + when(Math.max(schedule.nextRunAt, Date.now())) : '') : '',
      schedule.quick?.enabled ? 'najnowsze co ' + schedule.quick.everyHours + ' h' : '',
    ].filter(Boolean).join(' · ');
    const flag = !schedule.enabled && !schedule.quick?.enabled
      ? '<span class="schedule-flag is-off">wyłączony</span>'
      : schedule.lastResult && schedule.lastResult !== 'ok'
        ? '<span class="schedule-flag">' + (schedule.lastResult === 'partial' ? 'ostatni z błędami' : 'ostatni nieudany') + '</span>'
        : '';
    $('#scheduleHeadline').innerHTML = 'Automatyczny skan' + (meta ? ' <span class="schedule-meta">' + escapeHtml(meta) + '</span>' : '') + flag;
    $('#scheduleHeadline').title = scheduleHeadline(schedule);
    root.classList.toggle('is-on', schedule.enabled);
    root.classList.toggle('is-warn', schedule.enabled && Boolean(schedule.lastResult) && schedule.lastResult !== 'ok');
  };

  async function load() {
    try {
      const [profiles, schedule] = await Promise.all([json('/api/scan-profiles'), json('/api/scan-schedule')]);
      const items = Array.isArray(profiles) ? profiles : profiles.items || [];
      $('#scheduleProfile').innerHTML =
        '<option value="">Wybierz profil</option>' +
        (items.length > 1 ? '<option value="__all__">Wszystkie profile po kolei</option>' : '') +
        items.map((item) => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join('');
      $('#scheduleProfile').value = schedule.profile || '';
      $('#scheduleHours').value = schedule.everyHours;
      $('#scheduleEnabled').checked = schedule.enabled;
      $('#quickEnabled').checked = Boolean(schedule.quick?.enabled);
      $('#quickHours').value = schedule.quick?.everyHours ?? 2;
      $('#quickStatus').textContent = describeQuick(schedule);
      show(schedule);
      $('#scheduleStatus').textContent = items.length
        ? describe(schedule)
        : 'Najpierw zapisz profil wyszukiwania, aby móc go skanować automatycznie.';
    } catch (error) {
      $('#scheduleStatus').textContent = 'Nie udało się wczytać harmonogramu: ' + error.message;
    }
  }

  $('#scheduleSave').addEventListener('click', async () => {
    const button = $('#scheduleSave');
    button.disabled = true;
    try {
      const saved = await json('/api/scan-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: $('#scheduleEnabled').checked,
          profile: $('#scheduleProfile').value,
          everyHours: Number($('#scheduleHours').value),
          quick: { enabled: $('#quickEnabled').checked, everyHours: Number($('#quickHours').value) },
        }),
      });
      $('#scheduleStatus').textContent = describe(saved);
      $('#quickStatus').textContent = describeQuick(saved);
      show(saved);
      toast('Zapisano harmonogram skanowania.');
    } catch (error) {
      toast(
        error.message === 'SCHEDULE_PROFILE_NOT_FOUND'
          ? 'Wybierz zapisany profil.'
          : error.message === 'INVALID_SCHEDULE_INTERVAL'
            ? 'Podaj liczbę godzin od 1 do 168.'
            : error.message === 'INVALID_QUICK_SCAN_INTERVAL'
              ? 'Szybki skan: podaj liczbę godzin od 1 do 24.'
              : 'Nie zapisano harmonogramu: ' + error.message,
      );
    } finally {
      button.disabled = false;
    }
  });
  root.addEventListener('toggle', () => {
    if (root.open) void load();
  });
  // Shown without opening the section; refreshed after each scan (it may have been the scheduled one).
  for (const name of ['bookflip-scan-complete', 'bookflip-profiles-changed']) document.addEventListener(name, () => void load());
  await load();
}
