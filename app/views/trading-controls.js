import { openDetailView } from '../core/detail-navigation.js';
import { amountInput, readAmount, statusLabel, markDirty,watchForm } from '../core/ux.js';
import { confirmDialog } from '../core/dialogs.js';
import { sourceHealthNote, escapeHtml, problemLabel, problemTasks } from '../core/formatters.js';
import { isRetryableError } from './scan-run.js';
export function installTradingControls({state,$,json,toast,showView,loadCatalogData,loadCatalogStatus,openOfferDrawer,onOfferFilters,onCatalogFilters}) {
  const write=(path,body,method='PUT')=>json(path,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let settingsLoaded=false;
  let savedDefaults=()=>{};
  for(const input of ['#catalogAuthor','#catalogLanguage','#catalogPublisher','#catalogYear','#catalogBinding']) $(input).addEventListener('input',onCatalogFilters);
  for(const input of ['#offerScan','#offerScanChange']) $(input).addEventListener('change',onOfferFilters);
  for(const input of ['#offerMinPrice','#offerMaxPrice']) $(input).addEventListener('input',onOfferFilters);
  $('#offerQuickViews').querySelectorAll('[data-purchase-view]').forEach(button=>button.addEventListener('click',()=>{
    state.offerView=button.dataset.purchaseView;
    $('#offerQuickViews').querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    onOfferFilters();
  }));
  // The run panel's footer: one button per next step, each with its count; the likely one is primary.
  function renderScanResultCard(run) {
    const queue = state.catalogPages?.jobs?.total;
    const labels = {
      '#scanNewResults': ['Nowe oferty', run.newOffers],
      '#scanPriceResults': ['Zmiany cen', run.priceChanges],
      '#scanReviewResults': ['Do weryfikacji', Number.isFinite(queue) ? queue : null],
      '#scanAllResults': ['Wszystkie z tego skanu', run.found],
    };
    const prefer = run.newOffers > 0 ? '#scanNewResults' : queue > 0 ? '#scanReviewResults' : '#scanAllResults';
    for (const [id, [label, count]] of Object.entries(labels)) {
      $(id).textContent = count == null ? label : label + ' (' + count + ')';
      $(id).className = 'button ' + (id === prefer ? 'primary' : 'secondary');
      $(id).disabled = count === 0 && id !== '#scanAllResults';
    }
  }
  /** Failed tasks of a saved run that are worth sending again (not bot checks, not skipped ones). */
  const retryable = (run) => (run?.errors || []).filter(isRetryableError);
  /**
   * "14 zadań z problemami" opens the list of those tasks: per source and reason, which phrases
   * failed and which were skipped after the block; and leads to "Ponów chwilowe błędy", or says
   * there is nothing worth retrying (blocks pass only with time).
   */
  function problemsMarkup(errors,retryCount) {
    const groups=new Map();
    for(const error of errors) {
      const key=error.source+'\u0000'+error.code;
      if(!groups.has(key)) groups.set(key,{source:error.source,code:error.code,failed:[],skipped:[],retry:0});
      const group=groups.get(key);
      (error.skipped?group.skipped:group.failed).push(error.query);
      if(isRetryableError(error)) group.retry++;
    }
    const rows=[...groups.values()].map(group=>'<li><b>'+escapeHtml(group.source)+'</b> — '+escapeHtml(problemLabel(group.code))+(group.retry?' (chwilowy)':'')+': '+escapeHtml(group.failed.join(', ')||'—')+(group.skipped.length?'<br><small>pominięte po blokadzie, bez zapytania: '+escapeHtml(group.skipped.join(', '))+'</small>':'')+'</li>').join('');
    const retry=retryCount
      ?'<p>'+retryCount+' z nich to chwilowe błędy: <button type="button" class="link-button" data-retry-failed>Ponów chwilowe błędy ('+retryCount+')</button></p>'
      :'<p>Żaden nie jest chwilowy — to blokady źródeł; ponowienie teraz nic nie da. Odznacz te źródła albo spróbuj za kilka godzin.</p>';
    return ' · <details class="scan-problems"><summary>'+problemTasks(errors.length)+' — wyniki mogą być niepełne</summary><ul>'+rows+'</ul>'+retry+'</details>';
  }
  async function refreshRuns() {
    const response=await json('/api/scan-runs'); state.scanRuns=response.items || [];
    const selected=$('#offerScan').value;
    const empty=document.createElement('option');empty.value='';empty.textContent='Wszystkie skany';
    $('#offerScan').replaceChildren(empty);
    for(const run of state.scanRuns) {
      const option=document.createElement('option');option.value=run.at;
      option.textContent=new Date(run.at).toLocaleString('pl-PL')+' · '+run.found+' ofert'+(run.context?.cancelled?' · przerwany':'')+(run.indexed?'':' · brak szczegółów starego skanu');option.disabled=!run.indexed;$('#offerScan').append(option);
    }
    $('#offerScan').value=selected;
    const run=state.scanRuns[0];
    if(run?.indexed) {
      $('#scanResults').hidden=false;
      $('#scanRun').hidden=false;
      const failed=run.errors?.length||0;
      const again=retryable(run);
      const skipped=failed-again.length;
      const head=new Date(run.at).toLocaleString('pl-PL',{day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})+(run.context?.cancelled?' · skan przerwany: tylko ukończone frazy':'');
      $('#scanResultSummary').innerHTML=escapeHtml(head)+(failed?problemsMarkup(run.errors,again.length):'');
      $('#scanResultSummary').querySelector('[data-retry-failed]')?.addEventListener('click',()=>$('#retryFailedScan').click());
      $('#retryFailedScan').hidden=!again.length || !run.context;
      $('#retryFailedScan').textContent='Ponów chwilowe błędy ('+again.length+')';
      renderScanResultCard(run);
    }
  }
  async function showResults(change='',review=false) {
    await refreshRuns();const run=state.scanRuns[0];if(!run?.indexed) return toast('Brak skanu ze szczegółowymi wynikami. Uruchom nowy skan.');
    if(review) {
      state.reviewOffer='';
      state.reviewScan=run.at;
      $('#reviewScanScope').hidden=false;
      $('#reviewScanScope').textContent='Weryfikacja wyników skanu '+new Date(run.at).toLocaleString('pl-PL')+'. ';
      const clear=document.createElement('button');clear.type='button';clear.textContent='Pokaż wszystkie zadania';clear.className='button secondary';
      clear.addEventListener('click',async()=>{state.reviewScan='';$('#reviewScanScope').hidden=true;await loadCatalogData();});
      $('#reviewScanScope').append(clear);showView('review');await loadCatalogData();return;
    }
    $('#offerScan').value=run.at;$('#offerScanChange').value=change;state.offerView='all';state.offerPage=1;
    $('#offerStatus').value='';$('#offerSource').value='';$('#offerSearch').value='';$('#offerMinPrice').value='';$('#offerMaxPrice').value='';
    $('#offerQuickViews').querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.purchaseView==='all')));
    showView('offers');await loadCatalogData();
  }
  $('#scanAllResults').addEventListener('click',()=>void showResults().catch(error=>toast(error.message)));
  $('#scanNewResults').addEventListener('click',()=>void showResults('new').catch(error=>toast(error.message)));
  $('#scanPriceResults').addEventListener('click',()=>void showResults('price').catch(error=>toast(error.message)));
  $('#scanReviewResults').addEventListener('click',()=>void showResults('',true).catch(error=>toast(error.message)));
  document.addEventListener('bookflip-review-offer',async event=>{
    try {
      state.reviewOffer=event.detail.offerId;state.reviewScan='';await loadCatalogData();
      state.selectedReviewId=event.detail.jobId;state.reviewDetail=await json('/api/offers/'+encodeURIComponent(event.detail.offerId));
      $('#reviewScanScope').hidden=false;$('#reviewScanScope').textContent='Weryfikacja wybranej oferty. ';
      const clear=document.createElement('button');clear.type='button';clear.className='button secondary';clear.textContent='Pokaż całą kolejkę';
      clear.addEventListener('click',async()=>{state.reviewOffer='';$('#reviewScanScope').hidden=true;await loadCatalogData();});$('#reviewScanScope').append(clear);
      showView('review');
      openDetailView('review');
    }catch(error){toast('Nie udało się otworzyć zadania. Oferta może już być przetworzona.');}
  });
  // The scanner listens for exact source/query pairs, never a Cartesian retry.
  $('#retryFailedScan').addEventListener('click',()=>{
    const run=state.scanRuns[0];
    const again=retryable(run);
    if(again.length) document.dispatchEvent(new CustomEvent('bookflip-retry-scan',{detail:again.map(row=>({source:row.source,query:row.query}))}));
  });
  document.addEventListener('bookflip-scan-complete',()=>{void refreshRuns().catch(error=>toast(error.message));});
  const defaultFields=['shipping','other'].map((key,i)=>amountInput(i?'Inne koszty (zł)':'Dostawa (zł)',key));
  $('#defaultCostFields').append(...defaultFields);
  $('#saveTradingDefaults').addEventListener('click',async()=>{
    const button=$('#saveTradingDefaults');button.disabled=true;
    try {await write('/api/trading-defaults',Object.fromEntries(defaultFields.map(field=>[field.querySelector('input').name,readAmount(field.querySelector('input'))])));savedDefaults();$('#defaultsResult').textContent='Zapisano domyślne koszty.';}
    catch(error){$('#defaultsResult').textContent='Nie zapisano kosztów. Wpisz poprawne kwoty do dwóch miejsc po przecinku.';}
    finally{button.disabled=false;}
  });
  async function refreshData() {
    const data=await json('/api/data/overview');$('#dataLocation').textContent='Plik danych: '+data.databasePath;
    if(!$('#copyDataLocation')) {
      const copy=document.createElement('button');copy.id='copyDataLocation';copy.type='button';copy.className='button secondary';copy.textContent='Kopiuj lokalizację danych';
      copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(data.databasePath);$('#backupResult').textContent='Skopiowano lokalizację danych.';}catch(error){$('#backupResult').textContent='Nie udało się skopiować. Zaznacz i skopiuj ścieżkę powyżej.';}});$('#dataLocation').after(copy);
    }
    $('#lastBackup').textContent=data.lastBackupAt?'Ostatnia lokalna kopia: '+new Date(data.lastBackupAt).toLocaleString('pl-PL'):'Brak lokalnych kopii zapasowych. Utwórz pierwszą kopię.';
  }
  $('#createBackup').addEventListener('click',async()=>{
    const button=$('#createBackup');button.disabled=true;$('#backupResult').textContent='Tworzenie i sprawdzanie kopii…';
    try{const result=await write('/api/data/backup',{},'POST');$('#backupResult').textContent='Kopia utworzona: '+result.path+'. Przenieś dodatkową kopię na inny dysk.';await refreshData();}
    catch(error){$('#backupResult').textContent='Nie udało się utworzyć kopii. Sprawdź wolne miejsce i prawa zapisu.';}
    finally{button.disabled=false;}
  });
  async function refreshSettings() {
    try {
      const [health]=await Promise.all([json('/api/source-health'),refreshData()]);
      $('#settingsSources').replaceChildren();
      for(const source of state.sources) {
        const row=health.items.find(item=>item.source===source);
        const item=document.createElement('span'),title=document.createElement('b'),copy=document.createElement('small');title.textContent=source;
        copy.textContent=sourceHealthNote(row,{noAccess:Object.hasOwn(state.noAccess||{},source)});
        item.append(title,copy);$('#settingsSources').append(item);
      }
      if(!settingsLoaded && document.body.classList.contains('trading-mode')) {
        settingsLoaded=true;
        const defaults=await json('/api/trading-defaults');defaultFields.forEach(field=>{const input=field.querySelector('input');input.value=defaults[input.name]??'';});savedDefaults=watchForm('defaults',defaultFields.map(field=>field.querySelector('input')));settingsLoaded=true;
      }
    } catch(error){toast('Nie udało się odświeżyć ustawień. Spróbuj ponownie.');}
  }
  async function refreshDecisions() {
    try {
      const [response,batches,distinct,fills]=await Promise.all([json('/api/review-decisions'),json('/api/review-batches').catch(()=>({items:[]})),json('/api/catalog/work-duplicates/distinct').catch(()=>({items:[]})),json('/api/catalog/edition-fills').catch(()=>({items:[]}))]);const parent=$('#reviewDecisionHistory');parent.replaceChildren();
      // Publisher / year filled from the sources (one batch = one row, "Cofnij" empties them again).
      for(const fill of fills.items.filter(item=>item.open>0)) {
        const item=document.createElement('div');item.className='decision-history-row is-fill';
        const label=document.createElement('span');label.textContent='Uzupełniono dane wydań: '+fill.open+' pól w '+fill.editions+' wydaniach · '+new Date(fill.createdAt).toLocaleString('pl-PL');
        const undo=document.createElement('button');undo.type='button';undo.className='button secondary';undo.textContent='Cofnij';
        undo.addEventListener('click',async()=>{undo.disabled=true;try{const result=await write('/api/catalog/edition-fills/'+encodeURIComponent(fill.id)+'/undo',{},'POST');toast('Cofnięto '+result.reopened+' pól'+(result.kept?'; '+result.kept+' zmienione ręcznie zostaje.':'.'));await refreshDecisions();}catch(error){undo.disabled=false;toast('Nie cofnięto: '+error.message);}});
        item.append(label,undo);parent.append(item);
      }
      // "To różne książki" (Kolejka → Możliwe duplikaty): one row per decision, "Cofnij" proposes the group again.
      for(const decision of distinct.items.filter(item=>!item.undone)) {
        const item=document.createElement('div');item.className='decision-history-row is-distinct';
        const label=document.createElement('span');label.textContent='Różne książki: '+decision.works.map(work=>work.title).join(' ≠ ')+' · '+new Date(decision.createdAt).toLocaleString('pl-PL');
        const undo=document.createElement('button');undo.type='button';undo.className='button secondary';undo.textContent='Cofnij';
        undo.addEventListener('click',async()=>{undo.disabled=true;try{await write('/api/catalog/work-duplicates/distinct/'+encodeURIComponent(decision.id)+'/undo',{},'POST');await refreshDecisions();}catch(error){undo.disabled=false;toast('Nie cofnięto: '+error.message);}});
        item.append(label,undo);parent.append(item);
      }
      // Batch approvals (review 11.2026, stage 2): one row per batch, "Cofnij całą partię".
      for(const batch of batches.items.filter(item=>item.open>0)) {
        const item=document.createElement('div');item.className='decision-history-row is-batch';
        const label=document.createElement('span');label.textContent='Partia '+(batch.kind==='add'?'„Do dodania”':'„Szybkie”')+' · '+batch.decisions+' decyzji · '+new Date(batch.createdAt).toLocaleString('pl-PL');
        const undo=document.createElement('button');undo.type='button';undo.className='button secondary';undo.textContent='Cofnij całą partię ('+batch.open+')';
        undo.addEventListener('click',async()=>{
          undo.disabled=true;
          try {const result=await write('/api/review-batches/'+encodeURIComponent(batch.id)+'/undo',{},'POST');toast('Cofnięto '+result.reopened+' decyzji'+(result.failed.length?'; '+result.failed.length+' ma nowszą zmianę i zostaje.':'.'));await loadCatalogData();await refreshDecisions();}
          catch(error){undo.disabled=false;toast('Nie cofnięto partii: '+error.message);}
        });
        item.append(label,undo);parent.append(item);
      }
      for(const row of response.items) {
        const item=document.createElement('div');item.className='decision-history-row';
        const label=document.createElement('span');label.textContent=row.title+' · '+statusLabel(row.action)+' · '+new Date(row.createdAt).toLocaleString('pl-PL');
        const reopen=document.createElement('button');reopen.type='button';reopen.className='button secondary';reopen.textContent=row.revisionId?'Otwarto ponownie':'Popraw decyzję';reopen.disabled=Boolean(row.revisionId);
        // An automatic relist link: undone by separating the two listings.
        if(String(row.action).startsWith('relist_')) {
          reopen.textContent=row.revisionId?'Rozłączono':'Rozłącz — to różne ogłoszenia';
          reopen.addEventListener('click',async()=>{
            reopen.disabled=true;
            try {await write('/api/offer-relists/'+encodeURIComponent(row.offerId)+'/undo',{},'POST');await refreshDecisions();}
            catch(error){reopen.disabled=false;toast('Nie rozłączono: '+error.message);}
          });
          item.append(label,reopen);parent.append(item);continue;
        }
        reopen.addEventListener('click',async()=>{
          if(!(await confirmDialog('Otworzyć ofertę do ponownej weryfikacji? Poprzednia decyzja pozostanie w historii. Aktualne przypisanie tej decyzji zostanie wycofane.', { title: 'Ponowna weryfikacja', confirmLabel: 'Otwórz ponownie', danger: true }))) return;
          reopen.disabled=true;
          try {const result=await write('/api/review-decisions/'+encodeURIComponent(row.id)+'/reopen',{},'POST');state.reviewScan='';await loadCatalogData();state.selectedReviewId=result.jobId;showView('review');await refreshDecisions();await loadCatalogStatus();}
          catch(error){reopen.disabled=false;toast('Nie można poprawić tej decyzji: istnieje nowsza zmiana lub zadanie jest w toku.');}
        });item.append(label,reopen);parent.append(item);
      }
      if(!response.items.length && !parent.children.length) parent.textContent='Nie podjęto jeszcze ręcznych decyzji.';
    }catch(error){$('#reviewDecisionHistory').textContent='Nie udało się odczytać historii decyzji.';}
  }
  $('#reviewDecisionHistory').closest('details').addEventListener('toggle',event=>{if(event.currentTarget.open) void refreshDecisions();});
  return {refreshRuns,refreshSettings,refreshDecisions,showResults,openOfferDrawer};
}
