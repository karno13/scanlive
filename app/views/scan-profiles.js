// Browser storage is read only for explicit legacy migration; live profiles are in SQLite.
import { confirmDialog } from '../core/dialogs.js';
import { escapeHtml } from '../core/formatters.js';
import { MAX_SCAN_QUERIES } from '../core/scan-limits.js';
const KEY = 'bookflip-scan-profiles-v1';
function readLegacyProfiles() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value.filter(p =>
      p && typeof p.name === 'string' && Array.isArray(p.queries) &&
      Array.isArray(p.sources)).slice(0,30) : [];
  } catch { return []; }
}
/** Phrases typed in the form: one per line (a title may contain a comma), without repeats. */
export const phrasesOf = (text) => [...new Set(String(text || '').split(/\n/).map(x => x.trim()).filter(Boolean))];

/** Phrases that brought no new listing for `days` (offers seen before, nothing fresh since). */
export function stalePhrases(queries, items = []) {
  const byQuery = new Map(items.map(item => [String(item.query).toLocaleLowerCase('pl'), item]));
  return queries.filter(query => {
    const row = byQuery.get(query.toLocaleLowerCase('pl'));
    return row && row.offers > 0 && !row.fresh;
  });
}

export async function installScanProfiles({ queriesInput, sourceGrid, panel, toast, json, deadSources = () => new Set(), startScan = null }) {
  if (!queriesInput || !sourceGrid || !panel) return;
  if (typeof json !== 'function') throw Error('SCAN_PROFILES_API_REQUIRED');
  let profiles = [];
  let freshness = null;
  const chips = document.querySelector('#profileChips');
  const staleNote = document.querySelector('#queryFreshness');
  const root = document.createElement('details');
  root.className = 'scan-profiles';
  const title = document.createElement('summary');
  title.textContent = 'Zarządzaj profilami';
  const picker = document.createElement('select');
  picker.setAttribute('aria-label','Wybierz profil skanowania');
  const name = document.createElement('input');
  name.placeholder = 'Nazwa profilu';
  name.maxLength = 60;
  name.setAttribute('aria-label','Nazwa nowego profilu');
  const button = (label, primary = false) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 'button ' + (primary ? 'primary' : 'secondary') + ' compact';
    node.textContent = label;
    return node;
  };
  const load = button('Wczytaj profil');
  const save = button('Zapisz nowy profil');
  const remove = button('Usuń profil');
  const importButton = button('Importuj lokalne profile');
  const update = button('Aktualizuj wybrany profil');
  const undo = button('Cofnij usunięcie'); undo.hidden = true;
  const buttons = document.createElement('div');
  buttons.className = 'scan-profile-actions';
  let deletedProfile=null;
  buttons.append(load,save,update,remove,undo);
  document.querySelector('#legacyImportActions')?.append(importButton);
  root.append(title,picker,name,buttons);
  panel.append(root);

  // The form changed from code: let the scan estimate and the stale-phrase note follow.
  function formChanged() {
    queriesInput.dispatchEvent(new Event('input', { bubbles: true }));
    sourceGrid.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function showStale() {
    if (!staleNote) return;
    const queries = phrasesOf(queriesInput.value);
    if (!queries.length) { staleNote.hidden = true; return; }
    try {
      freshness ??= await json('/api/scan-queries/freshness');
    } catch {
      staleNote.hidden = true;
      return;
    }
    const stale = stalePhrases(queries, freshness.items);
    staleNote.hidden = !stale.length;
    staleNote.innerHTML = stale.length
      ? `Bez nowych ofert od ${Number(freshness.days)} dni: <b>${escapeHtml(stale.join(', '))}</b>. Rozważ zamianę ${stale.length === 1 ? 'tej frazy' : 'tych fraz'} na inne — limit to ${MAX_SCAN_QUERIES} fraz.`
      : '';
  }
  let staleTimer = null;
  queriesInput.addEventListener('input', () => { clearTimeout(staleTimer); staleTimer = setTimeout(() => void showStale(), 400); });

  /** Puts a profile into the form; sources that did not work in the last scan stay unchecked. */
  function applyProfile(profile) {
    queriesInput.value = profile.queries.join('\n');
    const dead = deadSources() || new Set();
    const available = [...sourceGrid.querySelectorAll('input[type="checkbox"]')];
    available.forEach(input => { input.checked = profile.sources.includes(input.value) && !dead.has(input.value); });
    const missing = profile.sources.filter(id => !available.some(input => input.value === id));
    const off = profile.sources.filter(id => dead.has(id));
    picker.value = profile.name;
    formChanged();
    chips?.querySelectorAll('[data-profile]').forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.profile === profile.name)));
    return [
      missing.length ? 'Niedostępne źródła: ' + missing.join(', ') + '.' : '',
      off.length ? 'Pominięto niedziałające: ' + off.join(', ') + '.' : '',
    ].filter(Boolean).join(' ');
  }

  function renderChips() {
    if (!chips) return;
    chips.hidden = !profiles.length;
    chips.innerHTML = profiles.length
      ? '<span class="profile-chips-label">Profile:</span>' + profiles.map(item =>
        `<span class="profile-chip"><button type="button" class="profile-chip-load" data-profile="${escapeHtml(item.name)}" aria-pressed="false" title="Wczytaj frazy i źródła (${item.queries.length} fraz)">${escapeHtml(item.name)} <small>${item.queries.length}</small></button><button type="button" class="profile-chip-run" data-profile-run="${escapeHtml(item.name)}" aria-label="Skanuj profil ${escapeHtml(item.name)}" title="Wczytaj i od razu skanuj">▶</button></span>`).join('')
      : '';
  }
  chips?.addEventListener('click', event => {
    const target = event.target.closest('[data-profile], [data-profile-run]');
    if (!target) return;
    const profile = profiles.find(item => item.name === (target.dataset.profile ?? target.dataset.profileRun));
    if (!profile) return;
    const note = applyProfile(profile);
    if (target.dataset.profileRun !== undefined && startScan) {
      if (note) toast(note);
      void startScan();
    } else toast(note ? 'Wczytano profil. ' + note : 'Wczytano profil „' + profile.name + '”.');
  });

  function refresh(selected = '') {
    picker.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Wybierz profil';
    picker.append(empty);
    for (const item of profiles) {
      const option = document.createElement('option');
      option.value = item.name;
      option.textContent = item.name;
      picker.append(option);
    }
    picker.value = selected;
    importButton.hidden = readLegacyProfiles().length === 0;
    renderChips();
  }
  async function reload(selected = '') {
    const response = await json('/api/scan-profiles');
    profiles = response.items || [];
    refresh(selected);
    // Profiles changed: the schedule's profile list follows.
    document.dispatchEvent(new CustomEvent('bookflip-profiles-changed'));
  }
  save.addEventListener('click', async () => {
    const profileName = name.value.trim();
    if (!profileName) return toast('Wpisz nazwę profilu.');
    if (profiles.some(profile=>profile.name===profileName)) return toast('Ta nazwa już istnieje. Wybierz profil i użyj Aktualizuj.');
    const queries = phrasesOf(queriesInput.value);
    if(queries.length>MAX_SCAN_QUERIES) return toast(`Profil może zawierać najwyżej ${MAX_SCAN_QUERIES} fraz.`);
    const sources = [...sourceGrid.querySelectorAll('input:checked')].map(input => input.value);
    if (!queries.length || !sources.length) return toast('Profil wymaga fraz i wybranych źródeł.');
    save.disabled = true;
    try {
      await json('/api/scan-profiles', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:profileName,queries,sources}),
      });
      await reload(profileName);
      toast('Zapisano profil w SQLite.');
    } catch(error) {toast('Błąd zapisu profilu: '+error.message);}
    finally {save.disabled=false;}
  });
  load.addEventListener('click', () => {
    const profile = profiles.find(p => p.name === picker.value);
    if (!profile) return;
    const note = applyProfile(profile);
    toast(note ? 'Wczytano profil. ' + note : 'Wczytano profil.');
  });
  remove.addEventListener('click', async () => {
    if (!picker.value) return;
    deletedProfile=profiles.find(profile=>profile.name===picker.value);
    remove.disabled=true;
    try {
      await json('/api/scan-profiles/'+encodeURIComponent(picker.value),{method:'DELETE'});
      await reload();
      undo.hidden=false;
      toast('Usunięto profil. Możesz cofnąć tę operację.');
    } catch(error) {toast('Błąd usuwania profilu: '+error.message);}
    finally {remove.disabled=false;}
  });
  importButton.addEventListener('click', async () => {
    const legacy = readLegacyProfiles();
    if (!legacy.length || !(await confirmDialog('Zaimportować profile do SQLite? Istniejące profile nie będą nadpisane.', { title: 'Import profili', confirmLabel: 'Importuj' }))) return;
    importButton.disabled=true;
    let created=0,skipped=0,failed=0;
    try {
      for (const item of legacy) {
        try {
          const outcome = await json('/api/scan-profiles/import',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name:item.name,queries:item.queries,sources:item.sources}),
          });
          if (outcome.created) created++; else skipped++;
        } catch {failed++;}
      }
      await reload();
      toast(`Import: ${created} nowych, ${skipped} pominiętych, ${failed} błędnych. Dane lokalne zachowano.`);
    } catch(error) {toast('Błąd odczytu profili: '+error.message);}
    finally {importButton.disabled=false;}
  });
  update.addEventListener('click',async()=>{
    if(!picker.value) return toast('Wybierz profil do aktualizacji.');
    const queries=phrasesOf(queriesInput.value);
    const sources=[...sourceGrid.querySelectorAll('input:checked')].map(input=>input.value);
    if(!queries.length||queries.length>MAX_SCAN_QUERIES||!sources.length) return toast(`Wymagane od 1 do ${MAX_SCAN_QUERIES} fraz i przynajmniej jedno źródło.`);
    update.disabled=true;
    try{await json('/api/scan-profiles/'+encodeURIComponent(picker.value),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({queries,sources})});await reload(picker.value);toast('Zaktualizowano profil.');}catch{toast('Nie zapisano profilu. Spróbuj ponownie.');}finally{update.disabled=false;}
  });
  undo.addEventListener('click',async()=>{
    if(!deletedProfile) return;undo.disabled=true;
    try{const response=await json('/api/scan-profiles/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(deletedProfile)});if(!response.created) return toast('Nazwa jest już zajęta. Nie nadpisano profilu.');await reload(deletedProfile.name);undo.hidden=true;}catch{toast('Nie udało się przywrócić profilu.');}finally{undo.disabled=false;}
  });
  // A scan just finished: freshness numbers changed.
  document.addEventListener('bookflip-scan-complete', () => { freshness = null; void showStale(); });
  await reload();
  void showStale();
  // The schedule section lists the same profiles (one request at start-up instead of two).
  return profiles;
}
